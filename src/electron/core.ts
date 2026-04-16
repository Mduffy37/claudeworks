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
  StatusLineConfig,
  StatusLineWidget,
} from "./types";

const CLAUDE_HOME = path.join(os.homedir(), ".claude");
const PROFILES_DIR = path.join(os.homedir(), ".claude-profiles");
const PROFILES_JSON = path.join(PROFILES_DIR, "profiles.json");
const STATUSLINE_CONFIG_PATH = path.join(os.homedir(), ".claude", "statusline-config.json");
const STATUSLINE_RENDERER_PATH = path.join(os.homedir(), ".claude", "scripts", "statusline-render.py");

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

// Plugin scans touch the filesystem heavily (realpath, stat, git subprocesses)
// and fire in bursts — UI mount, profile health check, and profile launch can
// all run inside ~100ms, each calling the same scanners. A short TTL coalesces
// those into a single scan; anything older than the TTL re-scans naturally, so
// user-visible freshness after install/uninstall is unaffected.
const SCAN_CACHE_TTL_MS = 1500;
const _scanCacheClearFns: Array<() => void> = [];

function cacheScan<T>(fn: () => T): () => T {
  let cached: { value: T; expires: number } | null = null;
  _scanCacheClearFns.push(() => { cached = null; });
  return () => {
    const now = Date.now();
    if (cached && cached.expires > now) return cached.value;
    const value = fn();
    cached = { value, expires: now + SCAN_CACHE_TTL_MS };
    return value;
  };
}

export function invalidatePluginCaches(): void {
  for (const clear of _scanCacheClearFns) clear();
}

export const scanInstalledPlugins = cacheScan((): PluginEntry[] => {
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
});

/** Read a plugin's `.claude-plugin/plugin.json` manifest, or null if missing/invalid. */
function readPluginManifest(pluginRoot: string): Record<string, any> | null {
  const manifestPath = path.join(pluginRoot, ".claude-plugin", "plugin.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Normalise a plugin.json `skills`/`commands`/`agents` field to a list of strings.
 * Accepts: an array (documented form), a single string (shorthand used by plugins
 * with only one item of that kind), or anything else (→ null = "not declared").
 */
function normaliseManifestPaths(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return [v];
  return null;
}

/**
 * Resolve a manifest-declared SKILL entry into one or more concrete SKILL.md paths.
 *
 * The Claude Code plugin spec lets a manifest point at a directory. There are
 * two legitimate interpretations of that:
 *
 *   1. The directory IS a skill (contains SKILL.md directly). One item.
 *   2. The directory CONTAINS skills (has subdirectories with SKILL.md each).
 *      Multiple items. This is how plugins group many related skills — e.g.
 *      engineering-advanced-skills uses `"skills": "./"` with 44 subdirs.
 *
 * Resolution order: prefer subdirectories. If any immediate child subdirectory
 * contains a SKILL.md, return all of them. Otherwise, if the directory itself
 * has a SKILL.md, return that as a single item. Otherwise empty.
 */
/**
 * True for both real directories and symlinks whose target is a directory.
 * `fs.Dirent.isDirectory()` uses lstat semantics, so symlinks-to-dirs report false —
 * every skill-scanner that reads directories with withFileTypes must use this helper
 * to avoid skipping cross-published plugins (e.g. redis/agent-skills materialises
 * `plugins/redis-development/skills/redis-development` as a symlink to `skills/redis-development`).
 */
function direntIsDirLike(entry: fs.Dirent, parentDir: string): boolean {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) {
    try {
      return fs.statSync(path.join(parentDir, entry.name)).isDirectory();
    } catch {
      return false;
    }
  }
  return false;
}

function resolveSkillManifestEntry(pluginRoot: string, entry: string): string[] {
  if (typeof entry !== "string") return [];
  const absolute = path.resolve(pluginRoot, entry);
  const rootResolved = path.resolve(pluginRoot);
  // Refuse anything that escapes the plugin root.
  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + path.sep)) return [];
  if (!fs.existsSync(absolute)) return [];

  // fs.statSync follows symlinks, so a symlinked skill dir passes the isDirectory check.
  const stat = fs.statSync(absolute);
  if (stat.isFile() && absolute.endsWith(".md")) return [absolute];
  if (!stat.isDirectory()) return [];

  // Prefer subdirectories with SKILL.md (multi-skill container layout).
  const subdirs: string[] = [];
  try {
    for (const child of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (!direntIsDirLike(child, absolute)) continue;
      const skillMd = path.join(absolute, child.name, "SKILL.md");
      if (fs.existsSync(skillMd)) subdirs.push(skillMd);
    }
  } catch {
    // ignore
  }
  if (subdirs.length > 0) return subdirs;

  // Single-skill layout: the directory itself has SKILL.md.
  const directSkillMd = path.join(absolute, "SKILL.md");
  if (fs.existsSync(directSkillMd)) return [directSkillMd];

  return [];
}

/**
 * Resolve a manifest-declared command/agent entry into a single .md file path.
 * Commands and agents don't support the container pattern — each entry points
 * at exactly one file.
 */
function resolveSingleFileManifestEntry(pluginRoot: string, entry: string): string | null {
  if (typeof entry !== "string") return null;
  const absolute = path.resolve(pluginRoot, entry);
  const rootResolved = path.resolve(pluginRoot);
  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + path.sep)) return null;
  if (!fs.existsSync(absolute)) return null;
  const stat = fs.statSync(absolute);
  if (stat.isFile() && absolute.endsWith(".md")) return absolute;
  return null;
}

function buildItem(
  pluginName: string,
  itemPath: string,
  type: "skill" | "command" | "agent",
  fallbackName: string,
): PluginItem {
  const fm = readFrontmatter(itemPath);
  const isSkill = type === "skill";
  return {
    name: fm.name ?? fallbackName,
    description: cleanDescription(fm.description ?? ""),
    type,
    plugin: pluginName,
    path: itemPath,
    userInvocable: isSkill ? (fm["user-invocable"] ?? "true").toLowerCase() !== "false" : true,
    dependencies: scanDependencies(itemPath),
  };
}

export function scanPluginItems(plugin: PluginEntry): PluginItem[] {
  const items: PluginItem[] = [];
  const base = plugin.installPath;
  if (!fs.existsSync(base)) return items;

  // Per the Claude Code plugin spec, plugin.json `skills` / `commands` / `agents`
  // paths REPLACE the corresponding conventional directory scan. They are not
  // additive — when declared, the default directory is ignored entirely.
  // https://code.claude.com/docs/en/plugins-reference#path-behavior-rules
  const manifest = readPluginManifest(base);
  const manifestSkills = manifest ? normaliseManifestPaths(manifest.skills) : null;
  const manifestCommands = manifest ? normaliseManifestPaths(manifest.commands) : null;
  const manifestAgents = manifest ? normaliseManifestPaths(manifest.agents) : null;

  // Skills — manifest entries may resolve to multiple SKILL.md files when
  // the declared path is a container directory (e.g. `"skills": "./"` in a
  // plugin with 40+ nested skill subdirectories).
  if (manifestSkills) {
    const seenSkillPaths = new Set<string>();
    for (const entry of manifestSkills) {
      const resolvedPaths = resolveSkillManifestEntry(base, entry);
      for (const skillMd of resolvedPaths) {
        if (seenSkillPaths.has(skillMd)) continue;
        seenSkillPaths.add(skillMd);
        items.push(buildItem(plugin.name, skillMd, "skill", path.basename(path.dirname(skillMd))));
      }
    }
  } else {
    const skillsDir = path.join(base, "skills");
    if (fs.existsSync(skillsDir)) {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!direntIsDirLike(entry, skillsDir)) continue;
        const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
        if (!fs.existsSync(skillMd)) continue;
        items.push(buildItem(plugin.name, skillMd, "skill", entry.name));
      }
    }
  }

  // Commands
  if (manifestCommands) {
    for (const entry of manifestCommands) {
      const resolved = resolveSingleFileManifestEntry(base, entry);
      if (!resolved) continue;
      items.push(buildItem(plugin.name, resolved, "command", path.basename(resolved, ".md")));
    }
  } else {
    const cmdsDir = path.join(base, "commands");
    if (fs.existsSync(cmdsDir)) {
      for (const file of fs.readdirSync(cmdsDir)) {
        if (!file.endsWith(".md")) continue;
        items.push(buildItem(plugin.name, path.join(cmdsDir, file), "command", path.basename(file, ".md")));
      }
    }
  }

  // Agents
  if (manifestAgents) {
    for (const entry of manifestAgents) {
      const resolved = resolveSingleFileManifestEntry(base, entry);
      if (!resolved) continue;
      items.push(buildItem(plugin.name, resolved, "agent", path.basename(resolved, ".md")));
    }
  } else {
    const agentsDir = path.join(base, "agents");
    if (fs.existsSync(agentsDir)) {
      for (const file of fs.readdirSync(agentsDir)) {
        if (!file.endsWith(".md") || file === "README.md") continue;
        items.push(buildItem(plugin.name, path.join(agentsDir, file), "agent", path.basename(file, ".md")));
      }
    }
  }

  // Heuristic fallback for plugins that ship .md files at the root with no
  // manifest declarations and no conventional subdirs. Not part of the official
  // spec — kept for compatibility with plugins that predate or ignore it.
  // Excludes well-known dev-doc filenames so we never invent phantom agents.
  if (items.length === 0 && !manifest) {
    const hasSubdirs = ["skills", "agents", "commands"].some(
      (d) => fs.existsSync(path.join(base, d))
    );
    if (!hasSubdirs) {
      const ROOT_AGENT_EXCLUDES = new Set(["README.md", "CLAUDE.md", "CHANGELOG.md", "LICENSE.md", "CONTRIBUTING.md"]);
      for (const file of fs.readdirSync(base)) {
        if (!file.endsWith(".md") || ROOT_AGENT_EXCLUDES.has(file)) continue;
        items.push(buildItem(plugin.name, path.join(base, file), "agent", path.basename(file, ".md")));
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
  const disabledUser = profile.disabledMcpServers?.["__user__"] ?? [];

  // 2. User-level and project MCPs — read from ~/.claude.json
  const claudeJson = path.join(os.homedir(), ".claude.json");
  if (fs.existsSync(claudeJson)) {
    try {
      const data = JSON.parse(fs.readFileSync(claudeJson, "utf-8"));

      // User-level MCPs — toggleable per-profile via disabledMcpServers["__user__"]
      const userMcps: Record<string, any> = data.mcpServers ?? {};
      for (const [name, config] of Object.entries(userMcps)) {
        if (!disabledUser.includes(name)) {
          mcpServers[name] = config;
        }
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

  // 3. Global ~/.mcp.json — toggleable via the same __user__ disabled list
  const globalMcpJson = path.join(os.homedir(), ".mcp.json");
  if (fs.existsSync(globalMcpJson)) {
    try {
      const entries = readMcpJsonFile(globalMcpJson);
      for (const [name, config] of Object.entries(entries)) {
        if (!disabledUser.includes(name)) {
          mcpServers[name] = config;
        }
      }
    } catch {
      // Skip unreadable ~/.mcp.json
    }
  }

  // 4. Local .mcp.json in the project directory — filtered by disabled list (flat or wrapped format)
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

export const getPluginsWithItems = cacheScan((): PluginWithItems[] => {
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
});

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
      if (!direntIsDirLike(entry, skillsDir)) continue;
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
/** Read a skill folder's `.skillfish.json` provenance marker, or null if absent/invalid. */
export function readSkillfishMarker(skillDir: string): Record<string, any> | null {
  const markerPath = path.join(skillDir, ".skillfish.json");
  if (!fs.existsSync(markerPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(markerPath, "utf-8"));
  } catch {
    return null;
  }
}

/** Parse `owner/repo` out of a git remote URL. Returns null if we can't. */
export function parseRemoteOwnerRepo(url: string): { owner: string; repo: string } | null {
  // https://github.com/owner/repo.git  |  git@github.com:owner/repo.git  |  https://gitlab.com/group/sub/repo
  const clean = url.replace(/\.git$/, "").replace(/\/$/, "");
  const sshMatch = clean.match(/^[^@]+@[^:]+:(.+)$/);
  const path = sshMatch ? sshMatch[1] : clean.replace(/^[a-z]+:\/\/[^/]+\//, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[parts.length - 2], repo: parts[parts.length - 1] };
}

/**
 * Detect a skill installed by an agent-skill CLI that writes a `.skill-lock.json`
 * manifest near the real skill folder (e.g. Leonxlnx's skill-cli used by
 * taste-skill). Follows symlinks, walks up the resolved path looking for the
 * manifest, and matches the skill by its resolved basename.
 *
 * Returns a PluginSource with a `groupKey` so multiple skills from the same
 * source repo collapse into one synthetic plugin card. Blanket detector —
 * not hardcoded to any specific repo.
 */
export function detectSkillLockSource(
  skillDir: string,
  manifestCache: Map<string, any>,
): import("./types").PluginSource | null {
  let realPath: string;
  try {
    realPath = fs.realpathSync(skillDir);
  } catch {
    return null;
  }
  const skillKey = path.basename(realPath);

  // Walk up from the real skill folder looking for `.skill-lock.json`.
  // Stop at $HOME or filesystem root to keep the walk bounded.
  const home = os.homedir();
  let dir = path.dirname(realPath);
  let manifest: any = null;
  let manifestPath = "";
  while (dir && dir !== path.dirname(dir)) {
    const candidate = path.join(dir, ".skill-lock.json");
    if (manifestCache.has(candidate)) {
      const cached = manifestCache.get(candidate);
      if (cached) {
        manifest = cached;
        manifestPath = candidate;
      }
      break;
    }
    if (fs.existsSync(candidate)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, "utf-8"));
        manifestCache.set(candidate, parsed);
        manifest = parsed;
        manifestPath = candidate;
        break;
      } catch {
        manifestCache.set(candidate, null);
        break;
      }
    }
    if (dir === home) break;
    dir = path.dirname(dir);
  }

  if (!manifest || !manifest.skills || typeof manifest.skills !== "object") return null;
  const entry = manifest.skills[skillKey];
  if (!entry || !entry.source) return null;

  const source: string = String(entry.source);
  const sourceUrl: string | undefined = entry.sourceUrl;

  return {
    type: "skill-lock",
    label: "skill-lock",
    groupKey: `skill-lock:${source}`,
    groupName: source,
    tooltip: sourceUrl
      ? `Tracked by .skill-lock.json — source: ${source} (${sourceUrl})`
      : `Tracked by .skill-lock.json — source: ${source}`,
    metadata: {
      source,
      sourceUrl,
      sourceType: entry.sourceType,
      installedAt: entry.installedAt,
      manifestPath,
    },
  };
}

/**
 * Detect a git-managed skill folder by presence of `.git/`, and extract the remote
 * URL, branch, and sha via subprocess. Returns null if anything fails.
 *
 * Results are cached by `skillDir` keyed on `.git/HEAD` mtime — three `git`
 * subprocesses per skill per scan adds up fast (one main-process block per
 * N×3 spawns), and HEAD's mtime reliably changes on any checkout/commit/rebase,
 * so the cache auto-invalidates when git state actually moves.
 */
const _gitSourceCache = new Map<
  string,
  { mtimeMs: number; result: Record<string, any> | null }
>();

export function detectGitSource(skillDir: string): Record<string, any> | null {
  const gitDir = path.join(skillDir, ".git");
  if (!fs.existsSync(gitDir)) return null;

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(path.join(gitDir, "HEAD")).mtimeMs;
  } catch {
    // HEAD missing/unreadable — fall through and re-run; don't cache.
  }
  if (mtimeMs) {
    const cached = _gitSourceCache.get(skillDir);
    if (cached && cached.mtimeMs === mtimeMs) return cached.result;
  }

  let result: Record<string, any> | null = null;
  try {
    const run = (args: string[]) =>
      execFileSync("git", ["-C", skillDir, ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const url = (() => { try { return run(["remote", "get-url", "origin"]); } catch { return ""; } })();
    const branch = (() => { try { return run(["rev-parse", "--abbrev-ref", "HEAD"]); } catch { return ""; } })();
    const sha = (() => { try { return run(["rev-parse", "HEAD"]); } catch { return ""; } })();
    if (url || branch || sha) {
      const parsed = url ? parseRemoteOwnerRepo(url) : null;
      result = {
        url: url || undefined,
        branch: branch || undefined,
        sha: sha || undefined,
        owner: parsed?.owner,
        repo: parsed?.repo,
      };
    }
  } catch {
    result = null;
  }

  if (mtimeMs) _gitSourceCache.set(skillDir, { mtimeMs, result });
  return result;
}

export const scanUserLocalPlugins = cacheScan((): PluginWithItems[] => {
  const claudeHome = path.join(os.homedir(), ".claude");
  const plugins: PluginWithItems[] = [];

  const makePlugin = (name: string, items: PluginItem[], source?: import("./types").PluginSource): PluginWithItems => ({
    name: `${LOCAL_PLUGIN_PREFIX}${name}`,
    scope: "user",
    installPath: claudeHome,
    version: "local",
    marketplace: "local",
    pluginName: name,
    items,
    hooks: [],
    mcpServers: [],
    ...(source ? { source } : {}),
  });

  const gsdDetected = isGsdInstalled();
  const GSD_PLUGIN_NAME = `${FRAMEWORK_PLUGIN_PREFIX}gsd`;
  const gsdItems: PluginItem[] = [];


  // Skills: each skill directory → its own plugin, unless a detector returns a
  // `groupKey` (multi-skill installers like skill-cli), in which case all skills
  // sharing that key collapse into one grouped plugin card. GSD skills →
  // framework:gsd as before.
  //
  // Detector registry — runs in order per skill, first hit wins. Blanket shape:
  // adding a new installer means adding one function here.
  const skillLockManifestCache = new Map<string, any>();
  const skillDetectors: Array<(dir: string) => import("./types").PluginSource | null> = [
    (dir) => {
      const m = readSkillfishMarker(dir);
      return m ? { type: "skillfish", metadata: m } : null;
    },
    (dir) => detectSkillLockSource(dir, skillLockManifestCache),
    (dir) => {
      const m = detectGitSource(dir);
      return m ? { type: "git", metadata: m } : null;
    },
  ];

  // Buffer grouped skills by groupKey so we can emit one PluginWithItems per group.
  const groupedSkills = new Map<
    string,
    { source: import("./types").PluginSource; items: PluginItem[] }
  >();

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
        continue;
      }

      const skillDir = path.join(skillsDir, entry.name);
      let source: import("./types").PluginSource | undefined;
      for (const detector of skillDetectors) {
        const hit = detector(skillDir);
        if (hit) { source = hit; break; }
      }

      // Grouped path: skills sharing a groupKey accumulate into one bucket.
      if (source?.groupKey) {
        const groupKey = source.groupKey;
        const groupedPluginName = source.groupName ?? groupKey;
        let bucket = groupedSkills.get(groupKey);
        if (!bucket) {
          bucket = { source, items: [] };
          groupedSkills.set(groupKey, bucket);
        }
        bucket.items.push({
          name: skillName,
          description: fm.description ?? "",
          type: "skill",
          plugin: `${LOCAL_PLUGIN_PREFIX}${groupedPluginName}`,
          path: skillMd,
          userInvocable: true,
          dependencies: [],
        });
        continue;
      }

      // Ungrouped path: preserved legacy behaviour — one plugin per skill.
      plugins.push(makePlugin(pluginName, [{
        name: skillName,
        description: fm.description ?? "",
        type: "skill",
        plugin: `${LOCAL_PLUGIN_PREFIX}${pluginName}`,
        path: skillMd,
        userInvocable: true,
        dependencies: [],
      }], source));
    }
  }

  // Emit one synthetic plugin per grouped bucket.
  for (const { source, items } of groupedSkills.values()) {
    const groupedPluginName = source.groupName ?? source.groupKey!;
    plugins.push(makePlugin(groupedPluginName, items, source));
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
});

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

/**
 * Schema version for profiles.json. Every time the on-disk shape of a
 * stored profile changes in a way that old code can't read, bump this
 * and add a branch to migrateProfilesStore().
 *
 * Today there is only v1 — the function is a skeleton so future migrations
 * have a place to live. Shipping before v1 is public means every user has
 * a known version stamp on disk, so v2 code never has to guess.
 */
const PROFILES_SCHEMA_VERSION = 1;

function migrateProfilesStore(raw: any): ProfilesStore {
  if (!raw || typeof raw !== "object") return { schemaVersion: PROFILES_SCHEMA_VERSION, profiles: {} };
  const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
  let store: any = raw;

  // Any data written before PROFILES_SCHEMA_VERSION existed is treated as
  // "version 0" and upgraded to 1. No shape change today — the stamp is
  // the migration.
  if (version < 1) {
    store = { ...store, schemaVersion: 1 };
  }
  // Future migrations go here, e.g.:
  // if (version < 2) { store = { ...store, profiles: mapProfilesV1toV2(store.profiles) }; }

  return store as ProfilesStore;
}

function readProfilesStore(): ProfilesStore {
  if (!fs.existsSync(PROFILES_JSON)) return { schemaVersion: PROFILES_SCHEMA_VERSION, profiles: {} };
  const raw = JSON.parse(fs.readFileSync(PROFILES_JSON, "utf-8"));
  return migrateProfilesStore(raw);
}

function writeProfilesStore(store: ProfilesStore): void {
  ensureProfilesDir();
  const stamped: ProfilesStore = { ...store, schemaVersion: PROFILES_SCHEMA_VERSION };
  const tmp = PROFILES_JSON + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(stamped, null, 2) + "\n");
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

// Resolve a model shorthand + context preference into an explicit Claude Code
// model ID. Writing explicit IDs (rather than the "opus"/"sonnet" shorthand)
// avoids Claude Code silently resolving the shorthand differently across
// sessions — which is what caused Opus to sometimes land in 1M context and
// sometimes not.
function resolveModelId(
  model: string,
  opusContext: "200k" | "1m" | undefined,
  sonnetContext: "200k" | "1m" | undefined,
): string {
  if (model === "opus") {
    return opusContext === "200k" ? "claude-opus-4-6" : "claude-opus-4-6[1m]";
  }
  if (model === "sonnet") {
    return sonnetContext === "1m" ? "claude-sonnet-4-6[1m]" : "claude-sonnet-4-6";
  }
  if (model === "haiku") {
    return "claude-haiku-4-5-20251001";
  }
  // Unknown / already-explicit model ID — pass through unchanged.
  return model;
}

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

  // Honour the user's plugin selection exactly — do NOT force-include the
  // built-in profiles-manager plugin here. When the user has disabled it via
  // the app toggle (i.e. removed it from `profile.plugins`), silently re-adding
  // it breaks the profile isolation the toggle promises.
  settings.enabledPlugins = Object.fromEntries(
    profile.plugins.map((name) => [name, true])
  );

  // Apply profile-specific overrides, falling back to global defaults
  const globalDefaults = getGlobalDefaults();
  if (profile.model) {
    settings.model = resolveModelId(profile.model, profile.opusContext, profile.sonnetContext);
  } else if (globalDefaults.model) {
    settings.model = resolveModelId(globalDefaults.model, globalDefaults.opusContext, globalDefaults.sonnetContext);
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

  // Handle per-profile /workflow command
  const workflowPath = path.join(configDir, "commands", "workflow.md");
  if (profile.workflow && profile.workflow.trim()) {
    fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
    const frontmatter = `---\ndescription: Run this profile's predefined workflow\n---\n\n`;
    fs.writeFileSync(workflowPath, frontmatter + profile.workflow);
  } else {
    try { fs.unlinkSync(workflowPath); } catch {}
  }

  // Handle per-profile /tools command — a persistent tool-set reference the
  // user can invoke at any time to see what's in this profile and why.
  // Mirror of the workflow block above; different file, different field.
  const toolsPath = path.join(configDir, "commands", "tools.md");
  if (profile.tools && profile.tools.trim()) {
    fs.mkdirSync(path.dirname(toolsPath), { recursive: true });
    const frontmatter = `---\ndescription: Show all tools in this profile with rationale\n---\n\n`;
    fs.writeFileSync(toolsPath, frontmatter + profile.tools);
  } else {
    try { fs.unlinkSync(toolsPath); } catch {}
  }

  // Handle per-profile status line config override (Phase 6)
  // When set, the Python renderer picks this up via $CLAUDE_CONFIG_DIR and
  // uses it instead of the global ~/.claude/statusline-config.json.
  const profileStatuslineConfigPath = path.join(configDir, "statusline-config.json");
  if (profile.statusLineConfig) {
    fs.writeFileSync(
      profileStatuslineConfigPath,
      JSON.stringify(profile.statusLineConfig, null, 2) + "\n",
      "utf-8",
    );
  } else {
    try { fs.unlinkSync(profileStatuslineConfigPath); } catch {}
  }

  // Scan plugins once for cache setup and exclusions
  const installedPlugins = scanInstalledPlugins();

  // Fingerprint-guarded cache rebuild.
  //
  // symlinkSelectedCaches + applyExclusions are the expensive phases of
  // assembleProfile — on a profile with several excluded plugins they wipe
  // and rebuild the whole plugin cache tree every time (deep copy + targeted
  // delete). Most profile saves don't touch anything that invalidates the
  // rebuild (tag/description/model/launchDir edits), and launches never do,
  // so we hash the inputs the rebuild actually depends on and skip the block
  // when the hash matches the marker we wrote last time.
  const fingerprint = computeAssemblyFingerprint(profile, installedPlugins);
  const markerPath = path.join(configDir, ".assembly-fingerprint.json");
  const cacheDir = path.join(configDir, "plugins", "cache");
  let cacheStale = true;
  try {
    if (fs.existsSync(markerPath) && fs.existsSync(cacheDir)) {
      const stored = JSON.parse(fs.readFileSync(markerPath, "utf-8"));
      if (stored?.fingerprint === fingerprint) cacheStale = false;
    }
  } catch {
    // Unreadable marker — treat as stale and rebuild.
  }

  if (cacheStale) {
    // Symlink plugin caches
    symlinkSelectedCaches(profile, configDir, installedPlugins);

    // Apply skill-level exclusions
    applyExclusions(profile, configDir, installedPlugins);
  }

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

  // Fix container-pattern plugins for ALL plugins in the profile (not just
  // excluded ones). Plugins declaring "skills": "./" have skills at their root
  // level instead of in a conventional skills/ subdirectory. Claude Code's
  // runtime only scans <installPath>/skills/ for skill discovery, so these
  // root-level skills are invisible. Fix: for each container-pattern plugin,
  // create a skills/ directory and symlink the skill subdirs into it, then
  // write a patched plugin.json without the "skills" field. For plugins with
  // exclusions, applyExclusions already handles this inside the overlay; this
  // step catches plugins WITHOUT exclusions where the cache is a plain symlink
  // chain to the global cache.
  fixContainerPatternPlugins(profile, configDir, installedPlugins);

  // Symlink shared resources
  symlinkShared(configDir, profile);

  // Clean up stale auto-skills from old system (commands/profiles/, commands/start-team.md, etc.)
  const staleAutoSkills = path.join(configDir, "commands", "profiles");
  if (fs.existsSync(staleAutoSkills)) fs.rmSync(staleAutoSkills, { recursive: true });

  // Ensure built-in plugin is installed in the global cache
  ensureBuiltinPlugin();

  // Generate baseline mcp.json for CLI alias usage.
  // Launch through the app regenerates this with the actual working directory.
  const baselineDir = profile.directory ?? os.homedir();
  writeMcpConfig(profile, baselineDir, configDir);

  // Persist fingerprint so the next assembly with identical cache-relevant
  // inputs can skip symlinkSelectedCaches + applyExclusions. Written last so
  // a failure anywhere above leaves the prior (still-valid) marker untouched.
  try {
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ fingerprint, ts: Date.now() }, null, 2),
    );
  } catch {}

  return configDir;
}

/**
 * Hash of the inputs that determine whether the cache rebuild phase of
 * assembleProfile can be skipped. Covers the enabled plugin set, their
 * versions (so reinstalls/upgrades force a rebuild), and the per-plugin
 * exclusion list. Bump the `v` field when the assembly shape itself changes.
 */
function computeAssemblyFingerprint(profile: Profile, plugins: PluginEntry[]): string {
  const enabledWithVersions = profile.plugins
    .map((name) => {
      const p = plugins.find((pl) => pl.name === name);
      return [name, p?.version ?? "unknown"] as [string, string];
    })
    .sort(([a], [b]) => a.localeCompare(b));
  const excluded = Object.entries(profile.excludedItems ?? {})
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([k, v]) => [k, [...v].sort()] as [string, string[]])
    .sort(([a], [b]) => a.localeCompare(b));
  const payload = JSON.stringify({ v: 1, plugins: enabledWithVersions, excluded });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function symlinkSelectedCaches(profile: Profile, configDir: string, plugins: PluginEntry[]): void {
  const sourceCache = path.join(CLAUDE_HOME, "plugins", "cache");
  const targetCache = path.join(configDir, "plugins", "cache");

  // Move the old cache dir aside in one O(1) rename, then recreate it empty.
  // The slow `rm -rf` of the previous filtered-copy trees (~1.9s on a
  // plugin-heavy profile) runs in a detached background process so it never
  // blocks the assembly hot path. Detached + unref means the cleanup survives
  // even if the parent Electron process exits before it finishes.
  const pluginsParent = path.join(configDir, "plugins");
  if (fs.existsSync(targetCache)) {
    const trashDir = path.join(pluginsParent, `cache.trash.${Date.now()}.${process.pid}`);
    try {
      fs.renameSync(targetCache, trashDir);
      spawn("rm", ["-rf", trashDir], { detached: true, stdio: "ignore" }).unref();
    } catch {
      // Rename can fail if something holds the dir open. Fall back to
      // synchronous removal so assembly still produces a clean state.
      try { fs.rmSync(targetCache, { recursive: true, force: true }); } catch {}
    }
  }
  fs.mkdirSync(targetCache, { recursive: true });

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

    // Replace the specific plugin dir with a structured overlay.
    //
    // Previous approach: deep-clone the entire plugin tree via fs.cpSync +
    // COPYFILE_FICLONE, filtering out the excluded paths along the way. On
    // APFS the clones were reflinks so the data was free, but cpSync still
    // walked the whole source tree (readdir + stat per entry) and paid
    // filesystem metadata overhead per kept file. For a 13-plugin profile
    // where several plugins are multi-hundred-file bundles, this burned
    // 4-5 seconds on every save that invalidated the fingerprint.
    //
    // New approach: walk only the *ancestor chain* leading to each excluded
    // item, materialising real directories along that chain and symlinking
    // everything else (whole subtrees) back to the source. Cost scales with
    // the number of directories that contain exclusions, not the total file
    // count. A "1500 skills, want 5" bundle goes from seconds to ~5 symlink
    // ops plus a manifest rewrite.
    //
    // Structure of the result:
    //   pluginDir/
    //     <version>/                     — real dir (ancestor)
    //       .claude-plugin/              — real dir (ancestor — manifest patch)
    //         plugin.json → source       — symlink
    //         marketplace.json            — real, patched copy
    //         <other files> → source     — symlinks
    //       skills/                      — real dir if any skill excluded
    //         kept-skill → source/...    — symlink (whole subtree)
    //         (excluded-skill omitted)
    //       commands/                    — real dir if any command excluded
    //         kept.md → source/...       — symlink
    //         (excluded.md omitted)
    //       lib/ → source/lib/           — symlink (whole subtree, no exclusions)
    //       readme.md → source/readme.md — symlink
    const pluginDir = path.join(marketplaceDir, plugin.pluginName);
    if (!fs.existsSync(pluginDir)) continue;

    const pluginStat = fs.lstatSync(pluginDir);
    if (!pluginStat.isSymbolicLink()) continue;
    const realPluginDir = fs.realpathSync(pluginDir);
    fs.unlinkSync(pluginDir);

    // Resolve each excluded item to a path relative to realPluginDir.
    // Skills exclude the containing directory (SKILL.md's parent);
    // agents/commands exclude the single file at item.path.
    const items = scanPluginItems(plugin);
    // Resolve installPath through realpathSync so it uses the same prefix as
    // realPluginDir — without this, any symlink in the path chain (e.g. macOS
    // /tmp → /private/tmp) causes path.relative to produce a "../" traversal
    // instead of the expected single-segment version dir.
    let resolvedInstallPath = plugin.installPath;
    try { resolvedInstallPath = fs.realpathSync(plugin.installPath); } catch {}
    const versionRel = path.relative(realPluginDir, resolvedInstallPath);

    const excludedPaths = new Set<string>();
    const excludedAncestors = new Set<string>();
    const addAncestors = (rel: string) => {
      let anc = path.dirname(rel);
      while (anc && anc !== "." && anc !== path.sep) {
        excludedAncestors.add(anc);
        const next = path.dirname(anc);
        if (next === anc) break;
        anc = next;
      }
    };
    for (const item of items) {
      if (!excludedNames.includes(item.name)) continue;
      const excludeAbs = item.type === "skill" ? path.dirname(item.path) : item.path;
      // item.path is based on plugin.installPath which may contain unresolved
      // symlinks (e.g. /tmp → /private/tmp on macOS). Compute the path
      // relative to installPath (guaranteed same prefix), then anchor it to
      // realPluginDir via the resolved versionRel to stay in the right
      // namespace.
      const relToInstall = path.relative(plugin.installPath, excludeAbs);
      if (!relToInstall || relToInstall.startsWith("..") || path.isAbsolute(relToInstall)) continue;
      const rel = versionRel ? path.join(versionRel, relToInstall) : relToInstall;
      excludedPaths.add(rel);
      addAncestors(rel);
    }

    // Container-pattern fix: plugins declaring "skills": "./" rely on Claude
    // Code's scanner resolving "./" relative to installPath. But plugin.json
    // is a symlink in the overlay, and Claude Code may follow the symlink
    // and resolve "./" against the SOURCE directory instead — bypassing the
    // overlay entirely. Additionally, the source may ship a root-level
    // SKILL.md (an aggregation skill) that makes Claude Code treat the whole
    // plugin as a single skill.
    //
    // Fix: for container-pattern plugins, write a MODIFIED plugin.json (real
    // file, not a symlink) that replaces "skills": "./" with an explicit
    // list of only the kept skill directories. This forces Claude Code to
    // load exactly the skills that survived the exclusion filter, regardless
    // of how it resolves relative paths or handles root SKILL.md files.
    const pluginManifest = readPluginManifest(resolvedInstallPath);
    let isContainerPattern = false;
    if (pluginManifest) {
      const skillsDecl = normaliseManifestPaths(pluginManifest.skills);
      if (skillsDecl && skillsDecl.some((s: string) => s === "./" || s === ".")) {
        isContainerPattern = true;
        // Exclude the root SKILL.md (aggregation skill) from the overlay.
        const rootSkillMd = path.join(resolvedInstallPath, "SKILL.md");
        if (fs.existsSync(rootSkillMd)) {
          const rootSkillRel = versionRel ? path.join(versionRel, "SKILL.md") : "SKILL.md";
          excludedPaths.add(rootSkillRel);
        }
      }
    }

    // Always force-materialise the version dir + .claude-plugin so we can
    // shadow marketplace.json with a patched copy. Mark the file itself as
    // excluded (the overlay walker won't symlink it) and write it manually
    // after the walk.
    const claudePluginRel = versionRel
      ? path.join(versionRel, ".claude-plugin")
      : ".claude-plugin";
    const marketplaceRel = path.join(claudePluginRel, "marketplace.json");
    if (versionRel && !versionRel.startsWith("..")) {
      excludedAncestors.add(versionRel);
    }
    excludedAncestors.add(claudePluginRel);
    excludedPaths.add(marketplaceRel);

    overlayDir(realPluginDir, pluginDir, "", excludedPaths, excludedAncestors);

    // Write the patched marketplace.json at its overlay location.
    const sourceMarketplaceJson = path.join(realPluginDir, marketplaceRel);
    const targetMarketplaceJson = path.join(pluginDir, marketplaceRel);
    if (fs.existsSync(sourceMarketplaceJson)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(sourceMarketplaceJson, "utf-8"));
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
        fs.mkdirSync(path.dirname(targetMarketplaceJson), { recursive: true });
        fs.writeFileSync(targetMarketplaceJson, JSON.stringify(manifest, null, 2));
      } catch {}
    }

    // Container-pattern fix: plugins with "skills": "./" have skills at the
    // root level, not in a skills/ subdirectory. Claude Code's runtime only
    // supports conventional scanning (looks for <installPath>/skills/), so
    // these root-level skills are invisible to it. Fix: create a conventional
    // skills/ directory in the overlay and symlink the kept skills into it.
    // Also write a patched plugin.json without the "skills" field so Claude
    // Code falls through to conventional scanning instead of trying "./"
    // resolution (which follows the symlink back to the source).
    if (isContainerPattern) {
      const overlayVersionDir = path.join(pluginDir, versionRel || "");
      const skillsDir = path.join(overlayVersionDir, "skills");
      fs.mkdirSync(skillsDir, { recursive: true });

      // Find kept skill dirs in the overlay root and symlink them into skills/.
      for (const entry of fs.readdirSync(overlayVersionDir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "skills") continue;
        const entryPath = path.join(overlayVersionDir, entry.name);
        const isDir = entry.isDirectory() || (entry.isSymbolicLink() && (() => {
          try { return fs.statSync(entryPath).isDirectory(); } catch { return false; }
        })());
        if (!isDir) continue;
        if (fs.existsSync(path.join(entryPath, "SKILL.md"))) {
          const tgt = path.join(skillsDir, entry.name);
          if (!fs.existsSync(tgt)) {
            // Symlink to the SOURCE skill dir (not the overlay symlink) for
            // a clean resolution chain.
            const sourcePath = path.join(resolvedInstallPath, entry.name);
            fs.symlinkSync(sourcePath, tgt);
          }
        }
      }

      // Write a patched plugin.json without the "skills" field so Claude Code
      // falls through to conventional skills/ dir scanning.
      if (pluginManifest) {
        const patched = { ...pluginManifest };
        delete patched.skills;
        const targetPluginJson = path.join(overlayVersionDir, ".claude-plugin", "plugin.json");
        // Remove the symlink first if it exists.
        try { fs.unlinkSync(targetPluginJson); } catch {}
        fs.writeFileSync(targetPluginJson, JSON.stringify(patched, null, 2));
      }
    }
  }
}



/**
 * Fix container-pattern plugins that declare "skills": "./" but have no
 * conventional skills/ subdirectory. Claude Code only scans <installPath>/skills/
 * so these plugins load zero skills. For each such plugin, we:
 *   1. Break the version-dir symlink if needed (create a mini-overlay)
 *   2. Create a skills/ directory with symlinks to the kept skill subdirs
 *   3. Write a patched plugin.json without the "skills" field
 *
 * Skips plugins that already have a skills/ dir (conventional layout) or
 * that were already handled by applyExclusions (which builds a full overlay).
 */
function fixContainerPatternPlugins(
  profile: Profile,
  configDir: string,
  plugins: PluginEntry[],
): void {
  const excludedPlugins = new Set(Object.keys(profile.excludedItems ?? {}).filter(
    (k) => (profile.excludedItems?.[k]?.length ?? 0) > 0,
  ));

  for (const pluginName of profile.plugins) {
    // Skip plugins that have exclusions — applyExclusions handles those.
    if (excludedPlugins.has(pluginName)) continue;

    const plugin = plugins.find((p) => p.name === pluginName);
    if (!plugin) continue;

    // Read the plugin manifest to check for container pattern.
    const manifest = readPluginManifest(plugin.installPath);
    if (!manifest) continue;
    const skillsDecl = normaliseManifestPaths(manifest.skills);
    if (!skillsDecl || !skillsDecl.some((s: string) => s === "./" || s === ".")) continue;

    // Already has a conventional skills/ dir — nothing to fix.
    if (fs.existsSync(path.join(plugin.installPath, "skills"))) continue;

    // Locate the version dir inside the profile's cache.
    const cachePluginDir = path.join(
      configDir, "plugins", "cache",
      plugin.marketplace, plugin.pluginName,
    );
    if (!fs.existsSync(cachePluginDir)) continue;

    // The version dir might be a real dir (from a previous fix) or accessed
    // through the marketplace symlink. Resolve to the real source.
    const versionDir = path.join(cachePluginDir, plugin.version);
    let realVersionDir: string;
    try {
      realVersionDir = fs.realpathSync(versionDir);
    } catch {
      continue;
    }

    // If the version dir is inside the global cache (i.e. not already an
    // overlay), we need to break the symlink chain to create a writable layer.
    // Strategy: replace the plugin-level dir with a mini-overlay containing
    // just the version dir as a real directory with symlinked children.
    const cachePluginStat = fs.lstatSync(cachePluginDir);
    if (cachePluginStat.isSymbolicLink()) {
      // cachePluginDir is a symlink — we're inside a marketplace symlink chain.
      // Need to break the marketplace symlink first.
      const marketplaceDir = path.dirname(cachePluginDir);
      const marketplaceStat = fs.lstatSync(marketplaceDir);
      if (marketplaceStat.isSymbolicLink()) {
        const realMp = fs.realpathSync(marketplaceDir);
        fs.unlinkSync(marketplaceDir);
        fs.mkdirSync(marketplaceDir, { recursive: true });
        for (const child of fs.readdirSync(realMp)) {
          const tgt = path.join(marketplaceDir, child);
          if (!fs.existsSync(tgt)) fs.symlinkSync(path.join(realMp, child), tgt);
        }
      }
      // Now cachePluginDir is still a symlink inside the (now real) marketplace dir.
      // Replace it with a real dir.
      const realPluginDir = fs.realpathSync(cachePluginDir);
      fs.unlinkSync(cachePluginDir);
      fs.mkdirSync(cachePluginDir, { recursive: true });
      // Symlink the version dir and any siblings.
      for (const child of fs.readdirSync(realPluginDir)) {
        const tgt = path.join(cachePluginDir, child);
        if (!fs.existsSync(tgt)) fs.symlinkSync(path.join(realPluginDir, child), tgt);
      }
    }

    // Now break the version dir symlink into a real dir with per-child symlinks.
    const versionStat = fs.lstatSync(versionDir);
    if (versionStat.isSymbolicLink()) {
      const realVer = fs.realpathSync(versionDir);
      fs.unlinkSync(versionDir);
      fs.mkdirSync(versionDir, { recursive: true });
      for (const child of fs.readdirSync(realVer)) {
        // Skip the root SKILL.md (aggregation skill) for container-pattern plugins.
        if (child === "SKILL.md") continue;
        const tgt = path.join(versionDir, child);
        if (!fs.existsSync(tgt)) fs.symlinkSync(path.join(realVer, child), tgt);
      }
    }

    // Create the conventional skills/ directory.
    const skillsDir = path.join(versionDir, "skills");
    if (fs.existsSync(skillsDir)) continue; // already created (idempotent)
    fs.mkdirSync(skillsDir, { recursive: true });

    // Symlink skill subdirs into skills/.
    for (const entry of fs.readdirSync(versionDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "skills") continue;
      const entryPath = path.join(versionDir, entry.name);
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && (() => {
        try { return fs.statSync(entryPath).isDirectory(); } catch { return false; }
      })());
      if (!isDir) continue;
      if (fs.existsSync(path.join(entryPath, "SKILL.md"))) {
        const tgt = path.join(skillsDir, entry.name);
        if (!fs.existsSync(tgt)) {
          fs.symlinkSync(path.join(realVersionDir, entry.name), tgt);
        }
      }
    }

    // Write a patched plugin.json without the "skills" field.
    const pluginJsonPath = path.join(versionDir, ".claude-plugin", "plugin.json");
    const pluginJsonStat = fs.lstatSync(pluginJsonPath);
    if (pluginJsonStat.isSymbolicLink()) {
      fs.unlinkSync(pluginJsonPath);
    }
    const patched = { ...manifest };
    delete patched.skills;
    fs.writeFileSync(pluginJsonPath, JSON.stringify(patched, null, 2));
  }
}

/**
 * Walk `srcDir`, materialising `dstDir` as a mix of real dirs (for paths that
 * lead to excluded items) and symlinks (for subtrees with no exclusions).
 *
 * - Paths in `excludedPaths` are omitted entirely.
 * - Paths in `excludedAncestors` are created as real directories and recursed
 *   into — one level deeper on the chain toward an excluded item.
 * - Everything else is symlinked directly to its source counterpart, which
 *   means whole unrelated subtrees stay shared with the global plugin cache.
 *
 * Cost: O(directories on the ancestor chain + immediate children of each
 * ancestor). For a plugin with ~2000 files where 3 skills are excluded,
 * that's roughly 15-50 filesystem operations instead of 2000+ clonefile
 * calls — typically 50-200× fewer syscalls than the previous approach.
 */
function overlayDir(
  srcDir: string,
  dstDir: string,
  relPrefix: string,
  excludedPaths: Set<string>,
  excludedAncestors: Set<string>,
): void {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcChild = path.join(srcDir, entry.name);
    const dstChild = path.join(dstDir, entry.name);
    const relChild = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
    if (excludedPaths.has(relChild)) continue;
    if (excludedAncestors.has(relChild)) {
      overlayDir(srcChild, dstChild, relChild, excludedPaths, excludedAncestors);
      continue;
    }
    fs.symlinkSync(srcChild, dstChild);
  }
}

/**
 * Recursive directory copy that uses APFS clonefile reflinks on macOS via
 * `COPYFILE_FICLONE` — files become copy-on-write references to the source
 * inode instead of full data copies, so a multi-thousand-file plugin tree
 * clones in tens of milliseconds instead of multiple seconds. On non-APFS
 * filesystems the flag silently falls back to a normal copy, so this is
 * always at least as fast as the old file-by-file implementation.
 *
 * Used for both filtered plugin copies in applyExclusions and the builtin
 * plugin installer — both call paths are on the user's profile-assembly
 * hot path.
 */
function copyDirRecursive(src: string, dest: string): void {
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    mode: fs.constants.COPYFILE_FICLONE,
  });
}

const BUILTIN_PLUGIN_NAME = "profiles-manager@claude-profiles";
const BUILTIN_PLUGIN_VERSION = "1.0.0";


export function ensureBuiltinPlugin(): string {
  // Install the built-in profiles-manager plugin so it appears as a normal
  // marketplace plugin. Three things need to exist:
  //   1. Plugin files in the cache: ~/.claude/plugins/cache/claude-profiles/profiles-manager/<version>/
  //   2. Marketplace manifest: ~/.claude/plugins/marketplaces/claude-profiles/.claude-plugin/marketplace.json
  //   3. Entry in ~/.claude/plugins/known_marketplaces.json
  //   4. Entry in ~/.claude/plugins/installed_plugins.json
  const marketplaceRoot = path.join(CLAUDE_HOME, "plugins", "marketplaces", "claude-profiles");
  const cacheDir = path.join(CLAUDE_HOME, "plugins", "cache", "claude-profiles", "profiles-manager", BUILTIN_PLUGIN_VERSION);

  // Source: check dev path first, then production path
  const devPath = path.join(__dirname, "..", "..", "src", "builtin-plugin");
  const prodPath = path.join(__dirname, "..", "builtin-plugin");
  const src = fs.existsSync(devPath) ? devPath : prodPath;
  if (!fs.existsSync(src)) return cacheDir;

  const now = new Date().toISOString();

  // 1. Copy plugin files to cache (always overwrite to get latest)
  if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  copyDirRecursive(src, cacheDir);

  // 2. Create marketplace manifest with plugin source pointing to cache
  const pluginMetaDir = path.join(marketplaceRoot, ".claude-plugin");
  fs.mkdirSync(pluginMetaDir, { recursive: true });
  // Also put plugin files under marketplaces/ so Claude can resolve the source path
  const mktPluginDir = path.join(marketplaceRoot, "plugins", "profiles-manager");
  if (fs.existsSync(mktPluginDir)) fs.rmSync(mktPluginDir, { recursive: true });
  fs.mkdirSync(mktPluginDir, { recursive: true });
  copyDirRecursive(src, mktPluginDir);
  fs.writeFileSync(path.join(pluginMetaDir, "marketplace.json"), JSON.stringify({
    "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
    name: "claude-profiles",
    description: "Built-in plugins for the Claude Profiles app",
    owner: { name: "Claude Profiles" },
    plugins: [{
      name: "profiles-manager",
      description: "Self-management skills — list add-ons, create profiles and teams, check status, discover plugins.",
      source: "./plugins/profiles-manager",
      category: "productivity",
    }],
  }, null, 2));

  // 3. Register in known_marketplaces.json
  const knownPath = path.join(CLAUDE_HOME, "plugins", "known_marketplaces.json");
  let known: any = {};
  if (fs.existsSync(knownPath)) {
    try { known = JSON.parse(fs.readFileSync(knownPath, "utf-8")); } catch {}
  }
  if (!known["claude-profiles"] || known["claude-profiles"].installLocation !== marketplaceRoot) {
    known["claude-profiles"] = {
      source: { source: "directory", path: marketplaceRoot },
      installLocation: marketplaceRoot,
      lastUpdated: now,
    };
    fs.writeFileSync(knownPath, JSON.stringify(known, null, 2));
  }

  // 4. Register in installed_plugins.json
  const manifestPath = path.join(CLAUDE_HOME, "plugins", "installed_plugins.json");
  let manifest: any = { plugins: {} };
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")); } catch {}
  }
  if (!manifest.plugins[BUILTIN_PLUGIN_NAME]) {
    manifest.plugins[BUILTIN_PLUGIN_NAME] = [{
      scope: "user",
      installPath: cacheDir,
      version: BUILTIN_PLUGIN_VERSION,
      installedAt: now,
      lastUpdated: now,
    }];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } else {
    const entry = manifest.plugins[BUILTIN_PLUGIN_NAME][0];
    if (entry.installPath !== cacheDir || entry.version !== BUILTIN_PLUGIN_VERSION) {
      entry.installPath = cacheDir;
      entry.version = BUILTIN_PLUGIN_VERSION;
      entry.lastUpdated = now;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
  }

  return cacheDir;
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

  // Symlink only marketplaces the profile actually needs. Symlinking every
  // marketplace unconditionally (the previous behaviour) let Claude Code
  // discover plugins from marketplaces the user hadn't enabled and
  // auto-register them into the profile's installed_plugins.json with a
  // synthetic `version: "unknown"` entry — defeating profile isolation for
  // any plugin whose marketplace was installed globally, most notably the
  // built-in `claude-profiles` marketplace containing profiles-manager.
  const neededMarketplaces = new Set<string>();
  for (const pluginName of profile.plugins) {
    const marketplace = pluginName.split("@")[1];
    if (marketplace) neededMarketplaces.add(marketplace);
  }
  const sourceMp = path.join(CLAUDE_HOME, "plugins", "marketplaces");
  const targetMp = path.join(configDir, "plugins", "marketplaces");

  // Clean up stale marketplace symlinks from a previous assembly so toggling
  // a plugin off actually removes its marketplace from the profile.
  if (fs.existsSync(targetMp)) {
    for (const entry of fs.readdirSync(targetMp)) {
      if (neededMarketplaces.has(entry)) continue;
      const stale = path.join(targetMp, entry);
      try {
        const stat = fs.lstatSync(stale);
        if (stat.isSymbolicLink()) fs.unlinkSync(stale);
      } catch { /* ignore */ }
    }
  }

  if (fs.existsSync(sourceMp)) {
    for (const entry of fs.readdirSync(sourceMp)) {
      if (!neededMarketplaces.has(entry)) continue;
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

export async function updateMarketplace(name: string): Promise<void> {
  const claudeHome = path.join(os.homedir(), ".claude");
  await execFileAsync(findRealClaudeBinary(), [
    "plugin", "marketplace", "update", name,
  ], { env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome }, timeout: 120000 });
}

export async function updateAllMarketplaces(): Promise<void> {
  const claudeHome = path.join(os.homedir(), ".claude");
  await execFileAsync(findRealClaudeBinary(), [
    "plugin", "marketplace", "update",
  ], { env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome }, timeout: 120000 });
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

function readTeamsStore(): TeamsStore {
  if (!fs.existsSync(TEAMS_JSON)) return { schemaVersion: TEAMS_SCHEMA_VERSION, teams: {} };
  const raw = JSON.parse(fs.readFileSync(TEAMS_JSON, "utf-8"));
  return migrateTeamsStore(raw);
}

function writeTeamsStore(store: TeamsStore): void {
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

// Frontmatter parse results cached per-file keyed on mtime. scanPluginItems
// and scanUserLocalPlugins call readFrontmatter once per skill / agent /
// command — on a heavy profile that's hundreds of readFileSync + YAML parses
// per cold scan. mtime is a reliable "content changed" signal for regular
// markdown files, so repeat reads after the first scan become a single stat
// call plus a map lookup.
//
// Entries are never explicitly evicted — worst-case memory is O(files ever
// seen in the session), which tops out around a few hundred small objects
// for the heaviest users. A restart clears it.
const _frontmatterCache = new Map<
  string,
  { mtimeMs: number; parsed: Record<string, string> }
>();

function readFrontmatter(filePath: string): Record<string, string> {
  // Let stat throw naturally on missing files — matches the previous
  // readFileSync-based contract (call sites pre-check with fs.existsSync).
  const mtimeMs = fs.statSync(filePath).mtimeMs;
  const cached = _frontmatterCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.parsed;

  const result: Record<string, string> = {};
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  if (!lines[0] || lines[0].trim() !== "---") {
    _frontmatterCache.set(filePath, { mtimeMs, parsed: result });
    return result;
  }

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
  _frontmatterCache.set(filePath, { mtimeMs, parsed: result });
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

/** See PROFILES_SCHEMA_VERSION — same pattern for global-defaults.json. */
const GLOBAL_DEFAULTS_SCHEMA_VERSION = 1;

function migrateGlobalDefaults(raw: any): any {
  if (!raw || typeof raw !== "object") return { schemaVersion: GLOBAL_DEFAULTS_SCHEMA_VERSION };
  const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
  let data: any = raw;
  if (version < 1) {
    data = { ...data, schemaVersion: 1 };
  }
  return data;
}

export function getGlobalDefaults(): { model: string; opusContext?: "200k" | "1m"; sonnetContext?: "200k" | "1m"; effortLevel: string; env?: Record<string, string>; customFlags?: string; terminalApp?: string; tmuxMode?: string } {
  try {
    const data = migrateGlobalDefaults(JSON.parse(fs.readFileSync(GLOBAL_DEFAULTS_JSON, "utf-8")));
    return { model: data.model ?? "", opusContext: data.opusContext, sonnetContext: data.sonnetContext, effortLevel: data.effortLevel ?? "", env: data.env, customFlags: data.customFlags, terminalApp: data.terminalApp, tmuxMode: data.tmuxMode };
  } catch {
    return { model: "", effortLevel: "" };
  }
}

export function saveGlobalDefaults(defaults: { model: string; opusContext?: "200k" | "1m"; sonnetContext?: "200k" | "1m"; effortLevel: string; env?: Record<string, string>; customFlags?: string; terminalApp?: string; tmuxMode?: string }): void {
  // schemaVersion spread last so the constant always wins over any stale
  // value that might be in the defaults object.
  const stamped = { ...defaults, schemaVersion: GLOBAL_DEFAULTS_SCHEMA_VERSION };
  fs.writeFileSync(GLOBAL_DEFAULTS_JSON, JSON.stringify(stamped, null, 2));
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

// ---------------------------------------------------------------------------
// Curated marketplace
// ---------------------------------------------------------------------------

import type { CuratedMarketplaceData, CuratedIndex } from "./types";

let curatedCache: CuratedMarketplaceData | null = null;
let curatedIndexCache: CuratedIndex | null = null;

// ---------------------------------------------------------------------------
// GitHub API backend
// ---------------------------------------------------------------------------
//
// Three-level backend detection, picked once at first use and cached for the
// session:
//
//   1. `gh` CLI authenticated → use `gh api`. 5000/h quota, access to any
//      private repo the user has permissions for, multi-host support
//      (e.g. GitHub Enterprise).
//   2. `GITHUB_TOKEN` env var set → use fetch() with an Authorization header.
//      Same 5000/h quota, any private repo the token grants, no `gh` CLI
//      required.
//   3. Neither → fall back to unauthenticated fetch(). 60/h quota,
//      public repos only.
//
// Every GitHub call site goes through `githubApi(path, opts)`; the backend
// dispatch is invisible to callers. Detection runs once per session, so users
// who install/configure `gh` mid-session need to restart to pick it up.

type GitHubBackend =
  | { kind: "gh" }
  | { kind: "fetch-authed"; token: string }
  | { kind: "fetch-anon" };

let _ghBackend: GitHubBackend | null = null;
let _ghBinaryPathCache: string | null = null;

/**
 * Locate the `gh` CLI binary. Checks `GH_PATH` first (override), then common
 * install locations, then falls back to bare "gh" (which lets execFileAsync
 * try the runtime PATH — may still succeed in dev-mode Electron).
 *
 * Electron on macOS launched from a `.app` bundle inherits a minimal PATH
 * that usually excludes Homebrew locations, so hardcoding the bundle-safe
 * absolute path is more reliable than trusting PATH. Apple Silicon and Intel
 * Homebrew use different prefixes, hence the two-candidate check.
 */
function ghBinary(): string {
  if (_ghBinaryPathCache) return _ghBinaryPathCache;
  const override = process.env.GH_PATH;
  if (override) {
    _ghBinaryPathCache = override;
    return override;
  }
  const candidates = [
    "/opt/homebrew/bin/gh",    // macOS Apple Silicon Homebrew
    "/usr/local/bin/gh",       // macOS Intel Homebrew, Linux /usr/local
    "/usr/bin/gh",             // Linux system install
    "/home/linuxbrew/.linuxbrew/bin/gh", // Linuxbrew
  ];
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      _ghBinaryPathCache = c;
      return c;
    } catch {
      // try next
    }
  }
  // Fall back to bare name — execFileAsync will search PATH if the host
  // environment has it available (dev mode, most tests).
  _ghBinaryPathCache = "gh";
  return "gh";
}

async function detectGitHubBackend(): Promise<GitHubBackend> {
  if (_ghBackend) return _ghBackend;
  // Level 1: gh CLI authenticated. `gh auth status` exits 0 only when at
  // least one host is logged in; otherwise it errors. Bounded 3s timeout in
  // case gh is installed but hangs on a flaky config file.
  try {
    await execFileAsync(ghBinary(), ["auth", "status"], { timeout: 3000 });
    _ghBackend = { kind: "gh" };
    return _ghBackend;
  } catch {
    // fall through to fetch-based backends
  }
  // Level 2: GITHUB_TOKEN env var (authenticated fetch, no gh needed).
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    _ghBackend = { kind: "fetch-authed", token };
    return _ghBackend;
  }
  // Level 3: unauthenticated fetch. Public repos only, 60/h quota.
  _ghBackend = { kind: "fetch-anon" };
  return _ghBackend;
}

/**
 * Public backend state for the UI. Browse-tab callers can use this to show a
 * quota/limits banner explaining what mode the app is running in and how to
 * raise the rate limit.
 */
export async function getGitHubBackendState(): Promise<{
  kind: "gh" | "fetch-authed" | "fetch-anon";
  rateLimit: "5000/h" | "60/h";
  description: string;
  upgradeHint: string | null;
}> {
  const b = await detectGitHubBackend();
  switch (b.kind) {
    case "gh":
      return {
        kind: "gh",
        rateLimit: "5000/h",
        description: "Authenticated via `gh` CLI",
        upgradeHint: null,
      };
    case "fetch-authed":
      return {
        kind: "fetch-authed",
        rateLimit: "5000/h",
        description: "Authenticated via GITHUB_TOKEN env var",
        upgradeHint: null,
      };
    case "fetch-anon":
      return {
        kind: "fetch-anon",
        rateLimit: "60/h",
        description: "Unauthenticated — public repos only",
        upgradeHint: "Install `gh` CLI (https://cli.github.com) and run `gh auth login`, or set GITHUB_TOKEN in your environment, to raise the limit to 5000/h and access private marketplaces.",
      };
  }
}

/**
 * Unified GitHub API helper. Routes through whichever backend was detected
 * at startup; callers never have to know which one.
 *
 * Raw vs JSON media:
 *   - `raw: true` → `application/vnd.github.raw`. Use for file-content fetches
 *     (marketplace.json, SKILL.md, plugin.json, README, index.json). Avoids
 *     the JSON contents endpoint's 1 MB limit and skips base64 encoding.
 *   - `raw: false` (default) → `application/vnd.github+json`. Use for
 *     directory listings and symlink detection (where the `type` / `target`
 *     fields are needed).
 *
 * 50 MB `maxBuffer` on the `gh` path prevents Node's 1 MB child-process
 * default from silently truncating large payloads — this previously broke
 * index.json fetching once the search index grew past the 1 MB default.
 */
async function githubApi(
  apiPath: string,
  opts: { raw?: boolean; timeout?: number } = {},
): Promise<string> {
  const backend = await detectGitHubBackend();
  const timeout = opts.timeout ?? 15000;
  const accept = opts.raw ? "application/vnd.github.raw" : "application/vnd.github+json";

  if (backend.kind === "gh") {
    const { stdout } = await execFileAsync(ghBinary(), [
      "api",
      apiPath,
      "-H", `Accept: ${accept}`,
    ], { timeout, maxBuffer: 50 * 1024 * 1024 });
    return stdout;
  }

  // fetch-authed and fetch-anon share the fetch path; the only difference is
  // whether we attach an Authorization header.
  const url = `https://api.github.com/${apiPath.replace(/^\//, "")}`;
  const headers: Record<string, string> = {
    "User-Agent": "claude-profiles",
    "Accept": accept,
  };
  if (backend.kind === "fetch-authed") {
    headers["Authorization"] = `token ${backend.token}`;
  }
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} on ${apiPath}: ${res.statusText}`);
  }
  return await res.text();
}

// ---------------------------------------------------------------------------
// LRU caches for quota-sensitive call sites
// ---------------------------------------------------------------------------
//
// `fetchRepoReadme` and `fetchUpstreamMarketplace` are called from the curated
// detail modal every time it opens. Without caching, repeat opens cost one
// round-trip each — under the `fetch-anon` backend (60/h quota) that adds up
// fast for anyone casually browsing. Both are idempotent for the life of a
// session; a restart refreshes. Map-based LRU is sufficient.
const README_CACHE_MAX = 50;
const MARKETPLACE_CACHE_MAX = 50;
const _readmeCache = new Map<string, string>();
const _marketplaceCache = new Map<string, Record<string, any>>();

function lruTouch<K, V>(cache: Map<K, V>, key: K, val: V, max: number): void {
  cache.delete(key);
  cache.set(key, val);
  if (cache.size > max) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Fetches a file from the curator's own marketplace repo. */
async function fetchGitHubFileContent(repoPath: string): Promise<string> {
  return githubApi(
    `repos/Mduffy37/claude-profiles-marketplace/contents/${repoPath}`,
    { raw: true },
  );
}

/** Fetch a raw file from any public GitHub repo. */
async function fetchAnyRepoFile(source: string, filePath: string): Promise<string> {
  return githubApi(`repos/${source}/contents/${filePath}`, { raw: true });
}

/**
 * Resolve a relative symlink target against the symlink's own location.
 * Pure path math — no network. Returns null if the target escapes repo root.
 */
function resolveSymlinkTargetPath(symlinkPath: string, target: string): string | null {
  const parentDir = path.posix.dirname(symlinkPath);
  const joined = path.posix.join(parentDir, target);
  const normalised = path.posix.normalize(joined);
  if (
    normalised.startsWith("..") ||
    normalised.startsWith("/") ||
    normalised === "" ||
    normalised === "."
  ) {
    return null;
  }
  return normalised;
}

/**
 * Chase a path through any symlinks via the GitHub contents API (JSON form).
 * Returns the final non-symlink path, or null if broken/looping/escaping.
 * Depth-capped at 3. If the input is not a symlink, returns it unchanged.
 *
 * GitHub's contents API does not follow symlinks server-side: fetching a path
 * that traverses an intermediate symlink returns 404, and fetching a symlink
 * blob directly returns `{type: "symlink", target: ...}`. This helper is the
 * client-side workaround — without it, any plugin that cross-publishes via
 * symlinks (e.g. redis/agent-skills) enumerates as empty.
 */
async function resolveSymlink(source: string, repoPath: string, depth = 0): Promise<string | null> {
  if (depth >= 3) return null;
  const cleanPath = repoPath.replace(/^\/+/, "");
  try {
    const stdout = await githubApi(`repos/${source}/contents/${cleanPath}`);
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) return cleanPath;
    if (parsed && parsed.type === "symlink" && typeof parsed.target === "string") {
      const resolved = resolveSymlinkTargetPath(cleanPath, parsed.target);
      if (!resolved) return null;
      return resolveSymlink(source, resolved, depth + 1);
    }
    return cleanPath;
  } catch {
    return null;
  }
}

/**
 * List a directory's contents in any public GitHub repo. Returns entries with name/type/path.
 * Transparently follows the case where `dirPath` is itself a symlink to another directory
 * (depth-capped at 3). Symlink *children* inside the listing are returned as-is with
 * type === "symlink" — callers that want to descend must call resolveSymlink on them.
 */
async function fetchAnyRepoDir(source: string, dirPath: string, depth = 0): Promise<Array<{ name: string; type: string; path: string }>> {
  if (depth >= 3) return [];
  const stdout = await githubApi(`repos/${source}/contents/${dirPath}`);
  const data = JSON.parse(stdout);
  if (!Array.isArray(data)) {
    if (data && data.type === "symlink" && typeof data.target === "string") {
      const resolved = resolveSymlinkTargetPath(dirPath.replace(/^\/+/, ""), data.target);
      if (!resolved) return [];
      return fetchAnyRepoDir(source, resolved, depth + 1);
    }
    return [];
  }
  return data.map((e: any) => ({ name: e.name, type: e.type, path: e.path }));
}

/** Content-based frontmatter parser — mirrors readFrontmatter() but takes a string instead of a file path. */
function parseFrontmatterString(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split("\n");
  if (!lines[0] || lines[0].trim() !== "---") return result;

  let currentKey: string | null = null;
  let multilineValue: string[] = [];

  const flushMultiline = () => {
    if (currentKey && multilineValue.length > 0) {
      result[currentKey] = multilineValue.join(" ").trim();
    }
    currentKey = null;
    multilineValue = [];
  };

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { flushMultiline(); break; }
    if (currentKey && lines[i].length > 0 && (lines[i][0] === " " || lines[i][0] === "\t")) {
      multilineValue.push(lines[i].trim());
      continue;
    }
    flushMultiline();
    const colonIdx = lines[i].indexOf(":");
    if (colonIdx !== -1) {
      const key = lines[i].slice(0, colonIdx).trim();
      const value = lines[i].slice(colonIdx + 1).trim();
      if (value === ">" || value === "|" || value === ">-" || value === "|-") {
        currentKey = key;
        multilineValue = [];
      } else {
        result[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  }
  return result;
}

/**
 * Fetch a repo's README as raw markdown. Cached per-source (see LRU notes
 * above) so the curated detail modal can be reopened without re-fetching.
 * Returns empty string on failure.
 *
 * We fetch `/readme` with `Accept: application/vnd.github.raw` which returns
 * the markdown directly — much simpler than the old `--jq ".content"` + base64
 * decode dance, and works identically on the `gh` and fetch backends.
 */
export async function fetchRepoReadme(source: string): Promise<string> {
  const cached = _readmeCache.get(source);
  if (cached !== undefined) {
    lruTouch(_readmeCache, source, cached, README_CACHE_MAX);
    return cached;
  }
  try {
    const raw = await githubApi(`repos/${source}/readme`, { raw: true });
    lruTouch(_readmeCache, source, raw, README_CACHE_MAX);
    return raw;
  } catch {
    return "";
  }
}

/**
 * Fetch an upstream Claude Code marketplace's manifest from GitHub without
 * registering it. Returns the parsed `.claude-plugin/marketplace.json` —
 * callers get the full upstream shape (typically `{ name, owner, plugins: [...] }`).
 * Cached per-source (see LRU notes above).
 */
export async function fetchUpstreamMarketplace(source: string): Promise<Record<string, any>> {
  const cached = _marketplaceCache.get(source);
  if (cached !== undefined) {
    lruTouch(_marketplaceCache, source, cached, MARKETPLACE_CACHE_MAX);
    return cached;
  }
  const raw = await fetchAnyRepoFile(source, ".claude-plugin/marketplace.json");
  const parsed = JSON.parse(raw);
  lruTouch(_marketplaceCache, source, parsed, MARKETPLACE_CACHE_MAX);
  return parsed;
}

/**
 * Fetch the list of skills/commands/agents inside a plugin without installing it.
 * Mirrors the logic in scanPluginItems() for local plugins:
 *   1. If `.claude-plugin/plugin.json` declares skills/commands/agents arrays, use those paths
 *      (the spec says manifest paths REPLACE conventional directories).
 *   2. Otherwise fall back to listing conventional `skills/`, `commands/`, `agents/` dirs.
 * For each item file, fetches its contents and parses frontmatter for name/description.
 *
 * `pluginPath` is the plugin's path within the repo (as declared in the upstream marketplace's
 * `plugins[].source` field — typically a relative path like `./` or `plugins/my-plugin`).
 */
export async function fetchPluginItems(source: string, pluginPath: string): Promise<PluginItem[]> {
  const items: PluginItem[] = [];
  // Normalise a path to have no leading "./" or leading/trailing slashes.
  const normalise = (p: string) => p.replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
  const basePath = normalise(pluginPath);
  // Join parts, normalising each, so "./" + "SKILL.md" doesn't become "//SKILL.md".
  const joinPath = (...parts: string[]) => parts.map(normalise).filter(Boolean).join("/");

  // plugin.json can declare each item type as:
  //   - an array of paths (the documented form)
  //   - a single string path (shorthand when there's only one)
  //   - missing entirely (fall back to conventional subdir)
  // Normalise string → [string] so the downstream loop is uniform.
  const asArray = (v: any): string[] | null => {
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
    if (typeof v === "string") return [v];
    return null;
  };

  // Attempt to read plugin.json manifest
  let manifest: Record<string, any> | null = null;
  try {
    const manifestRaw = await fetchAnyRepoFile(source, joinPath(basePath, ".claude-plugin", "plugin.json"));
    manifest = JSON.parse(manifestRaw);
  } catch {
    manifest = null;
  }

  const pluginDisplayName = manifest?.name ?? basePath ?? "unknown";

  const buildItem = async (itemPath: string, type: "skill" | "command" | "agent", fallbackName: string): Promise<PluginItem | null> => {
    try {
      const content = await fetchAnyRepoFile(source, itemPath);
      const fm = parseFrontmatterString(content);
      return {
        name: fm.name ?? fallbackName,
        description: (fm.description ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
        type,
        plugin: pluginDisplayName,
        path: itemPath,
        userInvocable: type === "skill" ? (fm["user-invocable"] ?? "true").toLowerCase() !== "false" : true,
        dependencies: [],
      };
    } catch {
      return null;
    }
  };

  // Helper: resolve a manifest-declared SKILL entry into an array of items.
  // Mirrors resolveSkillManifestEntry on the local side: a directory entry
  // can resolve to multiple skills (one per subdirectory with SKILL.md) OR
  // a single skill (the directory itself has SKILL.md). Prefer subdirectories
  // when both are present.
  const resolveSkillEntry = async (entry: string): Promise<PluginItem[]> => {
    const cleaned = normalise(entry);
    const full = cleaned ? joinPath(basePath, cleaned) : basePath;
    // Entry points directly at a .md file — single skill.
    if (full.endsWith(".md")) {
      const fallbackName = full.split("/").pop()?.replace(/\.md$/, "") ?? "unknown";
      const item = await buildItem(full, "skill", fallbackName);
      return item ? [item] : [];
    }
    // Entry points at a directory. Enumerate children and look for skill subdirs.
    let children: Array<{ name: string; type: string; path: string }> = [];
    try {
      children = await fetchAnyRepoDir(source, full);
    } catch {
      return [];
    }
    const subdirResults: PluginItem[] = [];
    for (const child of children) {
      let effectiveDir: string | null = null;
      if (child.type === "dir") {
        effectiveDir = child.path;
      } else if (child.type === "symlink") {
        effectiveDir = await resolveSymlink(source, child.path);
        if (!effectiveDir) continue;
      } else {
        continue;
      }
      const childSkillMd = joinPath(effectiveDir, "SKILL.md");
      // child.name preserves the symlink's own display name even when content comes from elsewhere.
      const item = await buildItem(childSkillMd, "skill", child.name);
      if (item) subdirResults.push(item);
    }
    if (subdirResults.length > 0) return subdirResults;
    // No skill subdirectories — fall back to treating the directory itself as a skill.
    const directSkillMd = joinPath(full, "SKILL.md");
    const lastSegment = (cleaned ? cleaned : basePath).split("/").filter(Boolean).pop() ?? "unknown";
    const directItem = await buildItem(directSkillMd, "skill", lastSegment);
    return directItem ? [directItem] : [];
  };

  // Helper: resolve a manifest-declared command/agent entry into a single item (or null).
  const resolveSingleFileEntry = async (entry: string, type: "command" | "agent"): Promise<PluginItem | null> => {
    const cleaned = normalise(entry);
    const full = cleaned ? joinPath(basePath, cleaned) : basePath;
    if (!full.endsWith(".md")) return null;
    const fallbackName = full.split("/").pop()?.replace(/\.md$/, "") ?? "unknown";
    return buildItem(full, type, fallbackName);
  };

  // Helper: enumerate a conventional directory (skills/, commands/, agents/) and fetch items
  const enumerateConventionalDir = async (subdir: string, type: "skill" | "command" | "agent"): Promise<PluginItem[]> => {
    const dirPath = joinPath(basePath, subdir);
    let entries: Array<{ name: string; type: string; path: string }> = [];
    try {
      entries = await fetchAnyRepoDir(source, dirPath);
    } catch {
      return [];
    }
    const result: PluginItem[] = [];
    for (const e of entries) {
      if (type === "skill") {
        let effectiveDir: string | null = null;
        if (e.type === "dir") {
          effectiveDir = e.path;
        } else if (e.type === "symlink") {
          effectiveDir = await resolveSymlink(source, e.path);
          if (!effectiveDir) continue;
        } else {
          continue;
        }
        const skillMd = joinPath(effectiveDir, "SKILL.md");
        const item = await buildItem(skillMd, "skill", e.name);
        if (item) result.push(item);
      } else {
        if (!e.name.endsWith(".md") || e.name === "README.md") continue;
        let effectiveFile: string | null = null;
        if (e.type === "file") {
          effectiveFile = e.path;
        } else if (e.type === "symlink") {
          effectiveFile = await resolveSymlink(source, e.path);
          if (!effectiveFile) continue;
        } else {
          continue;
        }
        const item = await buildItem(effectiveFile, type, e.name.replace(/\.md$/, ""));
        if (item) result.push(item);
      }
    }
    return result;
  };

  const skillsDecl = manifest ? asArray(manifest.skills) : null;
  const commandsDecl = manifest ? asArray(manifest.commands) : null;
  const agentsDecl = manifest ? asArray(manifest.agents) : null;

  if (skillsDecl) {
    const seenPaths = new Set<string>();
    for (const entry of skillsDecl) {
      const resolved = await resolveSkillEntry(entry);
      for (const item of resolved) {
        if (seenPaths.has(item.path)) continue;
        seenPaths.add(item.path);
        items.push(item);
      }
    }
  } else {
    items.push(...(await enumerateConventionalDir("skills", "skill")));
  }
  if (commandsDecl) {
    for (const entry of commandsDecl) {
      const item = await resolveSingleFileEntry(entry, "command");
      if (item) items.push(item);
    }
  } else {
    items.push(...(await enumerateConventionalDir("commands", "command")));
  }
  if (agentsDecl) {
    for (const entry of agentsDecl) {
      const item = await resolveSingleFileEntry(entry, "agent");
      if (item) items.push(item);
    }
  } else {
    items.push(...(await enumerateConventionalDir("agents", "agent")));
  }

  return items;
}

export async function getCuratedMarketplace(): Promise<CuratedMarketplaceData> {
  if (curatedCache) return curatedCache;
  return refreshCuratedMarketplace();
}

export async function refreshCuratedMarketplace(): Promise<CuratedMarketplaceData> {
  try {
    const [marketplaceJson, collectionsJson] = await Promise.all([
      fetchGitHubFileContent("marketplace.json"),
      fetchGitHubFileContent("collections.json"),
    ]);
    const marketplaceData = JSON.parse(marketplaceJson);
    const collectionsData = JSON.parse(collectionsJson);
    curatedCache = {
      // v2 schema has both marketplaces[] and plugins[]; v1 has only plugins[].
      // Missing arrays default to empty so both shapes work without branching.
      marketplaces: marketplaceData.marketplaces ?? [],
      plugins: marketplaceData.plugins ?? [],
      collections: collectionsData.collections ?? [],
    };
    return curatedCache;
  } catch (err: any) {
    console.error("Failed to fetch curated marketplace:", err?.message);
    return { marketplaces: [], plugins: [], collections: [] };
  }
}

/**
 * Fetch the curated search index — a pre-built flat list of every curated
 * marketplace, plugin, skill, command, and agent. Generated by the curator repo's
 * scripts/build-index.js and committed as index.json. Enables global in-app search
 * without hitting GitHub on every keystroke.
 */
export async function getCuratedIndex(): Promise<CuratedIndex> {
  if (curatedIndexCache) return curatedIndexCache;
  return refreshCuratedIndex();
}

export async function refreshCuratedIndex(): Promise<CuratedIndex> {
  try {
    const raw = await fetchGitHubFileContent("index.json");
    const data = JSON.parse(raw);
    curatedIndexCache = {
      version: data.version ?? 1,
      generatedAt: data.generatedAt ?? "",
      sourceCommit: data.sourceCommit,
      entries: Array.isArray(data.entries) ? data.entries : [],
    };
    return curatedIndexCache;
  } catch (err: any) {
    console.error("Failed to fetch curated index:", err?.message);
    return { version: 1, generatedAt: "", entries: [] };
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

// ---------------------------------------------------------------------------
// Status line config
// ---------------------------------------------------------------------------

function defaultStatusLineConfig(): StatusLineConfig {
  return {
    version: 2,
    separators: { field: "│", section: "║" },
    widgets: [
      { id: "model", enabled: true, options: {} },
    ],
  };
}

/**
 * Migrate a v1 config (nested `sections`) to the v2 flat widget list.
 * Inserts an implicit `break` widget between sections so the renderer
 * still produces the original grouping. Returns null if `parsed` is not
 * an old-shape config.
 */
function migrateV1StatusLineConfig(parsed: any): StatusLineConfig | null {
  if (!parsed || typeof parsed !== "object") return null;
  if (!Array.isArray(parsed.sections) || Array.isArray(parsed.widgets)) return null;
  const flat: StatusLineWidget[] = [];
  parsed.sections.forEach((section: any, idx: number) => {
    if (idx > 0) {
      flat.push({ id: "break", enabled: true, options: {} });
    }
    for (const w of section?.widgets || []) {
      flat.push(w as StatusLineWidget);
    }
  });
  return {
    version: 2,
    separators: parsed.separators,
    widgets: flat,
  };
}

export async function getStatusLineConfig(): Promise<StatusLineConfig> {
  try {
    const raw = await fs.promises.readFile(STATUSLINE_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const migrated = migrateV1StatusLineConfig(parsed);
    if (migrated) {
      // Old configs may contain widgets with `enabled: false` representing
      // "in the list but hidden". The UI no longer supports that state —
      // widgets are either present (shown) or removed. Drop disabled ones
      // on load so old configs clean up on first open.
      migrated.widgets = migrated.widgets.filter(
        (w) => w && (w as { enabled?: boolean }).enabled !== false,
      );
      return migrated;
    }
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.widgets)) {
      parsed.widgets = parsed.widgets.filter(
        (w: { enabled?: boolean } | null | undefined) =>
          w && w.enabled !== false,
      );
      return parsed as StatusLineConfig;
    }
  } catch {
    // File missing or unreadable — fall through to default.
  }
  return defaultStatusLineConfig();
}

export async function setStatusLineConfig(config: StatusLineConfig): Promise<void> {
  await fs.promises.mkdir(path.dirname(STATUSLINE_CONFIG_PATH), { recursive: true });
  await fs.promises.writeFile(
    STATUSLINE_CONFIG_PATH,
    JSON.stringify(config, null, 2) + "\n",
    "utf-8",
  );
}

export async function resetStatusLineConfig(): Promise<StatusLineConfig> {
  const fresh = defaultStatusLineConfig();
  await setStatusLineConfig(fresh);
  return fresh;
}

export async function renderStatusLinePreview(
  config: StatusLineConfig,
  mockSession?: Record<string, unknown>,
): Promise<string> {
  const tmpConfig = path.join(os.tmpdir(), `claude-statusline-preview-${process.pid}-${Date.now()}.json`);
  await fs.promises.writeFile(tmpConfig, JSON.stringify(config) + "\n", "utf-8");
  const mock = JSON.stringify(mockSession ?? {
    model: { display_name: "Opus" },
    context_window: { context_window_size: 200000, used_percentage: 25 },
    cost: {
      total_cost_usd: 0.5,
      total_lines_added: 42,
      total_lines_removed: 10,
      total_duration_ms: 1800000,
    },
  });
  const env = { ...process.env, CLAUDE_STATUSLINE_CONFIG_OVERRIDE: tmpConfig };
  return new Promise((resolve, reject) => {
    const child = execFile(
      "python3",
      [STATUSLINE_RENDERER_PATH],
      { env, timeout: 10000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        fs.promises.unlink(tmpConfig).catch(() => undefined);
        if (err) return reject(err);
        resolve(stdout);
      },
    );
    child.stdin?.write(mock);
    child.stdin?.end();
  });
}
