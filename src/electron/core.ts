import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { execFileSync, execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
import { generateTeamMd, generateStartTeamCommand } from "./team-templates";
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
  TeamMember,
  TeamsStore,
  MergePreview,
  AnalyticsData,
  ActiveSession,
  LaunchOptions,
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
  const result: PluginWithItems[] = plugins.map((p) => ({
    ...p,
    items: scanPluginItems(p),
    hooks: scanPluginHooks(p),
    mcpServers: scanPluginMcpServers(p),
  }));

  // Inject synthetic local plugins for user-installed add-ons
  result.push(...scanUserLocalPlugins());

  return result;
}

/** Check which plugins in a profile are no longer installed globally. */
export function checkProfileHealth(profile: Profile): string[] {
  const installed = new Set(scanInstalledPlugins().map((p) => p.name));
  const localPluginNames = new Set(scanUserLocalPlugins().map((p) => p.name));
  return profile.plugins.filter((name) => !installed.has(name) && !localPluginNames.has(name));
}

/** Check health for all profiles at once (avoids repeated plugin scans). */
export function checkAllProfileHealth(profiles: Profile[]): Record<string, string[]> {
  const installed = new Set(scanInstalledPlugins().map((p) => p.name));
  const localPluginNames = new Set(scanUserLocalPlugins().map((p) => p.name));
  const result: Record<string, string[]> = {};
  for (const profile of profiles) {
    const broken = profile.plugins.filter((name) => !installed.has(name) && !localPluginNames.has(name));
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

/** Prefix for all synthetic local plugin names. */
const LOCAL_PLUGIN_PREFIX = "local:";
const FRAMEWORK_PLUGIN_PREFIX = "framework:";

/** Check if a plugin name is a synthetic local plugin. */
export function isLocalPlugin(name: string): boolean {
  return name.startsWith(LOCAL_PLUGIN_PREFIX);
}

/** Check if a plugin name is a framework plugin. */
export function isFrameworkPlugin(name: string): boolean {
  return name.startsWith(FRAMEWORK_PLUGIN_PREFIX);
}

/** Check if GSD is installed globally. */
export function isGsdInstalled(): boolean {
  const claudeHome = path.join(os.homedir(), ".claude");
  return (
    fs.existsSync(path.join(claudeHome, "get-shit-done")) ||
    fs.existsSync(path.join(claudeHome, "gsd-file-manifest.json"))
  );
}


/**
 * Scan ~/.claude/ for user-installed local skills, agents, and commands.
 * Returns grouped synthetic PluginWithItems[] — each skill and command namespace
 * becomes its own plugin; loose commands and agents get catch-all plugins.
 */
export function scanUserLocalPlugins(): PluginWithItems[] {
  const claudeHome = path.join(os.homedir(), ".claude");
  const plugins: PluginWithItems[] = [];

  const makePlugin = (name: string, items: PluginItem[]): PluginWithItems => ({
    name: `${LOCAL_PLUGIN_PREFIX}${name}`,
    scope: "user",
    installPath: claudeHome,
    version: "local",
    marketplace: "local",
    pluginName: name,
    items,
    hooks: [],
    mcpServers: [],
  });

  const gsdDetected = isGsdInstalled();
  const GSD_PLUGIN_NAME = `${FRAMEWORK_PLUGIN_PREFIX}gsd`;
  const gsdItems: PluginItem[] = [];


  // Skills: each skill directory → its own plugin (GSD skills → framework:gsd)
  const skillsDir = path.join(claudeHome, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(path.join(skillsDir, entry.name)).isDirectory());
      if (!isDir) continue;
      const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      const fm = readFrontmatter(skillMd);
      const skillName = fm.name ?? entry.name;
      const pluginName = entry.name;

      if (gsdDetected && entry.name.startsWith("gsd-")) {
        gsdItems.push({
          name: skillName,
          description: fm.description ?? "",
          type: "skill",
          plugin: GSD_PLUGIN_NAME,
          path: skillMd,
          userInvocable: true,
          dependencies: [],
        });
      } else {
        plugins.push(makePlugin(pluginName, [{
          name: skillName,
          description: fm.description ?? "",
          type: "skill",
          plugin: `${LOCAL_PLUGIN_PREFIX}${pluginName}`,
          path: skillMd,
          userInvocable: true,
          dependencies: [],
        }]));
      }
    }
  }

  // Commands: each namespace dir → its own plugin; loose .md files → "commands" plugin
  // GSD commands (gsd/ namespace) → framework:gsd
  const cmdsDir = path.join(claudeHome, "commands");
  if (fs.existsSync(cmdsDir)) {
    const looseCommands: PluginItem[] = [];

    for (const entry of fs.readdirSync(cmdsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const subDir = path.join(cmdsDir, entry.name);
        const isGsdNamespace = gsdDetected && entry.name === "gsd";
        const items: PluginItem[] = [];
        for (const file of fs.readdirSync(subDir)) {
          if (!file.endsWith(".md")) continue;
          const cmdPath = path.join(subDir, file);
          const fm = readFrontmatter(cmdPath);
          items.push({
            name: fm.name ?? `${entry.name}:${path.basename(file, ".md")}`,
            description: fm.description ?? "",
            type: "command",
            plugin: isGsdNamespace ? GSD_PLUGIN_NAME : `${LOCAL_PLUGIN_PREFIX}${entry.name}`,
            path: cmdPath,
            userInvocable: true,
            dependencies: [],
          });
        }
        if (isGsdNamespace) {
          gsdItems.push(...items);
        } else if (items.length > 0) {
          plugins.push(makePlugin(entry.name, items));
        }
      } else if (entry.name.endsWith(".md")) {
        const cmdPath = path.join(cmdsDir, entry.name);
        const fm = readFrontmatter(cmdPath);
        looseCommands.push({
          name: fm.name ?? path.basename(entry.name, ".md"),
          description: fm.description ?? "",
          type: "command",
          plugin: `${LOCAL_PLUGIN_PREFIX}commands`,
          path: cmdPath,
          userInvocable: true,
          dependencies: [],
        });
      }
    }

    if (looseCommands.length > 0) {
      plugins.push(makePlugin("commands", looseCommands));
    }
  }

  // Agents: non-GSD → "agents" plugin, GSD agents → framework:gsd
  const agentsDir = path.join(claudeHome, "agents");
  if (fs.existsSync(agentsDir)) {
    const items: PluginItem[] = [];
    for (const file of fs.readdirSync(agentsDir)) {
      if (!file.endsWith(".md") || file === "README.md") continue;
      const agentPath = path.join(agentsDir, file);
      const fm = readFrontmatter(agentPath);
      const isGsdAgent = gsdDetected && file.startsWith("gsd-");
      const item: PluginItem = {
        name: fm.name ?? path.basename(file, ".md"),
        description: fm.description ?? "",
        type: "agent",
        plugin: isGsdAgent ? GSD_PLUGIN_NAME : `${LOCAL_PLUGIN_PREFIX}agents`,
        path: agentPath,
        userInvocable: false,
        dependencies: [],
      };
      if (isGsdAgent) {
        gsdItems.push(item);
      } else {
        items.push(item);
      }
    }
    if (items.length > 0) {
      plugins.push(makePlugin("agents", items));
    }
  }

  // Build GSD framework plugin if detected
  if (gsdDetected && gsdItems.length > 0) {
    // Extract GSD hooks from global settings.json
    const gsdHooks: PluginHook[] = [];
    const settingsPath = path.join(claudeHome, "settings.json");
    if (fs.existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        for (const [event, matchers] of Object.entries(settings.hooks ?? {} as Record<string, any[]>)) {
          for (const matcher of matchers as any[]) {
            for (const hook of matcher.hooks ?? []) {
              const cmd: string = hook.command ?? "";
              if (cmd.includes("gsd-")) {
                gsdHooks.push({ event, command: cmd });
              }
            }
          }
        }
      } catch {}
    }

    plugins.push({
      name: GSD_PLUGIN_NAME,
      scope: "user",
      installPath: path.join(claudeHome, "get-shit-done"),
      version: "local",
      marketplace: "framework",
      pluginName: "Get Shit Done",
      items: gsdItems,
      hooks: gsdHooks,
      mcpServers: [],
    });
  }

  return plugins;
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
  return Object.values(store.profiles).filter((p) => !p.name.startsWith("_team_"));
}

/**
 * Ensure a default profile exists. If none has `isDefault: true`,
 * create an empty "Default" profile. Called on app startup.
 */
export function ensureDefaultProfile(): void {
  const store = readProfilesStore();
  const hasDefault = Object.values(store.profiles).some((p) => p.isDefault);
  if (hasDefault) return;

  const profile: Profile = {
    name: "Default",
    plugins: [],
    excludedItems: {},
    description: "Your default profile. Running `claude` launches with these plugins and settings.",
    isDefault: true,
    alias: "claude",
    useDefaultAuth: true,
  };

  // Avoid name collision — if "Default" already exists and isn't default, pick a unique name
  if (store.profiles["Default"]) {
    let suffix = 2;
    while (store.profiles[`Default-${suffix}`]) suffix++;
    profile.name = `Default-${suffix}`;
  }

  store.profiles[profile.name] = profile;
  writeProfilesStore(store);
  assembleProfile(profile);
  generateAlias(profile);

  // Ensure PATH is set up
  const binDir = path.join(PROFILES_DIR, "bin");
  const shell = process.env.SHELL ?? "/bin/zsh";
  const rcFile = shell.includes("zsh")
    ? path.join(os.homedir(), ".zshrc")
    : path.join(os.homedir(), ".bashrc");
  const existingRc = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, "utf-8") : "";
  if (!existingRc.includes(binDir)) {
    fs.appendFileSync(rcFile, `\nexport PATH="${binDir}:$PATH"\n`);
  }
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

  // Cascade rename to team member references
  if (profile.name !== oldName) {
    const teamsStore = readTeamsStore();
    let teamsChanged = false;
    for (const team of Object.values(teamsStore.teams)) {
      for (const member of team.members) {
        if (member.profile === oldName) {
          member.profile = profile.name;
          teamsChanged = true;
        }
      }
    }
    if (teamsChanged) writeTeamsStore(teamsStore);
  }

  return profile;
}

export function saveProfile(profile: Profile): Profile {
  validateProfileName(profile.name);
  const store = readProfilesStore();
  const existing = store.profiles[profile.name];
  if (existing?.alias && existing.alias !== profile.alias) {
    removeAlias(existing.alias);
  }

  // Enforce single-default invariant
  if (profile.isDefault) {
    profile.alias = "claude"; // default always owns the `claude` alias
    for (const p of Object.values(store.profiles)) {
      if (p.name !== profile.name && p.isDefault) {
        p.isDefault = undefined;
        // If the old default had alias "claude", remove it
        if (p.alias === "claude") {
          removeAlias("claude");
          p.alias = undefined;
        }
      }
    }
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

/**
 * Find the real `claude` binary by walking PATH entries, skipping the
 * profiles bin directory so an alias named "claude" doesn't shadow itself.
 */
export function findRealClaudeBinary(): string {
  const profilesBin = path.join(PROFILES_DIR, "bin");
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter);
  for (const dir of pathDirs) {
    if (path.resolve(dir) === profilesBin) continue;
    const candidate = path.join(dir, "claude");
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("Could not find the claude binary in PATH. Is Claude Code installed?");
}

function generateAlias(profile: Profile): void {
  const binDir = path.join(PROFILES_DIR, "bin");
  fs.mkdirSync(binDir, { recursive: true });

  const configDir = path.join(PROFILES_DIR, profile.name, "config");
  const workDir = profile.directory ?? "$PWD";
  const claudeBin = findRealClaudeBinary();

  // Write the MCP regeneration helper (shared by all alias scripts)
  writeMcpHelper(binDir);

  const script = `#!/bin/bash
# Generated by Claude Profiles — do not edit
# Profile: ${profile.name}
WORK_DIR="${workDir === "$PWD" ? "$PWD" : escSh(workDir)}"
node '${escSh(path.join(binDir, ".regenerate-mcp.js"))}' '${escSh(profile.name)}' "$WORK_DIR" && CLAUDE_CONFIG_DIR='${escSh(configDir)}' '${escSh(claudeBin)}' --mcp-config '${escSh(configDir)}/mcp.json' --strict-mcp-config "$@"
`;

  const scriptPath = path.join(binDir, profile.alias!);
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
}

/**
 * Write a small Node.js helper script that regenerates mcp.json for a profile.
 * Called by alias scripts at runtime so project-specific MCPs are included.
 */
function writeMcpHelper(binDir: string): void {
  const helperPath = path.join(binDir, ".regenerate-mcp.js");
  // The helper is a standalone script — it re-implements the MCP merge logic
  // using only Node.js built-ins so it has no external dependencies.
  const helper = `#!/usr/bin/env node
// Generated by Claude Profiles — do not edit
// Regenerates mcp.json for a profile before CLI launch.
const fs = require("fs");
const path = require("path");
const os = require("os");

const profileName = process.argv[2];
const workDir = process.argv[3] || process.cwd();
if (!profileName) { console.error("Usage: regenerate-mcp.js <profileName> <workDir>"); process.exit(1); }

const PROFILES_DIR = path.join(os.homedir(), ".claude-profiles");
const store = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, "profiles.json"), "utf-8"));
const profile = store.profiles[profileName];
if (!profile) { console.error("Profile not found:", profileName); process.exit(1); }

const configDir = path.join(PROFILES_DIR, profileName, "config");
const mcpServers = {};

// Read a .mcp.json file (flat or wrapped format)
function readMcpJson(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return data.mcpServers ?? data;
  } catch { return {}; }
}

// 1. Plugin MCPs
const CLAUDE_HOME = path.join(os.homedir(), ".claude");
const manifestPath = path.join(CLAUDE_HOME, "plugins", "installed_plugins.json");
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  for (const pluginName of profile.plugins || []) {
    const entries = manifest.plugins?.[pluginName];
    if (!entries) continue;
    for (const entry of entries) {
      const mcpPath = path.join(entry.installPath, ".mcp.json");
      if (fs.existsSync(mcpPath)) Object.assign(mcpServers, readMcpJson(mcpPath));
    }
  }
}

const disabled = profile.disabledMcpServers?.[workDir] ?? [];

// 2. User-level and project MCPs from ~/.claude.json
const claudeJsonPath = path.join(os.homedir(), ".claude.json");
if (fs.existsSync(claudeJsonPath)) {
  try {
    const data = JSON.parse(fs.readFileSync(claudeJsonPath, "utf-8"));
    // User-level MCPs (always included)
    for (const [name, config] of Object.entries(data.mcpServers ?? {})) {
      mcpServers[name] = config;
    }
    // Project MCPs (filtered by disabled list)
    for (const [name, config] of Object.entries(data.projects?.[workDir]?.mcpServers ?? {})) {
      if (!disabled.includes(name)) mcpServers[name] = config;
    }
  } catch {}
}

// 3. Local .mcp.json in the working directory (filtered)
const localMcpPath = path.join(workDir, ".mcp.json");
if (fs.existsSync(localMcpPath)) {
  for (const [name, config] of Object.entries(readMcpJson(localMcpPath))) {
    if (!disabled.includes(name)) mcpServers[name] = config;
  }
}

// Write mcp.json
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(path.join(configDir, "mcp.json"), JSON.stringify({ mcpServers }, null, 2) + "\\n");

// --- Credential sync (target-first, then freshest candidate) ---
if (profile.useDefaultAuth !== false) {
  const { execFileSync } = require("child_process");
  const crypto = require("crypto");
  const username = os.userInfo().username;
  const SAFETY = 5 * 60 * 1000;

  function svcHash(dir) {
    return "Claude Code-credentials-" + crypto.createHash("sha256").update(dir).digest("hex").substring(0, 8);
  }

  function readEntry(svc) {
    try {
      const raw = execFileSync("security", ["find-generic-password", "-s", svc, "-a", username, "-w"], { encoding: "utf-8", timeout: 5000 }).trim();
      const parsed = JSON.parse(raw);
      let oauth = parsed.claudeAiOauth;
      if (typeof oauth === "string") oauth = JSON.parse(oauth);
      if (!oauth || !oauth.accessToken || !oauth.refreshToken || typeof oauth.expiresAt !== "number") return null;
      return { raw, expiresAt: oauth.expiresAt };
    } catch { return null; }
  }

  const targetSvc = svcHash(configDir);
  const target = readEntry(targetSvc);

  if (!target || target.expiresAt <= Date.now() + SAFETY) {
    // Scan for freshest valid candidate
    const candidates = [];
    const defaultEntry = readEntry("Claude Code-credentials");
    if (defaultEntry) candidates.push(defaultEntry);

    for (const [pName, pData] of Object.entries(store.profiles)) {
      if (pData.useDefaultAuth === false) continue;
      const pDir = path.join(PROFILES_DIR, pName, "config");
      const pSvc = svcHash(pDir);
      if (pSvc === targetSvc) continue;
      const entry = readEntry(pSvc);
      if (entry) candidates.push(entry);
    }

    // Only overwrite with a genuinely fresh (non-expired) candidate.
    // If all candidates are expired, keep the target's own entry — its refresh
    // token is unique (OAuth rotation) and likely still valid server-side.
    const now = Date.now();
    const valid = candidates.filter(c => c.expiresAt > now);
    if (valid.length > 0) {
      valid.sort((a, b) => b.expiresAt - a.expiresAt);
      const backup = target ? target.raw : null;
      try {
        try { execFileSync("security", ["delete-generic-password", "-s", targetSvc, "-a", username], { stdio: "ignore" }); } catch {}
        execFileSync("security", ["add-generic-password", "-s", targetSvc, "-a", username, "-w", valid[0].raw]);
      } catch {
        if (backup) {
          try { execFileSync("security", ["add-generic-password", "-s", targetSvc, "-a", username, "-w", backup]); } catch {}
        }
      }
    } else if (!target && candidates.length > 0) {
      // No target entry at all (fresh alias) — seed from freshest expired
      candidates.sort((a, b) => b.expiresAt - a.expiresAt);
      try {
        execFileSync("security", ["add-generic-password", "-s", targetSvc, "-a", username, "-w", candidates[0].raw]);
      } catch {}
    }
  }
}
`;
  fs.writeFileSync(helperPath, helper, { mode: 0o755 });
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

  // Clean stale GSD artifacts when framework:gsd is not enabled
  if (!profile.plugins.includes(`${FRAMEWORK_PLUGIN_PREFIX}gsd`)) {
    // Remove GSD agents
    const agentsDir = path.join(configDir, "agents");
    if (fs.existsSync(agentsDir)) {
      for (const f of fs.readdirSync(agentsDir)) {
        if (f.startsWith("gsd-")) {
          const full = path.join(agentsDir, f);
          try { fs.unlinkSync(full); } catch {}
        }
      }
    }
    // Remove GSD commands namespace
    const gsdCmdsDir = path.join(configDir, "commands", "gsd");
    if (fs.existsSync(gsdCmdsDir)) {
      fs.rmSync(gsdCmdsDir, { recursive: true });
    }
    // Remove GSD runtime dir
    const gsdRuntime = path.join(configDir, "get-shit-done");
    if (fs.existsSync(gsdRuntime)) {
      const stat = fs.lstatSync(gsdRuntime);
      if (stat.isSymbolicLink()) fs.unlinkSync(gsdRuntime);
      else fs.rmSync(gsdRuntime, { recursive: true });
    }
    // Remove GSD hooks
    const hooksDir = path.join(configDir, "hooks");
    if (fs.existsSync(hooksDir)) {
      for (const f of fs.readdirSync(hooksDir)) {
        if (f.startsWith("gsd-")) {
          const full = path.join(hooksDir, f);
          try { fs.unlinkSync(full); } catch {}
        }
      }
    }
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
  // Filter disabled hooks per-profile
  if (settings.hooks && profile.disabledHooks && Object.keys(profile.disabledHooks).length > 0) {
    const filtered: Record<string, any[]> = {};
    for (const [event, matchers] of Object.entries(settings.hooks as Record<string, any[]>)) {
      const disabledIndices = new Set(profile.disabledHooks[event] ?? []);
      if (disabledIndices.size === 0) {
        filtered[event] = matchers;
      } else {
        const kept = matchers.filter((_: any, i: number) => !disabledIndices.has(i));
        if (kept.length > 0) filtered[event] = kept;
      }
    }
    settings.hooks = Object.keys(filtered).length > 0 ? filtered : undefined;
  }

  // Strip GSD hooks if framework:gsd is not enabled
  if (!profile.plugins.includes(`${FRAMEWORK_PLUGIN_PREFIX}gsd`) && settings.hooks) {
    const stripped: Record<string, any[]> = {};
    for (const [event, matchers] of Object.entries(settings.hooks as Record<string, any[]>)) {
      const kept = matchers.filter((m: any) => {
        const hooks = m.hooks ?? [];
        const nonGsd = hooks.filter((h: any) => !String(h.command ?? "").includes("gsd-"));
        if (nonGsd.length === 0) return false;
        m.hooks = nonGsd;
        return true;
      });
      if (kept.length > 0) stripped[event] = kept;
    }
    settings.hooks = Object.keys(stripped).length > 0 ? stripped : undefined;
  }

  settings.enabledPlugins = Object.fromEntries(
    profile.plugins.map((name) => [name, true])
  );

  // Apply profile-specific overrides, falling back to global defaults
  const globalDefaults = getGlobalDefaults();
  if (profile.model) {
    settings.model = profile.model;
  } else if (globalDefaults.model) {
    settings.model = globalDefaults.model;
  }
  if (profile.effortLevel) {
    settings.effortLevel = profile.effortLevel;
  } else if (globalDefaults.effortLevel) {
    settings.effortLevel = globalDefaults.effortLevel;
  }
  if (profile.voiceEnabled !== undefined) {
    settings.voiceEnabled = profile.voiceEnabled;
  }
  // Apply global env defaults, then profile-specific overrides
  if (globalDefaults.env && Object.keys(globalDefaults.env).length > 0) {
    settings.env = { ...(settings.env ?? {}), ...globalDefaults.env };
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

  // Rewrite installPath for plugins with exclusions so Claude Code reads the patched manifest
  if (profile.excludedItems && Object.keys(profile.excludedItems).length > 0) {
    const manifestPath = path.join(configDir, "plugins", "installed_plugins.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      for (const [pluginName, entries] of Object.entries(manifest.plugins ?? {})) {
        if (!(profile.excludedItems[pluginName]?.length > 0)) continue;
        const plugin = installedPlugins.find((p) => p.name === pluginName);
        if (!plugin) continue;
        const copiedPath = path.join(configDir, "plugins", "cache", plugin.marketplace, plugin.pluginName, plugin.version);
        if (fs.existsSync(copiedPath)) {
          for (const entry of entries as any[]) {
            entry.installPath = copiedPath;
          }
        }
      }
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
  }

  // Symlink shared resources
  symlinkShared(configDir, profile);

  // Copy auto-skills (commands/skills/agents that ship with every profile)
  installAutoSkills(configDir);

  // Generate baseline mcp.json for CLI alias usage.
  // Launch through the app regenerates this with the actual working directory.
  const baselineDir = profile.directory ?? os.homedir();
  writeMcpConfig(profile, baselineDir, configDir);

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
            fs.rmSync(path.dirname(copiedItemPath), { recursive: true, force: true });
          } else {
            fs.unlinkSync(copiedItemPath);
          }
        }
      }
    }

    // Patch marketplace.json to remove excluded skill/agent/command paths
    const copiedPluginDir = path.join(marketplaceDir, plugin.pluginName, plugin.version);
    const marketplaceJsonPath = path.join(copiedPluginDir, ".claude-plugin", "marketplace.json");
    if (fs.existsSync(marketplaceJsonPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(marketplaceJsonPath, "utf-8"));
        for (const p of manifest.plugins ?? []) {
          for (const key of ["skills", "agents", "commands"]) {
            if (Array.isArray(p[key])) {
              p[key] = p[key].filter((itemPath: string) => {
                const itemName = itemPath.split("/").pop() ?? "";
                return !excludedNames.includes(itemName);
              });
            }
          }
        }
        fs.writeFileSync(marketplaceJsonPath, JSON.stringify(manifest, null, 2));
      } catch {}
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

function symlinkShared(configDir: string, profile: Profile): void {
  // Copy ~/.claude.json into profile config dir to seed auth + onboarding state.
  // Claude Code reads $CLAUDE_CONFIG_DIR/.claude.json instead of ~/.claude.json
  // when CLAUDE_CONFIG_DIR is set. This is a copy (not symlink) because Claude
  // writes to this file during sessions.
  // Skip when useDefaultAuth is false — the user wants separate credentials.
  const homeClaudeJson = path.join(os.homedir(), ".claude.json");
  const profileClaudeJson = path.join(configDir, ".claude.json");
  if (profile.useDefaultAuth !== false) {
    // Always overwrite — the profile may have stale auth from a previous toggle-off
    if (fs.existsSync(homeClaudeJson)) {
      fs.copyFileSync(homeClaudeJson, profileClaudeJson);
    }
  } else {
    // Remove copied auth state so the profile gets its own credentials on next launch
    if (fs.existsSync(profileClaudeJson)) {
      fs.unlinkSync(profileClaudeJson);
    }
  }

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

  // Symlink user-level local add-ons and framework plugins.
  const enabledLocalOrFramework = profile.plugins.filter(
    (n) => isLocalPlugin(n) || isFrameworkPlugin(n)
  );
  if (enabledLocalOrFramework.length > 0) {
    const localPlugins = scanUserLocalPlugins();

    for (const lp of localPlugins) {
      if (!enabledLocalOrFramework.includes(lp.name)) continue;
      const excluded = new Set(profile.excludedItems?.[lp.name] ?? []);

      for (const item of lp.items) {
        if (excluded.has(item.name)) continue;

        if (item.type === "skill") {
          const skillDir = path.dirname(item.path);
          const tgtDir = path.join(configDir, "skills", path.basename(skillDir));
          fs.mkdirSync(path.join(configDir, "skills"), { recursive: true });
          if (!fs.existsSync(tgtDir)) fs.symlinkSync(skillDir, tgtDir);
        } else if (item.type === "agent") {
          const tgt = path.join(configDir, "agents", path.basename(item.path));
          fs.mkdirSync(path.join(configDir, "agents"), { recursive: true });
          if (!fs.existsSync(tgt)) fs.symlinkSync(item.path, tgt);
        } else if (item.type === "command") {
          const sourceCommands = path.join(CLAUDE_HOME, "commands");
          const targetCommands = path.join(configDir, "commands");
          fs.mkdirSync(targetCommands, { recursive: true });
          const relPath = path.relative(sourceCommands, item.path);
          const parts = relPath.split(path.sep);
          if (parts.length === 2) {
            const nsDir = path.join(sourceCommands, parts[0]);
            const tgt = path.join(targetCommands, parts[0]);
            if (!fs.existsSync(tgt)) fs.symlinkSync(nsDir, tgt);
          } else {
            const tgt = path.join(targetCommands, path.basename(item.path));
            if (!fs.existsSync(tgt)) fs.symlinkSync(item.path, tgt);
          }
        }
      }
    }
  }

  // Symlink GSD runtime directory and hooks if framework:gsd is enabled
  if (profile.plugins.includes(`${FRAMEWORK_PLUGIN_PREFIX}gsd`)) {
    const gsdRuntime = path.join(CLAUDE_HOME, "get-shit-done");
    const gsdTgt = path.join(configDir, "get-shit-done");
    if (fs.existsSync(gsdRuntime) && !fs.existsSync(gsdTgt)) {
      fs.symlinkSync(gsdRuntime, gsdTgt);
    }

    // Symlink GSD hook scripts
    const hooksSource = path.join(CLAUDE_HOME, "hooks");
    if (fs.existsSync(hooksSource)) {
      const hooksDest = path.join(configDir, "hooks");
      fs.mkdirSync(hooksDest, { recursive: true });
      for (const file of fs.readdirSync(hooksSource)) {
        if (!file.startsWith("gsd-")) continue;
        const tgt = path.join(hooksDest, file);
        if (!fs.existsSync(tgt)) {
          fs.symlinkSync(path.join(hooksSource, file), tgt);
        }
      }
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

interface OAuthCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** Compute the keychain service name for a given config directory. */
export function keychainServiceForConfigDir(configDir: string): string {
  const hash = crypto.createHash("sha256").update(configDir).digest("hex").slice(0, 8);
  return `Claude Code-credentials-${hash}`;
}

const KEYCHAIN_USERNAME = os.userInfo().username;
const DEFAULT_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CREDENTIAL_FRESHNESS_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Read and parse a keychain entry. Returns { raw, parsed, expiresAt } or null.
 * Handles claudeAiOauth being either a JSON string or an already-parsed object.
 */
async function readKeychainEntry(
  service: string
): Promise<{ raw: string; parsed: OAuthCredential; expiresAt: number } | null> {
  let raw: string;
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password", "-s", service, "-a", KEYCHAIN_USERNAME, "-w",
    ]);
    raw = stdout.trim();
  } catch {
    return null;
  }

  try {
    const blob = JSON.parse(raw);
    let oauth = blob.claudeAiOauth;
    if (typeof oauth === "string") {
      oauth = JSON.parse(oauth);
    }
    if (
      !oauth ||
      typeof oauth.accessToken !== "string" ||
      typeof oauth.refreshToken !== "string" ||
      typeof oauth.expiresAt !== "number"
    ) {
      return null;
    }
    return { raw, parsed: oauth as OAuthCredential, expiresAt: oauth.expiresAt };
  } catch {
    return null;
  }
}

/** Delete-then-add a keychain entry (macOS security CLI has no update). */
async function writeKeychainEntry(service: string, raw: string): Promise<void> {
  try {
    await execFileAsync("security", [
      "delete-generic-password", "-s", service, "-a", KEYCHAIN_USERNAME,
    ]);
  } catch {
    // Not found — fine
  }
  await execFileAsync("security", [
    "add-generic-password", "-s", service, "-a", KEYCHAIN_USERNAME, "-w", raw,
  ]);
}

/**
 * Sync credentials for a profile.
 *
 * Modes:
 *  - "rename"  — migrate credentials from oldConfigDir hash to new hash
 *  - "launch"  — use target's own entry if still fresh; otherwise scan for freshest
 *  - "seed"    — always scan for freshest (new profile, no existing entry)
 *
 * Returns true if valid credentials are in place, false if none found (Claude
 * Code will handle its own login flow).
 */
export async function syncCredentials(
  profile: Profile,
  mode: "rename" | "launch" | "seed",
  oldConfigDir?: string
): Promise<boolean> {
  const configDir = path.join(PROFILES_DIR, profile.name, "config");
  const targetService = keychainServiceForConfigDir(configDir);

  // --- rename: move old entry → new entry, delete old ---
  if (mode === "rename") {
    if (!oldConfigDir) return false;
    const oldService = keychainServiceForConfigDir(oldConfigDir);
    const entry = await readKeychainEntry(oldService);
    if (!entry) return false;
    try {
      await writeKeychainEntry(targetService, entry.raw);
      // Clean up old entry
      try {
        await execFileAsync("security", [
          "delete-generic-password", "-s", oldService, "-a", KEYCHAIN_USERNAME,
        ]);
      } catch {
        // Already gone — fine
      }
      return true;
    } catch {
      return false;
    }
  }

  // --- launch: check target's own entry first ---
  if (mode === "launch") {
    const own = await readKeychainEntry(targetService);
    if (own && own.expiresAt > Date.now() + CREDENTIAL_FRESHNESS_BUFFER_MS) {
      return true; // Still fresh, no-op
    }
    // Fall through to scan for a fresh candidate.
    // If no fresh candidate exists, keep the profile's own entry — its refresh
    // token is unique (OAuth token rotation) and likely still valid server-side.
    // Overwriting with another profile's expired entry would replace a valid
    // refresh token with one that was already rotated/invalidated.
  }

  // --- seed / launch-fallthrough: scan all entries for freshest ---
  const candidates: Array<{ raw: string; expiresAt: number }> = [];

  // Default entry
  const defaultEntry = await readKeychainEntry(DEFAULT_KEYCHAIN_SERVICE);
  if (defaultEntry) {
    candidates.push({ raw: defaultEntry.raw, expiresAt: defaultEntry.expiresAt });
  }

  // All profile entries where useDefaultAuth !== false (read in parallel)
  const allProfiles = loadProfiles();
  const profileEntries = await Promise.all(
    allProfiles
      .filter((p) => p.useDefaultAuth !== false)
      .map((p) => {
        const pConfigDir = path.join(PROFILES_DIR, p.name, "config");
        const pService = keychainServiceForConfigDir(pConfigDir);
        if (pService === targetService) return null; // skip self
        return readKeychainEntry(pService);
      })
      .filter(Boolean) as Array<Promise<Awaited<ReturnType<typeof readKeychainEntry>>>>
  );
  for (const entry of profileEntries) {
    if (entry) candidates.push({ raw: entry.raw, expiresAt: entry.expiresAt });
  }

  if (candidates.length === 0) {
    // No candidates at all — profile keeps whatever it has (or nothing)
    return mode === "launch" && (await readKeychainEntry(targetService)) !== null;
  }

  const now = Date.now();
  const valid = candidates.filter((c) => c.expiresAt > now);

  if (valid.length === 0 && mode === "launch") {
    // All candidates expired — don't overwrite. Each profile's refresh token is
    // unique due to OAuth token rotation; replacing it with another profile's
    // expired (and likely server-invalidated) token causes unnecessary re-login.
    // Let Claude Code attempt its own refresh with the profile's existing token.
    return (await readKeychainEntry(targetService)) !== null;
  }

  // For "seed" mode with all expired, fall back to freshest expired — a new
  // profile has no entry, so any token (with a possibly-valid refresh) is
  // better than nothing.
  const pool = valid.length > 0 ? valid : candidates;
  pool.sort((a, b) => b.expiresAt - a.expiresAt);
  const best = pool[0];

  try {
    await writeKeychainEntry(targetService, best.raw);
    return true;
  } catch {
    return false;
  }
}

export async function checkCredentialStatus(): Promise<{
  global: boolean;
  globalExpired: boolean;
  profiles: Array<{ name: string; useDefaultAuth: boolean; hasCredentials: boolean; isExpired: boolean }>;
}> {
  // Check global credentials
  const globalEntry = await readKeychainEntry(DEFAULT_KEYCHAIN_SERVICE);
  const globalOk = globalEntry !== null;
  const globalExpired = globalOk && globalEntry!.expiresAt <= Date.now();

  // Check each profile
  const profiles = loadProfiles();
  const now = Date.now();
  const results: Array<{ name: string; useDefaultAuth: boolean; hasCredentials: boolean; isExpired: boolean }> = [];
  for (const profile of profiles) {
    const configDir = path.join(PROFILES_DIR, profile.name, "config");
    const service = keychainServiceForConfigDir(configDir);
    const entry = await readKeychainEntry(service);
    results.push({
      name: profile.name,
      useDefaultAuth: profile.useDefaultAuth !== false,
      hasCredentials: entry !== null,
      isExpired: entry !== null && entry.expiresAt <= now,
    });
  }

  return { global: globalOk, globalExpired, profiles: results };
}

// ---------------------------------------------------------------------------
// Plugin operations
// ---------------------------------------------------------------------------

export async function updatePlugin(pluginId: string): Promise<void> {
  const claudeHome = path.join(os.homedir(), ".claude");
  await execFileAsync(findRealClaudeBinary(), ["plugin", "update", pluginId], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
  });
  _knownPluginNamesCache = null;
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  const claudeHome = path.join(os.homedir(), ".claude");
  await execFileAsync(findRealClaudeBinary(), ["plugin", "uninstall", pluginId], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
  });
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

export async function getAvailablePlugins(): Promise<{ installed: any[]; available: any[] }> {
  const claudeHome = path.join(os.homedir(), ".claude");
  const tmpFile = path.join(os.tmpdir(), `claude-plugins-${Date.now()}.json`);
  try {
    // Redirect stdout to a temp file to avoid pipe buffer truncation in Electron
    await new Promise<void>((resolve, reject) => {
      const out = fs.openSync(tmpFile, "w");
      const child = spawn(findRealClaudeBinary(), [
        "plugin", "list", "--available", "--json",
      ], { env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome }, stdio: ["ignore", out, "ignore"] });
      child.on("error", reject);
      child.on("close", (code) => {
        fs.closeSync(out);
        if (code !== 0) reject(new Error(`claude plugin list exited with code ${code}`));
        else resolve();
      });
    });
    const stdout = fs.readFileSync(tmpFile, "utf-8");
    return JSON.parse(stdout);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

export async function installPlugin(pluginId: string): Promise<void> {
  const claudeHome = path.join(os.homedir(), ".claude");
  await execFileAsync(findRealClaudeBinary(), [
    "plugin", "install", pluginId,
  ], { env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome }, timeout: 60000 });
}

export async function addMarketplace(source: string): Promise<void> {
  const claudeHome = path.join(os.homedir(), ".claude");
  await execFileAsync(findRealClaudeBinary(), [
    "plugin", "marketplace", "add", source,
  ], { env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome }, timeout: 60000 });
}

export async function removeMarketplace(name: string): Promise<void> {
  const claudeHome = path.join(os.homedir(), ".claude");
  await execFileAsync(findRealClaudeBinary(), [
    "plugin", "marketplace", "remove", name,
  ], { env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome }, timeout: 60000 });
}

export function listMarketplaces(): Array<{ name: string; repo: string; lastUpdated: string }> {
  const filePath = path.join(os.homedir(), ".claude", "plugins", "known_marketplaces.json");
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Object.entries(data).map(([name, info]: [string, any]) => ({
      name,
      repo: info.source?.repo ?? info.source?.url ?? "unknown",
      lastUpdated: info.lastUpdated ?? "",
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Active & Recent Sessions
// ---------------------------------------------------------------------------

export function getActiveSessions(): ActiveSession[] {
  const sessions: ActiveSession[] = [];
  if (!fs.existsSync(PROFILES_DIR)) return sessions;

  for (const dir of fs.readdirSync(PROFILES_DIR)) {
    if (dir.startsWith("_team_")) continue;
    const sessDir = path.join(PROFILES_DIR, dir, "config", "sessions");
    if (!fs.existsSync(sessDir)) continue;

    for (const file of fs.readdirSync(sessDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(sessDir, file), "utf-8"));
        // Check if PID is still running
        try {
          process.kill(data.pid, 0); // signal 0 = just check existence
          sessions.push({
            profile: dir,
            pid: data.pid,
            sessionId: data.sessionId,
            cwd: data.cwd,
            startedAt: data.startedAt,
          });
        } catch {
          // PID not running — stale session file
        }
      } catch {}
    }
  }

  sessions.sort((a, b) => b.startedAt - a.startedAt);
  return sessions;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export function getAnalytics(since?: number, project?: string): AnalyticsData {
  // Launch log — app-launched sessions only
  let launches = getLaunchLog(since);
  if (project) {
    launches = launches.filter((l) => path.basename(l.directory) === project);
  }
  const totalSessions = launches.length;

  // Daily launch counts
  const dailyCounts = new Map<string, number>();
  const projectCounts = new Map<string, number>();
  const recentLaunches: AnalyticsData["recentSessions"] = [];

  for (const launch of launches) {
    const dateStr = new Date(launch.timestamp).toISOString().slice(0, 10);
    dailyCounts.set(dateStr, (dailyCounts.get(dateStr) ?? 0) + 1);

    const projName = path.basename(launch.directory);
    projectCounts.set(projName, (projectCounts.get(projName) ?? 0) + 1);

    recentLaunches.push({
      project: projName,
      directory: launch.directory,
      date: dateStr,
      messages: 0,
      sessionId: `${launch.timestamp}-${launch.name}`,
      profile: launch.name,
      type: launch.type,
    });
  }

  // Profile usage from history.jsonl — messages sent through app-launched profiles
  let totalMessages = 0;
  const profileUsage: AnalyticsData["profileUsage"] = [];
  const profileMsgsByDate = new Map<string, number>();
  const currentProfiles = new Set(loadProfiles().map((p) => p.name));

  if (fs.existsSync(PROFILES_DIR)) {
    for (const dir of fs.readdirSync(PROFILES_DIR)) {
      if (dir.startsWith("_team_") || !currentProfiles.has(dir)) continue;
      const histPath = path.join(PROFILES_DIR, dir, "config", "history.jsonl");
      if (!fs.existsSync(histPath)) continue;
      try {
        const lines = fs.readFileSync(histPath, "utf-8").split("\n").filter(Boolean);
        let profileMsgs = 0;
        const sessions = new Set<string>();
        for (const line of lines) {
          const entry = JSON.parse(line);
          if (since && entry.timestamp < since) continue;
          if (project && entry.project && path.basename(entry.project) !== project) continue;
          profileMsgs++;
          if (entry.sessionId) sessions.add(entry.sessionId);
          if (entry.timestamp) {
            const dateStr = new Date(entry.timestamp).toISOString().slice(0, 10);
            profileMsgsByDate.set(dateStr, (profileMsgsByDate.get(dateStr) ?? 0) + 1);
          }
          // Track project usage from message history
          if (entry.project) {
            const projName = path.basename(entry.project);
            projectCounts.set(projName, (projectCounts.get(projName) ?? 0) + 1);
          }
        }
        totalMessages += profileMsgs;
        if (profileMsgs > 0) {
          profileUsage.push({ name: dir, sessions: sessions.size, messages: profileMsgs });
        }
      } catch {
        continue;
      }
    }
  }
  profileUsage.sort((a, b) => b.messages - a.messages);

  // Use message counts for daily activity (more granular than launch counts)
  for (const [date, msgs] of profileMsgsByDate) {
    dailyCounts.set(date, msgs);
  }

  const dailyActivity = [...dailyCounts.entries()]
    .map(([date, messages]) => ({ date, messages }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const topProjects = [...projectCounts.entries()]
    .map(([name, messages]) => ({ name, messages }))
    .sort((a, b) => b.messages - a.messages)
    .slice(0, 10);

  recentLaunches.sort((a, b) => b.date.localeCompare(a.date));
  const recent = recentLaunches.slice(0, 15);

  return { totalSessions, totalMessages, dailyActivity, topProjects, profileUsage, recentSessions: recent };
}

// ---------------------------------------------------------------------------
// Launch log
// ---------------------------------------------------------------------------

const LAUNCH_LOG = path.join(PROFILES_DIR, "launch-log.jsonl");

interface LaunchLogEntry {
  type: "profile" | "team";
  name: string;
  directory: string;
  timestamp: number;
}

function recordLaunch(entry: LaunchLogEntry): void {
  ensureProfilesDir();
  fs.appendFileSync(LAUNCH_LOG, JSON.stringify(entry) + "\n");
}

export function getLaunchLog(since?: number): LaunchLogEntry[] {
  if (!fs.existsSync(LAUNCH_LOG)) return [];
  try {
    const entries = fs.readFileSync(LAUNCH_LOG, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as LaunchLogEntry);
    if (since) return entries.filter((e) => e.timestamp >= since);
    return entries;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

async function launchInTerminal(shellCmd: string, terminalApp: string): Promise<void> {
  const fullCmd = shellCmd;

  if (terminalApp === "terminal") {
    const script = [
      'tell application "Terminal"',
      "  activate",
      `  do script "${fullCmd.replace(/"/g, '\\"')}"`,
      "end tell",
    ].join("\n");
    await execFileAsync("osascript", ["-e", script]);
    return;
  }

  // Default: iTerm2
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
    `    write text "${fullCmd.replace(/"/g, '\\"')}"`,
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

export async function launchProfile(profile: Profile, directory?: string, options?: LaunchOptions): Promise<void> {
  const configDir = path.join(PROFILES_DIR, profile.name, "config");
  const workDir = directory ?? profile.directory ?? os.homedir();

  // Generate mcp.json so --strict-mcp-config uses the right set
  writeMcpConfig(profile, workDir, configDir);

  const mcpConfigPath = path.join(configDir, "mcp.json");

  // Build launch flags — global defaults first, profile overrides on top, then one-shot overrides
  const flagParts: string[] = [];
  const globalDefs = getGlobalDefaults();
  if (globalDefs.customFlags?.trim()) flagParts.push(globalDefs.customFlags.trim());
  const skipPerms = options?.dangerouslySkipPermissions ?? profile.launchFlags?.dangerouslySkipPermissions;
  if (skipPerms) flagParts.push("--dangerously-skip-permissions");
  if (profile.launchFlags?.verbose) flagParts.push("--verbose");
  if (profile.customFlags?.trim()) flagParts.push(profile.customFlags.trim());
  if (options?.customFlags?.trim()) flagParts.push(options.customFlags.trim());
  const flagStr = flagParts.length > 0 ? " " + flagParts.join(" ") : "";

  const claudeBin = findRealClaudeBinary();
  const projectName = path.basename(workDir);
  const sessionName = `${profile.name} — ${projectName}`;
  const shellCmd = `cd '${escSh(workDir)}' && CLAUDE_CONFIG_DIR='${escSh(configDir)}' '${escSh(claudeBin)}' --mcp-config '${escSh(mcpConfigPath)}' --strict-mcp-config --name '${escSh(sessionName)}'${flagStr}`;
  const terminal = options?.terminalApp ?? globalDefs.terminalApp ?? "iterm2";

  await launchInTerminal(shellCmd, terminal);
  recordLaunch({ type: "profile", name: profile.name, directory: workDir, timestamp: Date.now() });
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
  if (leadProfile.model) teamSettings.model = leadProfile.model;
  if (leadProfile.effortLevel) teamSettings.effortLevel = leadProfile.effortLevel;
  if (leadProfile.env) {
    teamSettings.env = { ...(teamSettings.env ?? {}), ...leadProfile.env };
  }

  // Apply team-level overrides (these win over lead profile)
  if (team.model) teamSettings.model = team.model;
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

  // Symlink plugin caches for all merged plugins
  const installedPlugins = scanInstalledPlugins();
  symlinkSelectedCaches(
    { ...leadProfile, plugins: [...allPlugins] } as Profile,
    configDir,
    installedPlugins
  );

  // Symlink shared resources (auth, CLAUDE.md, projects, local add-ons, marketplaces)
  symlinkShared(configDir, leadProfile);

  // Install auto-skills (e.g. commands/profiles/check.md)
  installAutoSkills(configDir);

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
  const innerCmd = `cd '${escSh(workDir)}' && CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 CLAUDE_CONFIG_DIR='${escSh(configDir)}' '${escSh(claudeBin)}' --mcp-config '${escSh(mcpConfigPath)}' --strict-mcp-config --teammate-mode tmux --name '${escSh(sessionName)}'${flagStr} '/start-team'`;
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

  const terminal = options?.terminalApp ?? globalDefs.terminalApp ?? "iterm2";
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

  let currentKey: string | null = null;
  let multilineValue: string[] = [];
  let multilineIndent = 0;

  const flushMultiline = () => {
    if (currentKey && multilineValue.length > 0) {
      result[currentKey] = multilineValue.join(" ").trim();
    }
    currentKey = null;
    multilineValue = [];
    multilineIndent = 0;
  };

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      flushMultiline();
      break;
    }

    // Continuation line for multiline value (indented)
    if (currentKey && lines[i].length > 0 && (lines[i][0] === " " || lines[i][0] === "\t")) {
      multilineValue.push(lines[i].trim());
      continue;
    }

    // New key — flush any pending multiline
    flushMultiline();

    const colonIdx = lines[i].indexOf(":");
    if (colonIdx !== -1) {
      const key = lines[i].slice(0, colonIdx).trim();
      const value = lines[i].slice(colonIdx + 1).trim();

      // YAML multiline indicators: > (folded) or | (literal) or quoted strings
      if (value === ">" || value === "|" || value === ">-" || value === "|-") {
        currentKey = key;
        multilineValue = [];
      } else {
        // Strip surrounding quotes if present
        result[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Global settings
// ---------------------------------------------------------------------------

const GLOBAL_CLAUDE_MD = path.join(CLAUDE_HOME, "CLAUDE.md");
const GLOBAL_DEFAULTS_JSON = path.join(PROFILES_DIR, "global-defaults.json");
const IMPORTED_PROJECTS_JSON = path.join(PROFILES_DIR, "imported-projects.json");

export function getGlobalClaudeMd(): string {
  try {
    return fs.readFileSync(GLOBAL_CLAUDE_MD, "utf-8");
  } catch {
    return "";
  }
}

export function saveGlobalClaudeMd(content: string): void {
  fs.mkdirSync(CLAUDE_HOME, { recursive: true });
  fs.writeFileSync(GLOBAL_CLAUDE_MD, content, "utf-8");
}

export function getGlobalDefaults(): { model: string; effortLevel: string; env?: Record<string, string>; customFlags?: string; terminalApp?: string; tmuxMode?: string } {
  try {
    const data = JSON.parse(fs.readFileSync(GLOBAL_DEFAULTS_JSON, "utf-8"));
    return { model: data.model ?? "", effortLevel: data.effortLevel ?? "", env: data.env, customFlags: data.customFlags, terminalApp: data.terminalApp, tmuxMode: data.tmuxMode };
  } catch {
    return { model: "", effortLevel: "" };
  }
}

export function saveGlobalDefaults(defaults: { model: string; effortLevel: string; env?: Record<string, string>; customFlags?: string; terminalApp?: string; tmuxMode?: string }): void {
  fs.writeFileSync(GLOBAL_DEFAULTS_JSON, JSON.stringify(defaults, null, 2));
}

// ---------------------------------------------------------------------------
// Imported projects
// ---------------------------------------------------------------------------

function readImportedProjects(): string[] {
  try {
    return JSON.parse(fs.readFileSync(IMPORTED_PROJECTS_JSON, "utf-8"));
  } catch {
    return [];
  }
}

function writeImportedProjects(projects: string[]): void {
  fs.writeFileSync(IMPORTED_PROJECTS_JSON, JSON.stringify(projects, null, 2));
}

export function getImportedProjects(): string[] {
  return readImportedProjects();
}

export function addImportedProject(dir: string): string[] {
  const projects = readImportedProjects();
  if (!projects.includes(dir)) {
    projects.push(dir);
    writeImportedProjects(projects);
  }
  return projects;
}

export function removeImportedProject(dir: string): string[] {
  const projects = readImportedProjects().filter((p) => p !== dir);
  writeImportedProjects(projects);
  return projects;
}

export function getProjectClaudeMd(dir: string): string {
  const mdPath = path.join(dir, "CLAUDE.md");
  try {
    return fs.readFileSync(mdPath, "utf-8");
  } catch {
    return "";
  }
}

export function saveProjectClaudeMd(dir: string, content: string): void {
  const mdPath = path.join(dir, "CLAUDE.md");
  fs.writeFileSync(mdPath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const PROMPTS_JSON = path.join(PROFILES_DIR, "prompts.json");

export function getPrompts(): import("./types").Prompt[] {
  try {
    return JSON.parse(fs.readFileSync(PROMPTS_JSON, "utf-8"));
  } catch {
    return [];
  }
}

export function savePrompts(prompts: import("./types").Prompt[]): void {
  fs.writeFileSync(PROMPTS_JSON, JSON.stringify(prompts, null, 2));
}

export function getGlobalEnv(): Record<string, string> {
  const settingsPath = path.join(CLAUDE_HOME, "settings.json");
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    return data.env ?? {};
  } catch {
    return {};
  }
}

export function saveGlobalEnv(env: Record<string, string>): void {
  const settingsPath = path.join(CLAUDE_HOME, "settings.json");
  let data: Record<string, any> = {};
  try {
    data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {}
  if (Object.keys(env).length > 0) {
    data.env = env;
  } else {
    delete data.env;
  }
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
}

export function getGlobalHooks(): Record<string, any> {
  const settingsPath = path.join(CLAUDE_HOME, "settings.json");
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    return data.hooks ?? {};
  } catch {
    return {};
  }
}

export function saveGlobalHooks(hooks: Record<string, any>): void {
  const settingsPath = path.join(CLAUDE_HOME, "settings.json");
  let data: Record<string, any> = {};
  try {
    data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    // Start fresh
  }
  if (Object.keys(hooks).length > 0) {
    data.hooks = hooks;
  } else {
    delete data.hooks;
  }
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
}

export function runDiagnostics(): {
  version: string;
  configDir: string;
  claudeHome: string;
  profileCount: number;
  teamCount: number;
  issues: string[];
} {
  const profiles = loadProfiles();
  const teams = loadTeams();
  const issues: string[] = [];

  // Check each profile's config dir
  for (const profile of profiles) {
    const configDir = path.join(PROFILES_DIR, profile.name, "config");
    if (!fs.existsSync(configDir)) {
      issues.push(`Profile "${profile.name}": config directory missing`);
      continue;
    }
    // Check key symlinks
    const claudeMdLink = path.join(configDir, "CLAUDE.md");
    if (fs.existsSync(claudeMdLink)) {
      try {
        const target = fs.readlinkSync(claudeMdLink);
        if (!fs.existsSync(target)) {
          issues.push(`Profile "${profile.name}": CLAUDE.md symlink broken → ${target}`);
        }
      } catch {}
    }
    const projectsLink = path.join(configDir, "projects");
    if (fs.existsSync(projectsLink)) {
      try {
        const target = fs.readlinkSync(projectsLink);
        if (!fs.existsSync(target)) {
          issues.push(`Profile "${profile.name}": projects symlink broken → ${target}`);
        }
      } catch {}
    }
    // Check settings.json exists
    if (!fs.existsSync(path.join(configDir, "settings.json"))) {
      issues.push(`Profile "${profile.name}": settings.json missing`);
    }
  }

  // Check global files
  if (!fs.existsSync(path.join(CLAUDE_HOME, "settings.json"))) {
    issues.push("Global settings.json missing");
  }
  if (!fs.existsSync(path.join(CLAUDE_HOME, ".claude.json")) && !fs.existsSync(path.join(os.homedir(), ".claude.json"))) {
    issues.push("~/.claude.json missing (auth may not work)");
  }

  const pkg = require("../../package.json");

  return {
    version: pkg.version ?? "unknown",
    configDir: PROFILES_DIR,
    claudeHome: CLAUDE_HOME,
    profileCount: profiles.length,
    teamCount: teams.length,
    issues,
  };
}

export async function checkForAppUpdate(): Promise<{ available: boolean; current: string; latest: string }> {
  const pkg = require("../../package.json");
  const current: string = pkg.version ?? "0.0.0";
  const repo = pkg.repository?.url?.replace(/.*github\.com\//, "").replace(/\.git$/, "") ?? "";

  if (!repo) return { available: false, current, latest: current };

  try {
    // Check GitHub releases API
    const { stdout } = await execFileAsync("curl", [
      "-s", "-f", `https://api.github.com/repos/${repo}/releases/latest`,
    ], { timeout: 10000 });

    const release = JSON.parse(stdout);
    const latest: string = release.tag_name?.replace(/^v/, "") ?? current;

    // Simple semver comparison
    const cParts = current.split(".").map(Number);
    const lParts = latest.split(".").map(Number);
    let available = false;
    for (let i = 0; i < 3; i++) {
      if ((lParts[i] ?? 0) > (cParts[i] ?? 0)) { available = true; break; }
      if ((lParts[i] ?? 0) < (cParts[i] ?? 0)) break;
    }

    return { available, current, latest };
  } catch {
    // No releases yet or network error — try git if available
    try {
      const appDir = path.resolve(__dirname, "../..");
      await execFileAsync("git", ["fetch", "--quiet"], { cwd: appDir, timeout: 10000 });
      const { stdout } = await execFileAsync("git", [
        "rev-list", "--count", "HEAD..origin/main",
      ], { cwd: appDir, timeout: 5000 });
      const behind = parseInt(stdout.trim(), 10) || 0;
      return { available: behind > 0, current, latest: behind > 0 ? `${behind} commits ahead` : current };
    } catch {
      return { available: false, current, latest: current };
    }
  }
}

export function getProfileConfigDir(name: string): string {
  return path.join(PROFILES_DIR, name, "config");
}

export function getClaudeHome(): string {
  return CLAUDE_HOME;
}

export function getProfilesDir(): string {
  return PROFILES_DIR;
}
