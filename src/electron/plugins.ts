import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import { CLAUDE_HOME } from "./config";
import type {
  PluginEntry,
  PluginItem,
  PluginHook,
  PluginMcp,
  PluginWithItems,
  StandaloneMcp,
  LocalItem,
  Profile,
} from "./types";

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
export function readPluginManifest(pluginRoot: string): Record<string, any> | null {
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
export function normaliseManifestPaths(v: unknown): string[] | null {
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
      for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
        // Flat file: agents/foo.md
        if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") {
          items.push(buildItem(plugin.name, path.join(agentsDir, entry.name), "agent", path.basename(entry.name, ".md")));
          continue;
        }
        // Directory layout: agents/foo/AGENT.md (mirrors skills/<name>/SKILL.md)
        if (direntIsDirLike(entry, agentsDir)) {
          const agentMd = path.join(agentsDir, entry.name, "AGENT.md");
          if (fs.existsSync(agentMd)) {
            items.push(buildItem(plugin.name, agentMd, "agent", entry.name));
          }
        }
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

export function resetKnownPluginNamesCache(): void {
  _knownPluginNamesCache = null;
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
export const FRAMEWORK_PLUGIN_PREFIX = "framework:";

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

  // Validate this is actually a git repo before running subprocesses.
  // A real git repo has .git/ as a directory containing HEAD.
  // A submodule has .git as a file with "gitdir: ..." pointing elsewhere.
  // Broken submodules, partial clones, or non-git .git markers should
  // be skipped — not fed to git which would print "fatal: not a git
  // repository" to stderr.
  let mtimeMs = 0;
  try {
    const gitStat = fs.lstatSync(gitDir);
    if (gitStat.isDirectory()) {
      // Real .git directory — check for HEAD
      mtimeMs = fs.statSync(path.join(gitDir, "HEAD")).mtimeMs;
    } else if (gitStat.isFile()) {
      // .git file (submodule marker) — validate the gitdir target exists
      const content = fs.readFileSync(gitDir, "utf-8").trim();
      if (!content.startsWith("gitdir:")) return null;
      const target = path.resolve(skillDir, content.slice("gitdir:".length).trim());
      if (!fs.existsSync(path.join(target, "HEAD"))) return null;
      mtimeMs = fs.statSync(path.join(target, "HEAD")).mtimeMs;
    } else {
      return null; // symlink to nowhere, socket, etc.
    }
  } catch {
    return null; // Can't validate — skip rather than run git and get "fatal:"
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

export function readFrontmatter(filePath: string): Record<string, string> {
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
