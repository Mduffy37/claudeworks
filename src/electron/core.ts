import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { execFileSync, execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
import type {
  PluginEntry,
  PluginItem,
  PluginHook,
  PluginMcp,
  PluginWithItems,
  StandaloneMcp,
  LocalItem,
  Profile,
  ProfilesStore,
  Team,
  TeamsStore,
  MergePreview,
} from "./types";

const CLAUDE_HOME = path.join(os.homedir(), ".claude");
const PROFILES_DIR = path.join(os.homedir(), ".claude-profiles");
const PROFILES_JSON = path.join(PROFILES_DIR, "profiles.json");

function validateProfileName(name: string): void {
  if (!name || /[\/\\\0]|\.\./.test(name)) {
    throw new Error(`Invalid profile name: "${name}". Names must not contain path separators, "..", or null bytes.`);
  }
  const resolved = path.resolve(PROFILES_DIR, name);
  if (!resolved.startsWith(PROFILES_DIR + path.sep)) {
    throw new Error(`Invalid profile name: "${name}" resolves outside the profiles directory.`);
  }
}

// ---------------------------------------------------------------------------
// Plugin scanning
// ---------------------------------------------------------------------------

export function scanInstalledPlugins(): PluginEntry[] {
  const manifestPath = path.join(CLAUDE_HOME, "plugins", "installed_plugins.json");
  if (!fs.existsSync(manifestPath)) return [];

  const data = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const entries: PluginEntry[] = [];

  for (const [name, installs] of Object.entries(data.plugins ?? {})) {
    const [pluginName, marketplace = "unknown"] = name.split("@", 2);

    // Deduplicate: prefer user scope, then pick latest by installPath
    const allInstalls = (installs as any[]).map((install) => ({
      name,
      scope: (install.scope ?? "user") as "user" | "project",
      installPath: install.installPath ?? "",
      version: install.version ?? "unknown",
      marketplace,
      pluginName,
      projectPath: install.projectPath,
    }));

    // Keep user-scoped if available, otherwise first project-scoped
    const userInstall = allInstalls.find((i) => i.scope === "user");
    const projectInstalls = allInstalls.filter((i) => i.scope === "project");

    if (userInstall) entries.push(userInstall);
    // For project-scoped, deduplicate by projectPath
    const seenPaths = new Set<string>();
    for (const pi of projectInstalls) {
      const key = pi.projectPath ?? pi.installPath;
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        entries.push(pi);
      }
    }
  }
  return entries;
}

export function scanPluginItems(plugin: PluginEntry): PluginItem[] {
  const items: PluginItem[] = [];
  const base = plugin.installPath;
  if (!fs.existsSync(base)) return items;

  // Skills
  const skillsDir = path.join(base, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      const fm = readFrontmatter(skillMd);
      items.push({
        name: fm.name ?? entry.name,
        description: cleanDescription(fm.description ?? ""),
        type: "skill",
        plugin: plugin.name,
        path: skillMd,
        userInvocable: (fm["user-invocable"] ?? "true").toLowerCase() !== "false",
        dependencies: scanDependencies(skillMd),
      });
    }
  }

  // Commands
  const cmdsDir = path.join(base, "commands");
  if (fs.existsSync(cmdsDir)) {
    for (const file of fs.readdirSync(cmdsDir)) {
      if (!file.endsWith(".md")) continue;
      const cmdPath = path.join(cmdsDir, file);
      const cmdFm = readFrontmatter(cmdPath);
      items.push({
        name: path.basename(file, ".md"),
        description: cleanDescription(cmdFm.description ?? ""),
        type: "command",
        plugin: plugin.name,
        path: cmdPath,
        userInvocable: true,
        dependencies: scanDependencies(cmdPath),
      });
    }
  }

  // Agents — in agents/ subdirectory
  const agentsDir = path.join(base, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (!file.endsWith(".md") || file === "README.md") continue;
      const agentPath = path.join(agentsDir, file);
      const agentFm = readFrontmatter(agentPath);
      items.push({
        name: path.basename(file, ".md"),
        description: cleanDescription(agentFm.description ?? ""),
        type: "agent",
        plugin: plugin.name,
        path: agentPath,
        userInvocable: true,
        dependencies: scanDependencies(agentPath),
      });
    }
  }

  // Agents — root-level .md files (e.g. voltagent pattern)
  if (items.length === 0) {
    const hasSubdirs = ["skills", "agents", "commands"].some(
      (d) => fs.existsSync(path.join(base, d))
    );
    if (!hasSubdirs) {
      for (const file of fs.readdirSync(base)) {
        if (!file.endsWith(".md") || file === "README.md") continue;
        const rootAgentPath = path.join(base, file);
        const rootFm = readFrontmatter(rootAgentPath);
        items.push({
          name: path.basename(file, ".md"),
          description: cleanDescription(rootFm.description ?? ""),
          type: "agent",
          plugin: plugin.name,
          path: rootAgentPath,
          userInvocable: true,
          dependencies: scanDependencies(rootAgentPath),
        });
      }
    }
  }

  return items;
}

export function scanPluginHooks(plugin: PluginEntry): PluginHook[] {
  const hooksJson = path.join(plugin.installPath, "hooks", "hooks.json");
  if (!fs.existsSync(hooksJson)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(hooksJson, "utf-8"));
    const hooks: PluginHook[] = [];
    for (const [event, entries] of Object.entries(data.hooks ?? {})) {
      for (const entry of entries as any[]) {
        for (const hook of entry.hooks ?? []) {
          if (hook.command) {
            hooks.push({ event, command: hook.command });
          }
        }
      }
    }
    return hooks;
  } catch {
    return [];
  }
}

/**
 * Scan a .md file for references to other skills/agents.
 * Looks for patterns like "pluginName:skillName" — only matches known plugin names.
 */
function scanDependencies(mdPath: string): string[] {
  try {
    const content = fs.readFileSync(mdPath, "utf-8");
    const deps = new Set<string>();

    // Only match refs where the prefix is a known plugin name
    const knownPlugins = _getKnownPluginNames();
    if (knownPlugins.size === 0) return [];

    // Match "pluginname:skill-name" references (e.g. "superpowers:writing-plans")
    const refPattern = /\b([a-z][\w-]*):([a-z][\w-]*(?:-[\w-]+)*)\b/g;
    let match;
    while ((match = refPattern.exec(content)) !== null) {
      const pluginPrefix = match[1];
      if (!knownPlugins.has(pluginPrefix)) continue;
      deps.add(`${match[1]}:${match[2]}`);
    }

    // Remove self-references
    const selfName = path.basename(mdPath, ".md").toLowerCase();
    const selfSkillDir = path.basename(path.dirname(mdPath)).toLowerCase();
    for (const dep of deps) {
      const depItem = dep.split(":")[1];
      if (depItem === selfName || depItem === selfSkillDir) {
        deps.delete(dep);
      }
    }

    return Array.from(deps);
  } catch {
    return [];
  }
}

let _knownPluginNamesCache: Set<string> | null = null;
function _getKnownPluginNames(): Set<string> {
  if (_knownPluginNamesCache) return _knownPluginNamesCache;
  const plugins = scanInstalledPlugins();
  _knownPluginNamesCache = new Set(plugins.map((p) => p.pluginName));
  return _knownPluginNamesCache;
}

/**
 * Read a .mcp.json file and return its server entries as a flat Record.
 * Handles both formats:
 *   - Flat:    { "serverName": { command, args, ... } }
 *   - Wrapped: { "mcpServers": { "serverName": { command, args, ... } } }
 */
function readMcpJsonFile(filePath: string): Record<string, any> {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (raw && typeof raw === "object" && raw.mcpServers && typeof raw.mcpServers === "object") {
      return raw.mcpServers;
    }
    return raw ?? {};
  } catch {
    return {};
  }
}

export function scanPluginMcpServers(plugin: PluginEntry): PluginMcp[] {
  const mcpJson = path.join(plugin.installPath, ".mcp.json");
  if (!fs.existsSync(mcpJson)) return [];

  try {
    const data = readMcpJsonFile(mcpJson);
    const servers: PluginMcp[] = [];
    for (const [name, config] of Object.entries(data)) {
      const cfg = config as any;
      if (cfg.type === "http" || cfg.url) {
        servers.push({
          name,
          type: "http",
          url: cfg.url,
          plugin: plugin.name,
        });
      } else if (cfg.command) {
        servers.push({
          name,
          type: "stdio",
          command: `${cfg.command} ${(cfg.args ?? []).join(" ")}`,
          plugin: plugin.name,
        });
      } else {
        servers.push({ name, type: "unknown", plugin: plugin.name });
      }
    }
    return servers;
  } catch {
    return [];
  }
}

/**
 * Generate {configDir}/mcp.json for --mcp-config --strict-mcp-config launch.
 * Merge order (later entries win on name collision):
 *   1. Plugin MCPs — from each enabled plugin's .mcp.json (always included)
 *   2. User-level MCPs — from ~/.claude.json mcpServers (always included)
 *   3. Project MCPs — from ~/.claude.json projects[directory].mcpServers, filtered by disabled list
 *   4. Local .mcp.json in project directory, filtered by disabled list
 */
export function writeMcpConfig(
  profile: Profile,
  directory: string,
  configDir: string
): void {
  const mcpServers: Record<string, any> = {};

  // 1. Plugin MCPs — read .mcp.json for each enabled plugin (flat or wrapped format)
  const allPlugins = scanInstalledPlugins();
  for (const pluginName of profile.plugins) {
    const plugin = allPlugins.find((p) => p.name === pluginName);
    if (!plugin) continue;
    const mcpJsonPath = path.join(plugin.installPath, ".mcp.json");
    if (!fs.existsSync(mcpJsonPath)) continue;
    const entries = readMcpJsonFile(mcpJsonPath);
    for (const [name, config] of Object.entries(entries)) {
      mcpServers[name] = config;
    }
  }

  const disabled = profile.disabledMcpServers?.[directory] ?? [];

  // 2. User-level and project MCPs — read from ~/.claude.json
  const claudeJson = path.join(os.homedir(), ".claude.json");
  if (fs.existsSync(claudeJson)) {
    try {
      const data = JSON.parse(fs.readFileSync(claudeJson, "utf-8"));

      // User-level MCPs — always included (not toggleable)
      const userMcps: Record<string, any> = data.mcpServers ?? {};
      for (const [name, config] of Object.entries(userMcps)) {
        mcpServers[name] = config;
      }

      // Project MCPs from ~/.claude.json — filtered by disabled list
      const claudeJsonProjectMcps: Record<string, any> = data.projects?.[directory]?.mcpServers ?? {};
      for (const [name, config] of Object.entries(claudeJsonProjectMcps)) {
        if (!disabled.includes(name)) {
          mcpServers[name] = config;
        }
      }
    } catch {
      // Skip unreadable ~/.claude.json
    }
  }

  // 3. Local .mcp.json in the project directory — filtered by disabled list (flat or wrapped format)
  const localMcpPath = path.join(directory, ".mcp.json");
  if (fs.existsSync(localMcpPath)) {
    const entries = readMcpJsonFile(localMcpPath);
    for (const [name, config] of Object.entries(entries)) {
      if (!disabled.includes(name)) {
        mcpServers[name] = config;
      }
    }
  }

  // Write mcp.json — always write, even if empty (valid for --strict-mcp-config)
  const outPath = path.join(configDir, "mcp.json");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ mcpServers }, null, 2) + "\n");
}

export function getPluginsWithItems(): PluginWithItems[] {
  const plugins = scanInstalledPlugins();
  return plugins.map((p) => ({
    ...p,
    items: scanPluginItems(p),
    hooks: scanPluginHooks(p),
    mcpServers: scanPluginMcpServers(p),
  }));
}

/** Check which plugins in a profile are no longer installed globally. */
export function checkProfileHealth(profile: Profile): string[] {
  const installed = new Set(scanInstalledPlugins().map((p) => p.name));
  return profile.plugins.filter((name) => !installed.has(name));
}

/** Check health for all profiles at once (avoids repeated plugin scans). */
export function checkAllProfileHealth(profiles: Profile[]): Record<string, string[]> {
  const installed = new Set(scanInstalledPlugins().map((p) => p.name));
  const result: Record<string, string[]> = {};
  for (const profile of profiles) {
    const broken = profile.plugins.filter((name) => !installed.has(name));
    if (broken.length > 0) result[profile.name] = broken;
  }
  return result;
}

export function scanLocalItems(directory: string): LocalItem[] {
  const claudeDir = path.join(directory, ".claude");
  if (!fs.existsSync(claudeDir)) return [];

  const items: LocalItem[] = [];

  // Skills
  const skillsDir = path.join(claudeDir, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      const fm = readFrontmatter(skillMd);
      items.push({
        name: fm.name ?? entry.name,
        type: "skill",
        path: skillMd,
      });
    }
  }

  // Commands (including subdirectories for namespaced commands)
  const cmdsDir = path.join(claudeDir, "commands");
  if (fs.existsSync(cmdsDir)) {
    for (const entry of fs.readdirSync(cmdsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Namespaced commands: commands/vault/get-overview.md -> vault:get-overview
        const subDir = path.join(cmdsDir, entry.name);
        for (const file of fs.readdirSync(subDir)) {
          if (!file.endsWith(".md")) continue;
          items.push({
            name: `${entry.name}:${path.basename(file, ".md")}`,
            type: "command",
            path: path.join(subDir, file),
          });
        }
      } else if (entry.name.endsWith(".md")) {
        items.push({
          name: path.basename(entry.name, ".md"),
          type: "command",
          path: path.join(cmdsDir, entry.name),
        });
      }
    }
  }

  // Agents
  const agentsDir = path.join(claudeDir, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (!file.endsWith(".md") || file === "README.md") continue;
      items.push({
        name: path.basename(file, ".md"),
        type: "agent",
        path: path.join(agentsDir, file),
      });
    }
  }

  return items;
}

export function scanMcpServers(directory?: string): StandaloneMcp[] {
  const servers: StandaloneMcp[] = [];
  const seenNames = new Set<string>();

  // Helper to push without duplicating names (claude.json entries win over local .mcp.json)
  function push(s: StandaloneMcp) {
    if (!seenNames.has(s.name)) {
      seenNames.add(s.name);
      servers.push(s);
    }
  }

  // 1. ~/.claude.json — user-level and project-level MCPs
  const claudeJson = path.join(os.homedir(), ".claude.json");
  if (fs.existsSync(claudeJson)) {
    try {
      const data = JSON.parse(fs.readFileSync(claudeJson, "utf-8"));

      for (const [name, config] of Object.entries(data.mcpServers ?? {})) {
        const cfg = config as any;
        push({
          name,
          type: cfg.type === "http" || cfg.url ? "http" : cfg.command ? "stdio" : "unknown",
          command: cfg.command ? `${cfg.command} ${(cfg.args ?? []).join(" ")}` : undefined,
          url: cfg.url,
          scope: "user",
        });
      }

      if (directory) {
        const projectMcps = data.projects?.[directory]?.mcpServers ?? {};
        for (const [name, config] of Object.entries(projectMcps)) {
          const cfg = config as any;
          push({
            name,
            type: cfg.type === "http" || cfg.url ? "http" : cfg.command ? "stdio" : "unknown",
            command: cfg.command ? `${cfg.command} ${(cfg.args ?? []).join(" ")}` : undefined,
            url: cfg.url,
            scope: "project",
            projectPath: directory,
          });
        }
      }
    } catch {
      // Skip unreadable ~/.claude.json
    }
  }

  // 2. Local .mcp.json in the project directory (flat or wrapped format)
  if (directory) {
    const localMcpPath = path.join(directory, ".mcp.json");
    if (fs.existsSync(localMcpPath)) {
      const entries = readMcpJsonFile(localMcpPath);
      for (const [name, config] of Object.entries(entries)) {
        const cfg = config as any;
        push({
          name,
          type: cfg.type === "http" || cfg.url ? "http" : cfg.command ? "stdio" : "unknown",
          command: cfg.command ? `${cfg.command} ${(cfg.args ?? []).join(" ")}` : undefined,
          url: cfg.url,
          scope: "project",
          projectPath: directory,
        });
      }
    }
  }

  return servers;
}

// ---------------------------------------------------------------------------
// Profile persistence
// ---------------------------------------------------------------------------

function ensureProfilesDir(): void {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

function readProfilesStore(): ProfilesStore {
  if (!fs.existsSync(PROFILES_JSON)) return { profiles: {} };
  return JSON.parse(fs.readFileSync(PROFILES_JSON, "utf-8"));
}

function writeProfilesStore(store: ProfilesStore): void {
  ensureProfilesDir();
  const tmp = PROFILES_JSON + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
  fs.renameSync(tmp, PROFILES_JSON);
}

export function loadProfiles(): Profile[] {
  const store = readProfilesStore();
  return Object.values(store.profiles);
}

export function renameProfile(oldName: string, profile: Profile): Profile {
  validateProfileName(oldName);
  validateProfileName(profile.name);
  const store = readProfilesStore();
  if (!store.profiles[oldName]) throw new Error(`Profile "${oldName}" not found`);
  if (profile.name !== oldName && store.profiles[profile.name]) {
    throw new Error(`A profile named "${profile.name}" already exists`);
  }

  const old = store.profiles[oldName];
  if (old.alias) removeAlias(old.alias);

  if (profile.name !== oldName) {
    const oldDir = path.join(PROFILES_DIR, oldName);
    const newDir = path.join(PROFILES_DIR, profile.name);
    if (fs.existsSync(oldDir)) fs.renameSync(oldDir, newDir);
    delete store.profiles[oldName];
  }

  store.profiles[profile.name] = profile;
  writeProfilesStore(store);
  if (profile.alias) generateAlias(profile);

  return profile;
}

export function saveProfile(profile: Profile): Profile {
  validateProfileName(profile.name);
  const store = readProfilesStore();
  const existing = store.profiles[profile.name];
  if (existing?.alias && existing.alias !== profile.alias) {
    removeAlias(existing.alias);
  }

  store.profiles[profile.name] = profile;
  writeProfilesStore(store);

  // Generate CLI alias
  if (profile.alias) {
    generateAlias(profile);
  } else if (existing?.alias) {
    removeAlias(existing.alias);
  }

  return profile;
}

/** Escape a string for use inside a single-quoted POSIX shell argument. */
function escSh(s: string): string {
  return s.replace(/'/g, "'\\''");
}

function generateAlias(profile: Profile): void {
  const binDir = path.join(PROFILES_DIR, "bin");
  fs.mkdirSync(binDir, { recursive: true });

  const configDir = path.join(PROFILES_DIR, profile.name, "config");
  const workDir = profile.directory ?? "$PWD";

  const script = `#!/bin/bash
# Generated by Claude Profiles — do not edit
# Profile: ${profile.name}
# NOTE: mcp.json is written at iTerm2 launch time; invoking this alias before
# launching through the app may use a stale or missing mcp.json.
WORK_DIR="\${1:-${workDir === "$PWD" ? "$PWD" : escSh(workDir)}}"
cd "$WORK_DIR" && CLAUDE_CONFIG_DIR='${escSh(configDir)}' claude --mcp-config '${escSh(configDir)}/mcp.json' --strict-mcp-config
`;

  const scriptPath = path.join(binDir, profile.alias!);
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
}

function removeAlias(alias: string): void {
  const scriptPath = path.join(PROFILES_DIR, "bin", alias);
  try { fs.unlinkSync(scriptPath); } catch {}
}

export async function deleteProfileByName(name: string): Promise<void> {
  validateProfileName(name);
  const store = readProfilesStore();
  const profile = store.profiles[name];
  if (profile?.alias) removeAlias(profile.alias);
  delete store.profiles[name];
  writeProfilesStore(store);

  // Clean up keychain before removing directory (need configDir path)
  const configDir = path.join(PROFILES_DIR, name, "config");
  const hash = crypto.createHash("sha256").update(configDir).digest("hex").slice(0, 8);
  const service = `Claude Code-credentials-${hash}`;
  const username = os.userInfo().username;
  try {
    await execFileAsync("security", [
      "delete-generic-password", "-s", service, "-a", username,
    ]);
  } catch {
    // Entry may not exist
  }

  // Remove config directory
  const profileDir = path.join(PROFILES_DIR, name);
  if (fs.existsSync(profileDir)) {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Profile assembly
// ---------------------------------------------------------------------------

export function assembleProfile(profile: Profile): string {
  const configDir = path.join(PROFILES_DIR, profile.name, "config");

  // Create directory structure
  for (const sub of ["plugins/cache", "plugins/data", "plugins/marketplaces"]) {
    fs.mkdirSync(path.join(configDir, sub), { recursive: true });
  }

  // Read source manifest
  const sourceManifestPath = path.join(CLAUDE_HOME, "plugins", "installed_plugins.json");
  if (!fs.existsSync(sourceManifestPath)) {
    throw new Error("No plugins installed. Install at least one plugin in Claude Code before launching a profile.");
  }
  const manifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf-8"));

  // Filter to selected plugins
  const filteredPlugins: Record<string, any> = {};
  for (const [name, entries] of Object.entries(manifest.plugins ?? {})) {
    if (profile.plugins.includes(name)) {
      filteredPlugins[name] = entries;
    }
  }

  // Write filtered installed_plugins.json (debug plugin added after cache setup)
  const profileManifest = {
    version: manifest.version ?? 2,
    plugins: filteredPlugins,
  };
  fs.writeFileSync(
    path.join(configDir, "plugins", "installed_plugins.json"),
    JSON.stringify(profileManifest, null, 2)
  );

  // Build settings.json
  const sourceSettingsPath = path.join(CLAUDE_HOME, "settings.json");
  const source = fs.existsSync(sourceSettingsPath)
    ? JSON.parse(fs.readFileSync(sourceSettingsPath, "utf-8"))
    : {};

  // Start with safe keys from global settings
  const SAFE_KEYS = new Set(["env", "hooks", "statusLine", "voiceEnabled"]);
  const settings: Record<string, any> = {};
  for (const [k, v] of Object.entries(source)) {
    if (SAFE_KEYS.has(k)) settings[k] = v;
  }
  settings.enabledPlugins = Object.fromEntries(
    profile.plugins.map((name) => [name, true])
  );

  // Apply profile-specific overrides
  if (profile.model) {
    settings.model = profile.model;
  }
  if (profile.effortLevel) {
    settings.effortLevel = profile.effortLevel;
  }
  if (profile.voiceEnabled !== undefined) {
    settings.voiceEnabled = profile.voiceEnabled;
  }
  if (profile.env) {
    settings.env = { ...(settings.env ?? {}), ...profile.env };
  }
  if (profile.statusLine !== undefined) {
    if (profile.statusLine === null) {
      delete settings.statusLine;
    } else {
      settings.statusLine = profile.statusLine;
    }
  }

  // Copy permissions — keep plugin MCP permissions, strip standalone MCP permissions
  const sourcePerms = source.permissions;
  if (sourcePerms) {
    const allowed: string[] = sourcePerms.allow ?? [];
    settings.permissions = {
      ...sourcePerms,
      allow: allowed.filter((t: string) => {
        if (!t.startsWith("mcp__")) return true;
        if (t.startsWith("mcp__plugin_")) return true;
        return false;
      }),
    };
  }

  fs.writeFileSync(
    path.join(configDir, "settings.json"),
    JSON.stringify(settings, null, 2) + "\n"
  );

  // Handle per-profile CLAUDE.md
  const claudeMdTarget = path.join(configDir, "CLAUDE.md");
  if (profile.customClaudeMd) {
    // Write profile-specific CLAUDE.md (includes global via symlink reference)
    const globalClaudeMd = path.join(CLAUDE_HOME, "CLAUDE.md");
    let content = "";
    if (fs.existsSync(globalClaudeMd)) {
      content = fs.readFileSync(globalClaudeMd, "utf-8") + "\n\n";
    }
    content += "# Profile: " + profile.name + "\n\n" + profile.customClaudeMd;
    // Remove existing file/symlink before writing
    try { fs.unlinkSync(claudeMdTarget); } catch {}
    fs.writeFileSync(claudeMdTarget, content);
  } else {
    // Remove stale custom file so symlinkShared can create the global symlink
    try { fs.unlinkSync(claudeMdTarget); } catch {}
  }

  // Scan plugins once for cache setup and exclusions
  const installedPlugins = scanInstalledPlugins();

  // Symlink plugin caches
  symlinkSelectedCaches(profile, configDir, installedPlugins);

  // Apply skill-level exclusions
  applyExclusions(profile, configDir, installedPlugins);

  // Symlink shared resources
  symlinkShared(configDir);

  // Copy auto-skills (commands/skills/agents that ship with every profile)
  installAutoSkills(configDir);

  return configDir;
}

function symlinkSelectedCaches(profile: Profile, configDir: string, plugins: PluginEntry[]): void {
  const sourceCache = path.join(CLAUDE_HOME, "plugins", "cache");
  const targetCache = path.join(configDir, "plugins", "cache");

  // Clear existing symlinks and copied dirs
  if (fs.existsSync(targetCache)) {
    for (const entry of fs.readdirSync(targetCache)) {
      const full = path.join(targetCache, entry);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) fs.unlinkSync(full);
      else if (stat.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
    }
  }

  // Determine which marketplace dirs need symlinking
  const neededMarketplaces = new Set<string>();
  for (const p of plugins) {
    if (profile.plugins.includes(p.name)) {
      neededMarketplaces.add(p.marketplace);
    }
  }

  // Symlink marketplace directories
  for (const mp of neededMarketplaces) {
    const src = path.join(sourceCache, mp);
    const tgt = path.join(targetCache, mp);
    if (fs.existsSync(src) && !fs.existsSync(tgt)) {
      fs.symlinkSync(src, tgt);
    }
  }
}

function applyExclusions(profile: Profile, configDir: string, plugins: PluginEntry[]): void {
  if (!profile.excludedItems || Object.keys(profile.excludedItems).length === 0) return;
  for (const [pluginName, excludedNames] of Object.entries(profile.excludedItems)) {
    if (excludedNames.length === 0) continue;

    const plugin = plugins.find((p) => p.name === pluginName);
    if (!plugin) continue;

    const targetCache = path.join(configDir, "plugins", "cache");
    const marketplaceDir = path.join(targetCache, plugin.marketplace);
    if (!fs.existsSync(marketplaceDir)) continue;

    const stat = fs.lstatSync(marketplaceDir);
    if (stat.isSymbolicLink()) {
      // Replace marketplace symlink with a real directory containing
      // symlinks to each plugin within it
      const realMarketplace = fs.realpathSync(marketplaceDir);
      fs.unlinkSync(marketplaceDir);
      fs.mkdirSync(marketplaceDir, { recursive: true });

      for (const entry of fs.readdirSync(realMarketplace)) {
        const src = path.join(realMarketplace, entry);
        const tgt = path.join(marketplaceDir, entry);
        fs.symlinkSync(src, tgt);
      }
    }

    // Replace the specific plugin dir with a filtered copy
    const pluginDir = path.join(marketplaceDir, plugin.pluginName);
    if (!fs.existsSync(pluginDir)) continue;

    const pluginStat = fs.lstatSync(pluginDir);
    if (pluginStat.isSymbolicLink()) {
      const realPluginDir = fs.realpathSync(pluginDir);
      fs.unlinkSync(pluginDir);
      copyDirRecursive(realPluginDir, pluginDir);
    }

    // Delete excluded items from the copy
    const items = scanPluginItems(plugin);
    for (const item of items) {
      if (excludedNames.includes(item.name)) {
        const relativePath = path.relative(plugin.installPath, item.path);
        const copiedItemPath = path.join(
          marketplaceDir,
          plugin.pluginName,
          plugin.version,
          relativePath
        );
        if (fs.existsSync(copiedItemPath)) {
          if (item.type === "skill") {
            // Remove entire skill directory
            fs.rmSync(path.dirname(copiedItemPath), { recursive: true, force: true });
          } else {
            fs.unlinkSync(copiedItemPath);
          }
        }
      }
    }
  }
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function installAutoSkills(configDir: string): void {
  // Auto-skills source: check dev path first, then production path
  const devPath = path.join(__dirname, "..", "..", "src", "auto-skills");
  const prodPath = path.join(__dirname, "..", "auto-skills");
  const autoSkillsSrc = fs.existsSync(devPath) ? devPath : prodPath;
  if (!fs.existsSync(autoSkillsSrc)) return;

  // Copy each subdirectory (commands/, skills/, agents/) into the config dir
  for (const subdir of ["commands", "skills", "agents"]) {
    const srcDir = path.join(autoSkillsSrc, subdir);
    if (!fs.existsSync(srcDir)) continue;

    const tgtDir = path.join(configDir, subdir);
    fs.mkdirSync(tgtDir, { recursive: true });

    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const srcPath = path.join(srcDir, entry.name);
      const tgtPath = path.join(tgtDir, entry.name);

      // Remove existing so we always get the latest version
      if (fs.existsSync(tgtPath)) {
        fs.rmSync(tgtPath, { recursive: true, force: true });
      }

      if (entry.isDirectory()) {
        copyDirRecursive(srcPath, tgtPath);
      } else {
        fs.copyFileSync(srcPath, tgtPath);
      }
    }
  }
}

function symlinkShared(configDir: string): void {
  const shared: [string, string][] = [
    ["CLAUDE.md", "CLAUDE.md"],
    ["projects", "projects"],
  ];

  for (const [sourceName, targetName] of shared) {
    const src = path.join(CLAUDE_HOME, sourceName);
    const tgt = path.join(configDir, targetName);
    if (fs.existsSync(src) && !fs.existsSync(tgt)) {
      fs.symlinkSync(src, tgt);
    }
  }

  // Symlink plugin state files
  for (const file of ["known_marketplaces.json"]) {
    const src = path.join(CLAUDE_HOME, "plugins", file);
    const tgt = path.join(configDir, "plugins", file);
    if (fs.existsSync(src)) {
      if (fs.existsSync(tgt)) fs.unlinkSync(tgt);
      fs.symlinkSync(src, tgt);
    }
  }

  // Symlink other plugin state files
  for (const file of ["blocklist.json", "install-counts-cache.json"]) {
    const src = path.join(CLAUDE_HOME, "plugins", file);
    const tgt = path.join(configDir, "plugins", file);
    if (fs.existsSync(src)) {
      if (fs.existsSync(tgt)) fs.unlinkSync(tgt);
      fs.symlinkSync(src, tgt);
    }
  }

  // Symlink all marketplaces
  const sourceMp = path.join(CLAUDE_HOME, "plugins", "marketplaces");
  const targetMp = path.join(configDir, "plugins", "marketplaces");
  if (fs.existsSync(sourceMp)) {
    for (const entry of fs.readdirSync(sourceMp)) {
      const tgt = path.join(targetMp, entry);
      if (!fs.existsSync(tgt)) {
        fs.symlinkSync(path.join(sourceMp, entry), tgt);
      }
    }
  }

  // Symlink all data entries
  const sourceData = path.join(CLAUDE_HOME, "plugins", "data");
  const targetData = path.join(configDir, "plugins", "data");
  if (fs.existsSync(sourceData)) {
    for (const entry of fs.readdirSync(sourceData)) {
      const tgt = path.join(targetData, entry);
      if (!fs.existsSync(tgt)) {
        fs.symlinkSync(path.join(sourceData, entry), tgt);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export async function copyCredentials(profile: Profile): Promise<boolean> {
  const username = os.userInfo().username;
  const configDir = path.join(PROFILES_DIR, profile.name, "config");

  // Read default credentials
  let cred: string;
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password", "-s", "Claude Code-credentials", "-a", username, "-w",
    ]);
    cred = stdout.trim();
  } catch {
    return false;
  }

  // Write to profile's keychain entry
  const hash = crypto.createHash("sha256").update(configDir).digest("hex").slice(0, 8);
  const service = `Claude Code-credentials-${hash}`;

  try {
    try {
      await execFileAsync("security", [
        "delete-generic-password", "-s", service, "-a", username,
      ]);
    } catch {
      // Not found — fine
    }
    await execFileAsync("security", [
      "add-generic-password", "-s", service, "-a", username, "-w", cred,
    ]);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Plugin operations
// ---------------------------------------------------------------------------

export async function updatePlugin(pluginId: string): Promise<void> {
  await execFileAsync("claude", ["plugin", "update", pluginId]);
  _knownPluginNamesCache = null;
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  await execFileAsync("claude", ["plugin", "uninstall", pluginId]);
  _knownPluginNamesCache = null;
}

export async function checkPluginUpdates(): Promise<Record<string, string>> {
  const updates: Record<string, string> = {};

  try {
    const { stdout } = await execFileAsync("claude", [
      "plugin", "list", "--json", "--available",
    ]);
    const data = JSON.parse(stdout);
    const installed: Array<{ id: string; version: string }> = data.installed ?? [];
    const available: Array<{ pluginId: string; source?: { sha?: string } }> = data.available ?? [];

    // Build a set of available plugin IDs for quick lookup
    const availableIds = new Set(available.map((a) => a.pluginId));

    // A plugin might have an update if it's in the available list
    // and its installed version is "unknown" (git-based, always check)
    // or differs from what the marketplace offers
    for (const inst of installed) {
      if (availableIds.has(inst.id)) {
        // For git-based plugins (version "unknown"), always mark as potentially updatable
        if (inst.version === "unknown") {
          updates[inst.id] = "latest";
        }
      }
    }
  } catch {
    // CLI call failed — return empty (no updates detected)
  }

  return updates;
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

export async function launchProfile(profile: Profile, directory?: string): Promise<void> {
  const configDir = path.join(PROFILES_DIR, profile.name, "config");
  const workDir = directory ?? profile.directory ?? os.homedir();

  // Generate mcp.json so --strict-mcp-config uses the right set
  writeMcpConfig(profile, workDir, configDir);

  const mcpConfigPath = path.join(configDir, "mcp.json");

  // Build launch flags
  const flagParts: string[] = [];
  if (profile.launchFlags?.dangerouslySkipPermissions) flagParts.push("--dangerously-skip-permissions");
  if (profile.launchFlags?.verbose) flagParts.push("--verbose");
  if (profile.customFlags?.trim()) flagParts.push(profile.customFlags.trim());
  const flagStr = flagParts.length > 0 ? " " + flagParts.join(" ") : "";

  const script = [
    'tell application "iTerm2"',
    "  activate",
    "  if (count of windows) = 0 then",
    "    create window with default profile",
    "  else",
    "    tell current window",
    "      create tab with default profile",
    "    end tell",
    "  end if",
    "  tell current session of current window",
    `    write text "cd '${escSh(workDir)}' && CLAUDE_CONFIG_DIR='${escSh(configDir)}' claude --mcp-config '${escSh(mcpConfigPath)}' --strict-mcp-config${flagStr}"`,
    "  end tell",
    "end tell",
  ].join("\n");

  try {
    await execFileAsync("osascript", ["-e", script]);
  } catch (err: any) {
    const msg = String(err?.stderr ?? err?.message ?? "");
    if (msg.includes("iTerm2 got an error") || msg.includes("Application isn't running")) {
      throw new Error("iTerm2 is not running. Open iTerm2 and try again.");
    }
    if (msg.includes("Not authorized")) {
      throw new Error("macOS denied AppleScript access to iTerm2. Grant permission in System Settings > Privacy & Security > Automation.");
    }
    throw new Error(`Launch failed: ${msg || "Unknown AppleScript error"}`);
  }
}

// ---------------------------------------------------------------------------
// Team persistence
// ---------------------------------------------------------------------------

const TEAMS_JSON = path.join(PROFILES_DIR, "teams.json");

function readTeamsStore(): TeamsStore {
  if (!fs.existsSync(TEAMS_JSON)) return { teams: {} };
  return JSON.parse(fs.readFileSync(TEAMS_JSON, "utf-8"));
}

function writeTeamsStore(store: TeamsStore): void {
  ensureProfilesDir();
  const tmp = TEAMS_JSON + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
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

export function getTeamMergePreview(team: Team): MergePreview {
  const profiles = loadProfiles();
  const allPlugins = new Set<string>();
  const allMcps = new Set<string>();
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

    // Collect MCP servers
    if (profile.disabledMcpServers) {
      for (const dir of Object.keys(profile.disabledMcpServers)) {
        // MCPs are directory-scoped; just note them
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

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

function cleanDescription(desc: string): string {
  // Remove surrounding quotes and trim
  let d = desc.trim();
  if ((d.startsWith('"') && d.endsWith('"')) || (d.startsWith("'") && d.endsWith("'"))) {
    d = d.slice(1, -1);
  }
  // Collapse multiline YAML (pipe format leaves newlines)
  d = d.replace(/\s+/g, " ").trim();
  // Truncate very long descriptions
  if (d.length > 200) d = d.slice(0, 197) + "...";
  return d;
}

function readFrontmatter(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  if (!lines[0] || lines[0].trim() !== "---") return result;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") break;
    const colonIdx = lines[i].indexOf(":");
    if (colonIdx !== -1) {
      const key = lines[i].slice(0, colonIdx).trim();
      const value = lines[i].slice(colonIdx + 1).trim();
      result[key] = value;
    }
  }
  return result;
}
