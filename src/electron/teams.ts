import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generateTeamMd, generateStartTeamCommand } from "./team-templates";
import type {
  Profile,
  Team,
  TeamMember,
  TeamsStore,
  MergePreview,
  LaunchOptions,
} from "./types";
import {
  scanInstalledPlugins,
  getPluginsWithItems,
  writeMcpConfig,
} from "./plugins";
import {
  resolveModelId,
  symlinkSelectedCaches,
  symlinkShared,
  ensureBuiltinPlugin,
} from "./assembly";
import { syncCredentials } from "./keychain";
import {
  CLAUDE_HOME,
  PROFILES_DIR,
  validateProfileName,
  ensureProfilesDir,
  getGlobalDefaults,
} from "./config";
import { loadProfiles } from "./core";
import {
  escSh,
  findRealClaudeBinary,
  launchInTerminal,
  recordLaunch,
} from "./launch";

// ---------------------------------------------------------------------------
// Team persistence
// ---------------------------------------------------------------------------

const TEAMS_JSON = path.join(PROFILES_DIR, "teams.json");

/** See PROFILES_SCHEMA_VERSION — same pattern for the teams file. */
const TEAMS_SCHEMA_VERSION = 1;

function migrateTeamsStore(raw: any): TeamsStore {
  if (!raw || typeof raw !== "object") return { schemaVersion: TEAMS_SCHEMA_VERSION, teams: {} };
  const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
  let store: any = raw;
  if (version < 1) {
    store = { ...store, schemaVersion: 1 };
  }
  return store as TeamsStore;
}

export function readTeamsStore(): TeamsStore {
  if (!fs.existsSync(TEAMS_JSON)) return { schemaVersion: TEAMS_SCHEMA_VERSION, teams: {} };
  const raw = JSON.parse(fs.readFileSync(TEAMS_JSON, "utf-8"));
  return migrateTeamsStore(raw);
}

export function writeTeamsStore(store: TeamsStore): void {
  ensureProfilesDir();
  const stamped: TeamsStore = { ...store, schemaVersion: TEAMS_SCHEMA_VERSION };
  const tmp = TEAMS_JSON + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(stamped, null, 2) + "\n");
  fs.renameSync(tmp, TEAMS_JSON);
}

export function loadTeams(): Team[] {
  const store = readTeamsStore();
  return Object.values(store.teams);
}

export function saveTeam(team: Team): Team {
  validateProfileName(team.name);
  const store = readTeamsStore();
  store.teams[team.name] = team;
  writeTeamsStore(store);
  return team;
}

export function renameTeam(oldName: string, team: Team): Team {
  validateProfileName(team.name);
  const store = readTeamsStore();
  if (!store.teams[oldName]) throw new Error(`Team "${oldName}" not found`);
  if (team.name !== oldName && store.teams[team.name]) {
    throw new Error(`A team named "${team.name}" already exists`);
  }
  if (team.name !== oldName) {
    delete store.teams[oldName];
  }
  store.teams[team.name] = team;
  writeTeamsStore(store);
  return team;
}

export function deleteTeamByName(name: string): void {
  const store = readTeamsStore();
  delete store.teams[name];
  writeTeamsStore(store);

  // Clean up the team's profile directory
  const teamDir = path.join(PROFILES_DIR, `_team_${name}`);
  if (fs.existsSync(teamDir)) {
    fs.rmSync(teamDir, { recursive: true });
  }
}

export function checkAllTeamHealth(teams: Team[]): Record<string, string[]> {
  const profiles = loadProfiles();
  const profileNames = new Set(profiles.map((p) => p.name));
  const result: Record<string, string[]> = {};
  for (const team of teams) {
    const orphaned = team.members
      .filter((m) => !profileNames.has(m.profile))
      .map((m) => m.profile);
    if (orphaned.length > 0) result[team.name] = orphaned;
  }
  return result;
}

export function assembleTeamProfile(team: Team): string {
  const teamDirName = `_team_${team.name}`;
  validateProfileName(teamDirName);
  const configDir = path.join(PROFILES_DIR, teamDirName, "config");

  // Wipe and recreate to ensure clean state on every launch
  if (fs.existsSync(configDir)) fs.rmSync(configDir, { recursive: true });
  fs.mkdirSync(path.join(configDir, "plugins", "cache"), { recursive: true });
  fs.mkdirSync(path.join(configDir, "plugins", "data"), { recursive: true });
  fs.mkdirSync(path.join(configDir, "plugins", "marketplaces"), { recursive: true });
  fs.mkdirSync(path.join(configDir, "commands"), { recursive: true });

  const profiles = loadProfiles();
  const lead = team.members.find((m) => m.isLead);
  if (!lead) throw new Error("Team has no lead member");
  const leadProfile = profiles.find((p) => p.name === lead.profile);
  if (!leadProfile) throw new Error(`Lead profile "${lead.profile}" not found`);

  // Collect union of all plugins across all members
  const allPlugins = new Set<string>();
  const memberProfiles: Array<{ member: TeamMember; profile: Profile }> = [];
  for (const member of team.members) {
    const prof = profiles.find((p) => p.name === member.profile);
    if (!prof) throw new Error(`Profile "${member.profile}" not found`);
    memberProfiles.push({ member, profile: prof });
    for (const plugin of prof.plugins) {
      allPlugins.add(plugin);
    }
  }

  // Build filtered installed_plugins.json with union of all plugins
  const sourceManifestPath = path.join(CLAUDE_HOME, "plugins", "installed_plugins.json");
  let sourceManifest: any = { plugins: {} };
  if (fs.existsSync(sourceManifestPath)) {
    sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf-8"));
  }
  const filteredPlugins: Record<string, any> = {};
  for (const [name, installs] of Object.entries(sourceManifest.plugins ?? {})) {
    if (allPlugins.has(name)) {
      filteredPlugins[name] = installs;
    }
  }
  fs.writeFileSync(
    path.join(configDir, "plugins", "installed_plugins.json"),
    JSON.stringify({ plugins: filteredPlugins }, null, 2),
    "utf-8"
  );

  // Build settings.json from lead profile, with team-level overrides
  const globalSettingsPath = path.join(CLAUDE_HOME, "settings.json");
  let globalSettings: Record<string, any> = {};
  if (fs.existsSync(globalSettingsPath)) {
    try { globalSettings = JSON.parse(fs.readFileSync(globalSettingsPath, "utf-8")); } catch {}
  }

  // Start from safe global keys (same as assembleProfile)
  const safeKeys = ["env", "hooks", "statusLine", "voiceEnabled"];
  const teamSettings: Record<string, any> = {};
  for (const key of safeKeys) {
    if (key in globalSettings) teamSettings[key] = JSON.parse(JSON.stringify(globalSettings[key]));
  }

  // Apply lead profile overrides
  if (leadProfile.model) teamSettings.model = resolveModelId(leadProfile.model, leadProfile.opusContext, leadProfile.sonnetContext);
  if (leadProfile.effortLevel) teamSettings.effortLevel = leadProfile.effortLevel;
  if (leadProfile.env) {
    teamSettings.env = { ...(teamSettings.env ?? {}), ...leadProfile.env };
  }

  // Apply team-level overrides (these win over lead profile)
  if (team.model) teamSettings.model = resolveModelId(team.model, team.opusContext, team.sonnetContext);
  if (team.effortLevel) teamSettings.effortLevel = team.effortLevel;

  // Copy permissions from global settings
  if (globalSettings.permissions) {
    teamSettings.permissions = JSON.parse(JSON.stringify(globalSettings.permissions));
  }

  fs.writeFileSync(
    path.join(configDir, "settings.json"),
    JSON.stringify(teamSettings, null, 2),
    "utf-8"
  );

  // Per-profile status line override for teams — inherit from the lead
  // profile's override (if any). When absent, ensure any stale file is
  // removed so the global config wins.
  const teamStatuslineConfigPath = path.join(configDir, "statusline-config.json");
  if (leadProfile.statusLineConfig) {
    fs.writeFileSync(
      teamStatuslineConfigPath,
      JSON.stringify(leadProfile.statusLineConfig, null, 2) + "\n",
      "utf-8",
    );
  } else {
    try { fs.unlinkSync(teamStatuslineConfigPath); } catch {}
  }

  // Symlink plugin caches for all merged plugins
  const installedPlugins = scanInstalledPlugins();
  symlinkSelectedCaches(
    { ...leadProfile, plugins: [...allPlugins] } as Profile,
    configDir,
    installedPlugins
  );

  // Symlink shared resources (auth, CLAUDE.md, projects, local add-ons, marketplaces)
  symlinkShared(configDir, leadProfile);

  // Ensure built-in profiles-manager plugin is installed in the global cache
  ensureBuiltinPlugin();

  // Track add-on ownership: which member contributed each add-on
  const pluginsWithItems = getPluginsWithItems();
  const ownedAddOns: Map<string, {
    skills: string[];
    agents: string[];
    commands: string[];
  }> = new Map();

  const claimedAddOns = new Set<string>();
  for (const { member, profile } of memberProfiles) {
    const skills: string[] = [];
    const agents: string[] = [];
    const commands: string[] = [];

    for (const pluginName of profile.plugins) {
      const plugin = pluginsWithItems.find((p) => p.name === pluginName);
      if (!plugin) continue;
      const excluded = new Set(profile.excludedItems?.[pluginName] ?? []);

      for (const item of plugin.items) {
        if (excluded.has(item.name)) continue;
        const key = `${item.type}:${item.name}`;
        if (claimedAddOns.has(key)) continue;
        claimedAddOns.add(key);

        if (item.type === "skill") skills.push(item.name);
        else if (item.type === "agent") agents.push(item.name);
        else if (item.type === "command") commands.push(item.name);
      }
    }

    ownedAddOns.set(member.profile, { skills, agents, commands });
  }

  // Generate TEAM.md and /start-team command from templates
  const nonLeadMembers = team.members.filter((m) => !m.isLead);

  const teamMd = generateTeamMd(team, lead, nonLeadMembers, ownedAddOns);
  fs.writeFileSync(path.join(configDir, "TEAM.md"), teamMd, "utf-8");

  // Append TEAM.md reference to CLAUDE.md if it exists, or create one
  const claudeMdPath = path.join(configDir, "CLAUDE.md");
  const teamMdRef = "\n\n<!-- Team configuration -->\n@import TEAM.md\n";
  if (fs.existsSync(claudeMdPath)) {
    const existing = fs.readFileSync(claudeMdPath, "utf-8");
    if (!existing.includes("TEAM.md")) {
      fs.appendFileSync(claudeMdPath, teamMdRef, "utf-8");
    }
  } else {
    fs.writeFileSync(claudeMdPath, teamMdRef.trim(), "utf-8");
  }

  const startCmd = generateStartTeamCommand(team, lead, leadProfile, nonLeadMembers, memberProfiles, ownedAddOns);
  fs.writeFileSync(path.join(configDir, "commands", "start-team.md"), startCmd, "utf-8");

  // Generate baseline mcp.json
  const baselineDir = leadProfile.directory ?? os.homedir();
  writeMcpConfig(
    { ...leadProfile, plugins: [...allPlugins] } as Profile,
    baselineDir,
    configDir
  );

  return configDir;
}

export async function launchTeam(team: Team, directory?: string, options?: LaunchOptions): Promise<void> {
  const lead = team.members.find((m) => m.isLead);
  if (!lead) throw new Error("Team has no lead member");
  const profiles = loadProfiles();
  const leadProfile = profiles.find((p) => p.name === lead.profile);
  if (!leadProfile) throw new Error(`Lead profile "${lead.profile}" not found`);

  const configDir = assembleTeamProfile(team);
  const workDir = directory ?? leadProfile.directory ?? os.homedir();

  // Regenerate mcp.json for the actual working directory
  writeMcpConfig(
    { ...leadProfile, plugins: [...new Set(team.members.flatMap((m) => {
      const prof = profiles.find((p) => p.name === m.profile);
      return prof?.plugins ?? [];
    }))] } as Profile,
    workDir,
    configDir
  );

  // Sync credentials for the team config dir (not the lead profile's dir)
  if (leadProfile.useDefaultAuth !== false) {
    const teamDirName = `_team_${team.name}`;
    await syncCredentials({ ...leadProfile, name: teamDirName } as Profile, "launch");
  }

  const mcpConfigPath = path.join(configDir, "mcp.json");

  // Build launch flags — global defaults first, then team/lead overrides, then one-shot overrides
  const flagParts: string[] = [];
  const globalDefs = getGlobalDefaults();
  if (globalDefs.customFlags?.trim()) flagParts.push(globalDefs.customFlags.trim());
  const skipPerms = options?.dangerouslySkipPermissions ?? leadProfile.launchFlags?.dangerouslySkipPermissions;
  if (skipPerms) flagParts.push("--dangerously-skip-permissions");
  if (leadProfile.launchFlags?.verbose) flagParts.push("--verbose");
  if (team.customFlags?.trim()) flagParts.push(team.customFlags.trim());
  if (options?.customFlags?.trim()) flagParts.push(options.customFlags.trim());
  const flagStr = flagParts.length > 0 ? " " + flagParts.join(" ") : "";

  const claudeBin = findRealClaudeBinary();

  // Write a launcher script to avoid nested escaping issues with tmux + AppleScript
  const projectName = path.basename(workDir);
  const sessionName = `Team: ${team.name} — ${projectName}`;
  const innerCmd = `cd '${escSh(workDir)}' && CLAUDE_CONFIG_DIR='${escSh(configDir)}' '${escSh(claudeBin)}' --mcp-config '${escSh(mcpConfigPath)}' --strict-mcp-config --teammate-mode tmux --name '${escSh(sessionName)}'${flagStr} '/start-team'`;
  const launcherPath = path.join(configDir, ".team-launch.sh");
  fs.writeFileSync(launcherPath, `#!/bin/bash\n${innerCmd}\n`, { mode: 0o755 });

  const tmuxMode = options?.tmuxMode ?? globalDefs.tmuxMode ?? "cc";
  let shellCmd: string;
  if (tmuxMode === "none") {
    shellCmd = `'${escSh(launcherPath)}'`;
  } else if (tmuxMode === "plain") {
    shellCmd = `tmux new-session '${escSh(launcherPath)}'`;
  } else {
    shellCmd = `tmux -CC new-session '${escSh(launcherPath)}'`;
  }

  const terminal = options?.terminalApp ?? globalDefs.terminalApp ?? "terminal";
  await launchInTerminal(shellCmd, terminal);
  recordLaunch({ type: "team", name: team.name, directory: workDir, timestamp: Date.now() });
}

export function getTeamMergePreview(team: Team): MergePreview {
  const profiles = loadProfiles();
  const allPlugins = new Set<string>();
  const allMcps = new Set<string>();
  const mcpSources = new Map<string, string>(); // mcp name -> profile that added it
  const agents: MergePreview["agents"] = [];
  const conflicts: string[] = [];
  const excludedByProfile: Record<string, Record<string, string[]>> = {};

  const leadMember = team.members.find((m) => m.isLead);
  const leadProfile = leadMember
    ? profiles.find((p) => p.name === leadMember.profile)
    : undefined;

  for (const member of team.members) {
    const profile = profiles.find((p) => p.name === member.profile);
    if (!profile) continue;

    for (const plugin of profile.plugins) {
      allPlugins.add(plugin);
    }

    // Track exclusions per profile for conflict detection
    if (Object.keys(profile.excludedItems).length > 0) {
      excludedByProfile[member.profile] = profile.excludedItems;
    }

    // Collect MCP servers from this member's enabled plugins
    const allPluginsWithItems = getPluginsWithItems();
    for (const pluginName of profile.plugins) {
      const plugin = allPluginsWithItems.find((p) => p.name === pluginName);
      if (!plugin) continue;
      for (const mcp of plugin.mcpServers) {
        if (allMcps.has(mcp.name)) {
          // Conflict: same MCP server name from different profiles
          const existing = mcpSources.get(mcp.name);
          if (existing && existing !== member.profile) {
            conflicts.push(`MCP server "${mcp.name}" provided by both "${existing}" and "${member.profile}"`);
          }
        } else {
          allMcps.add(mcp.name);
          mcpSources.set(mcp.name, member.profile);
        }
      }
    }

    // All members appear in agent definitions; lead is labeled
    agents.push({
      name: member.isLead
        ? `${member.role || member.profile} (lead)`
        : (member.role || member.profile),
      profile: member.profile,
      instructions: member.instructions,
    });
  }

  // Detect exclusion conflicts: same plugin in multiple profiles with different exclusions
  const pluginProfiles: Record<string, string[]> = {};
  for (const [profileName, exclusions] of Object.entries(excludedByProfile)) {
    for (const pluginName of Object.keys(exclusions)) {
      if (!pluginProfiles[pluginName]) pluginProfiles[pluginName] = [];
      pluginProfiles[pluginName].push(profileName);
    }
  }
  for (const [pluginName, profileNames] of Object.entries(pluginProfiles)) {
    if (profileNames.length > 1) {
      conflicts.push(
        `Plugin "${pluginName.split("@")[0]}" has different exclusions in: ${profileNames.join(", ")}`
      );
    }
  }

  // Settings come from individual profiles — summarize what's configured
  const settings: MergePreview["settings"] = {
    model: leadProfile?.model,
    effortLevel: leadProfile?.effortLevel,
    customFlags: leadProfile?.customFlags,
    source: "per-profile",
  };

  return {
    plugins: Array.from(allPlugins),
    mcpServers: Array.from(allMcps),
    agents,
    settings,
    conflicts,
  };
}
