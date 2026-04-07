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
  PluginWithItems,
  Profile,
  ProfilesStore,
} from "./types";

const CLAUDE_HOME = path.join(os.homedir(), ".claude");
const PROFILES_DIR = path.join(os.homedir(), ".claude-profiles");
const PROFILES_JSON = path.join(PROFILES_DIR, "profiles.json");

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

    for (const install of installs as any[]) {
      entries.push({
        name,
        scope: install.scope ?? "user",
        installPath: install.installPath ?? "",
        version: install.version ?? "unknown",
        marketplace,
        pluginName,
        projectPath: install.projectPath,
      });
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
        type: "skill",
        plugin: plugin.name,
        path: skillMd,
        userInvocable: (fm["user-invocable"] ?? "true").toLowerCase() !== "false",
      });
    }
  }

  // Commands
  const cmdsDir = path.join(base, "commands");
  if (fs.existsSync(cmdsDir)) {
    for (const file of fs.readdirSync(cmdsDir)) {
      if (!file.endsWith(".md")) continue;
      items.push({
        name: path.basename(file, ".md"),
        type: "command",
        plugin: plugin.name,
        path: path.join(cmdsDir, file),
        userInvocable: true,
      });
    }
  }

  // Agents — in agents/ subdirectory
  const agentsDir = path.join(base, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (!file.endsWith(".md") || file === "README.md") continue;
      items.push({
        name: path.basename(file, ".md"),
        type: "agent",
        plugin: plugin.name,
        path: path.join(agentsDir, file),
        userInvocable: true,
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
        items.push({
          name: path.basename(file, ".md"),
          type: "agent",
          plugin: plugin.name,
          path: path.join(base, file),
          userInvocable: true,
        });
      }
    }
  }

  return items;
}

export function getPluginsWithItems(): PluginWithItems[] {
  const plugins = scanInstalledPlugins();
  return plugins.map((p) => ({ ...p, items: scanPluginItems(p) }));
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
  fs.writeFileSync(PROFILES_JSON, JSON.stringify(store, null, 2) + "\n");
}

export function loadProfiles(): Profile[] {
  const store = readProfilesStore();
  return Object.values(store.profiles);
}

export function saveProfile(profile: Profile): Profile {
  const store = readProfilesStore();
  store.profiles[profile.name] = profile;
  writeProfilesStore(store);
  return profile;
}

export function deleteProfileByName(name: string): void {
  // Remove from store
  const store = readProfilesStore();
  delete store.profiles[name];
  writeProfilesStore(store);

  // Clean up keychain before removing directory (need configDir path)
  const configDir = path.join(PROFILES_DIR, name, "config");
  const hash = crypto.createHash("sha256").update(configDir).digest("hex").slice(0, 8);
  const service = `Claude Code-credentials-${hash}`;
  const username = os.userInfo().username;
  try {
    execFileSync("security", [
      "delete-generic-password", "-s", service, "-a", username,
    ], { stdio: "ignore" });
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
    throw new Error("No installed_plugins.json found");
  }
  const manifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf-8"));

  // Filter to selected plugins
  const filteredPlugins: Record<string, any> = {};
  for (const [name, entries] of Object.entries(manifest.plugins ?? {})) {
    if (profile.plugins.includes(name)) {
      filteredPlugins[name] = entries;
    }
  }

  // Write filtered installed_plugins.json
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

  const SAFE_KEYS = new Set(["env", "hooks", "statusLine", "voiceEnabled"]);
  const settings: Record<string, any> = {};
  for (const [k, v] of Object.entries(source)) {
    if (SAFE_KEYS.has(k)) settings[k] = v;
  }
  settings.enabledPlugins = Object.fromEntries(
    profile.plugins.map((name) => [name, true])
  );

  // Copy permissions — keep plugin MCP permissions, strip standalone MCP permissions
  const sourcePerms = source.permissions;
  if (sourcePerms) {
    const allowed: string[] = sourcePerms.allow ?? [];
    settings.permissions = {
      ...sourcePerms,
      allow: allowed.filter((t: string) => {
        if (!t.startsWith("mcp__")) return true;
        // Keep permissions for plugin-provided MCPs (mcp__plugin_*)
        if (t.startsWith("mcp__plugin_")) return true;
        return false;
      }),
    };
  }

  fs.writeFileSync(
    path.join(configDir, "settings.json"),
    JSON.stringify(settings, null, 2) + "\n"
  );

  // Symlink plugin caches
  symlinkSelectedCaches(profile, configDir);

  // Apply skill-level exclusions
  applyExclusions(profile, configDir);

  // Symlink shared resources
  symlinkShared(configDir);

  return configDir;
}

function symlinkSelectedCaches(profile: Profile, configDir: string): void {
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
  const plugins = scanInstalledPlugins();
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

function applyExclusions(profile: Profile, configDir: string): void {
  if (!profile.excludedItems || Object.keys(profile.excludedItems).length === 0) return;

  const plugins = scanInstalledPlugins();
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

  // Symlink plugin state files (known_marketplaces.json, blocklist.json, etc.)
  const pluginStateFiles = ["known_marketplaces.json", "blocklist.json", "install-counts-cache.json"];
  for (const file of pluginStateFiles) {
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

export function copyCredentials(profile: Profile): boolean {
  const username = os.userInfo().username;
  const configDir = path.join(PROFILES_DIR, profile.name, "config");

  // Read default credentials
  let cred: string;
  try {
    cred = execFileSync("security", [
      "find-generic-password", "-s", "Claude Code-credentials", "-a", username, "-w",
    ], { encoding: "utf-8" }).trim();
  } catch {
    return false;
  }

  // Write to profile's keychain entry
  const hash = crypto.createHash("sha256").update(configDir).digest("hex").slice(0, 8);
  const service = `Claude Code-credentials-${hash}`;

  try {
    try {
      execFileSync("security", [
        "delete-generic-password", "-s", service, "-a", username,
      ], { stdio: "ignore" });
    } catch {
      // Not found — fine
    }
    execFileSync("security", [
      "add-generic-password", "-s", service, "-a", username, "-w", cred,
    ], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

export async function launchProfile(profile: Profile, directory?: string): Promise<void> {
  const configDir = path.join(PROFILES_DIR, profile.name, "config");
  const workDir = directory ?? profile.directory ?? os.homedir();

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
    `    write text "cd '${workDir}' && CLAUDE_CONFIG_DIR='${configDir}' claude"`,
    "  end tell",
    "end tell",
  ].join("\n");

  await execFileAsync("osascript", ["-e", script]);
}

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

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
