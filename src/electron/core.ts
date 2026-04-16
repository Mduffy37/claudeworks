import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
import {
  CLAUDE_HOME,
  PROFILES_DIR,
  PROFILES_JSON,
  GLOBAL_DEFAULTS_JSON,
  validateProfileName,
  ensureProfilesDir,
} from "./config";
import { resetKnownPluginNamesCache } from "./plugins";
import { assembleProfile } from "./assembly";
import { readTeamsStore, writeTeamsStore } from "./teams";
import {
  findRealClaudeBinary,
  generateAliases,
  removeAliases,
  removeAlias,
} from "./launch";
import type {
  Profile,
  ProfilesStore,
  StatusLineConfig,
  StatusLineWidget,
} from "./types";

const STATUSLINE_CONFIG_PATH = path.join(os.homedir(), ".claude", "statusline-config.json");
const STATUSLINE_RENDERER_PATH = path.join(os.homedir(), ".claude", "scripts", "statusline-render.py");

// ---------------------------------------------------------------------------
// Profile persistence
// ---------------------------------------------------------------------------

/**
 * Schema version for profiles.json. Every time the on-disk shape of a
 * stored profile changes in a way that old code can't read, bump this
 * and add a branch to migrateProfilesStore().
 *
 * Today there is only v1 — the function is a skeleton so future migrations
 * have a place to live. Shipping before v1 is public means every user has
 * a known version stamp on disk, so v2 code never has to guess.
 */
const PROFILES_SCHEMA_VERSION = 2;

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
  if (version < 2) {
    for (const p of Object.values(store.profiles ?? {})) {
      const profile = p as any;
      if (typeof profile.alias === "string" && profile.alias) {
        profile.aliases = [{ name: profile.alias }];
      }
      delete profile.alias;
    }
    store = { ...store, schemaVersion: 2 };
  }
  // Future migrations go here, e.g.:
  // if (version < 3) { store = { ...store, profiles: mapProfilesV2toV3(store.profiles) }; }

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
    aliases: [{ name: "claude" }],
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
  generateAliases(profile);

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
  removeAliases(old.aliases);

  if (profile.name !== oldName) {
    const oldDir = path.join(PROFILES_DIR, oldName);
    const newDir = path.join(PROFILES_DIR, profile.name);
    if (fs.existsSync(oldDir)) fs.renameSync(oldDir, newDir);
    delete store.profiles[oldName];
  }

  store.profiles[profile.name] = profile;
  writeProfilesStore(store);
  if (profile.aliases && profile.aliases.length > 0) generateAliases(profile);

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

  // Clean up removed aliases — any alias the old version had that the new version doesn't
  if (existing?.aliases) {
    const newNames = new Set((profile.aliases ?? []).map(a => a.name));
    for (const old of existing.aliases) {
      if (!newNames.has(old.name)) removeAlias(old.name);
    }
  }

  // Default profile auto-manages "claude" alias
  if (profile.isDefault && !profile.disableDefaultAlias) {
    if (!(profile.aliases ?? []).some(a => a.name === "claude")) {
      profile.aliases = [{ name: "claude" }, ...(profile.aliases ?? [])];
    }
  }

  // When disableDefaultAlias is true, remove the auto-managed claude alias
  if (profile.isDefault && profile.disableDefaultAlias) {
    const claudeIdx = (profile.aliases ?? []).findIndex(a => a.name === "claude");
    if (claudeIdx >= 0) {
      removeAlias("claude");
      profile.aliases = profile.aliases!.filter(a => a.name !== "claude");
      if (profile.aliases.length === 0) profile.aliases = undefined;
    }
  }

  // Revoke default from old default profiles
  if (profile.isDefault) {
    for (const p of Object.values(store.profiles)) {
      if (p.name !== profile.name && p.isDefault) {
        p.isDefault = undefined;
        if (p.aliases) {
          const claudeAlias = p.aliases.find(a => a.name === "claude");
          if (claudeAlias) removeAlias("claude");
          p.aliases = p.aliases.filter(a => a.name !== "claude");
          if (p.aliases.length === 0) p.aliases = undefined;
        }
      }
    }
  }

  store.profiles[profile.name] = profile;
  writeProfilesStore(store);

  // Generate alias scripts
  if (profile.aliases && profile.aliases.length > 0) {
    generateAliases(profile);
  }

  return profile;
}


export async function checkAliasConflict(
  aliasName: string,
  profileName: string,
): Promise<{ conflict: boolean; source: "profile" | "system" | "shell"; detail: string } | null> {
  // 1. Check other profiles
  const store = readProfilesStore();
  for (const [name, p] of Object.entries(store.profiles)) {
    if (name === profileName) continue;
    if ((p as Profile).aliases?.some(a => a.name === aliasName)) {
      return { conflict: true, source: "profile", detail: `Already used by profile "${name}"` };
    }
  }

  // 2. Check system commands (exclude our own bin dir)
  try {
    const binDir = path.join(PROFILES_DIR, "bin");
    const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(d => d !== binDir);
    const env = { ...process.env, PATH: pathDirs.join(path.delimiter) };
    const { stdout } = await execFileAsync("which", [aliasName], { env, timeout: 3000 }).catch(() => ({ stdout: "" }));
    if (stdout.trim()) {
      // Skip warning for default profile's "claude" alias
      const thisProfile = store.profiles[profileName] as Profile | undefined;
      if (aliasName === "claude" && thisProfile?.isDefault) return null;
      return { conflict: true, source: "system", detail: `Shadows system command: ${stdout.trim()}` };
    }
  } catch {}

  // 3. Check .zshrc for aliases and functions
  try {
    const zshrc = fs.readFileSync(path.join(os.homedir(), ".zshrc"), "utf-8");
    const escaped = aliasName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const aliasPattern = new RegExp(`^\\s*alias\\s+${escaped}=`, "m");
    const fnPattern = new RegExp(`^\\s*(function\\s+${escaped}\\s|${escaped}\\s*\\(\\s*\\))`, "m");
    if (aliasPattern.test(zshrc) || fnPattern.test(zshrc)) {
      return { conflict: true, source: "shell", detail: "Conflicts with alias/function in .zshrc" };
    }
  } catch {}

  return null;
}

export async function deleteProfileByName(name: string): Promise<void> {
  validateProfileName(name);
  const store = readProfilesStore();
  const profile = store.profiles[name];
  removeAliases(profile?.aliases);
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
// Profile export / import
// ---------------------------------------------------------------------------

/**
 * Export a profile as a standalone JSON object. The export contains the full
 * profile entry from profiles.json plus metadata (app version, export date,
 * list of required plugins). Plugin files are NOT included — on import, the
 * app checks which plugins are installed and reports missing ones so the user
 * can install them from the marketplace.
 */
export function exportProfileToJson(profileName: string): Record<string, any> {
  const profile = loadProfiles().find((p) => p.name === profileName);
  if (!profile) throw new Error(`Profile "${profileName}" not found`);

  let appVersion = "unknown";
  try { appVersion = require(path.join(__dirname, "..", "..", "package.json")).version; } catch {}

  return {
    version: 1,
    type: "claude-profiles-export",
    exportedAt: new Date().toISOString(),
    appVersion,
    profile: {
      ...profile,
      // Strip runtime-only fields that don't transfer
      lastLaunched: undefined,
      isDefault: undefined,
    },
    requiredPlugins: profile.plugins.filter((p) => !p.startsWith("local:")),
  };
}

/**
 * Import a profile from an exported JSON object. Handles name collisions
 * by appending "-imported". Returns the saved profile and a list of plugins
 * that need to be installed for the profile to work.
 */
export function importProfileFromJson(
  data: Record<string, any>,
): { profile: Profile; missingPlugins: string[] } {
  if (data.type !== "claude-profiles-export" || !data.profile) {
    throw new Error("Invalid profile export file — missing 'type' or 'profile' field");
  }

  const imported = { ...data.profile } as Profile;

  // Handle name collisions
  const existing = loadProfiles();
  const existingNames = new Set(existing.map((p) => p.name));
  if (existingNames.has(imported.name)) {
    let candidate = `${imported.name}-imported`;
    let attempt = 2;
    while (existingNames.has(candidate)) {
      candidate = `${imported.name}-imported-${attempt}`;
      attempt++;
    }
    imported.name = candidate;
  }

  // Clear runtime fields
  imported.lastLaunched = undefined;
  imported.isDefault = undefined;
  imported.aliases = undefined;

  // Save and assemble
  const saved = saveProfile(imported);
  assembleProfile(saved);

  // Check for missing plugins
  const { scanInstalledPlugins, scanUserLocalPlugins } = require("./plugins");
  const installedNames = new Set([
    ...scanInstalledPlugins().map((p: any) => p.name),
    ...scanUserLocalPlugins().map((p: any) => p.name),
  ]);
  const missingPlugins = saved.plugins.filter(
    (p) => !installedNames.has(p) && !p.startsWith("local:"),
  );

  return { profile: saved, missingPlugins };
}

// ---------------------------------------------------------------------------
// Plugin operations
// ---------------------------------------------------------------------------

export async function updatePlugin(pluginId: string): Promise<void> {
  const claudeHome = path.join(os.homedir(), ".claude");
  await execFileAsync(findRealClaudeBinary(), ["plugin", "update", pluginId], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
  });
  resetKnownPluginNamesCache();
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  const claudeHome = path.join(os.homedir(), ".claude");
  await execFileAsync(findRealClaudeBinary(), ["plugin", "uninstall", pluginId], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
  });
  resetKnownPluginNamesCache();
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
// Global settings
// ---------------------------------------------------------------------------

const GLOBAL_CLAUDE_MD = path.join(CLAUDE_HOME, "CLAUDE.md");
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

export function getFavouritePlugins(): string[] {
  try {
    const data = JSON.parse(fs.readFileSync(GLOBAL_DEFAULTS_JSON, "utf-8"));
    return Array.isArray(data.favouritePlugins) ? data.favouritePlugins : [];
  } catch {
    return [];
  }
}

export function saveFavouritePlugins(ids: string[]): void {
  let data: any = {};
  try { data = JSON.parse(fs.readFileSync(GLOBAL_DEFAULTS_JSON, "utf-8")); } catch {}
  data.favouritePlugins = ids;
  fs.writeFileSync(GLOBAL_DEFAULTS_JSON, JSON.stringify(data, null, 2));
}

export function getSavedStatusBarConfigs(): Array<{ name: string; config: any }> {
  try {
    const data = JSON.parse(fs.readFileSync(GLOBAL_DEFAULTS_JSON, "utf-8"));
    return Array.isArray(data.savedStatusBarConfigs) ? data.savedStatusBarConfigs : [];
  } catch {
    return [];
  }
}

export function saveSavedStatusBarConfigs(configs: Array<{ name: string; config: any }>): void {
  let data: any = {};
  try { data = JSON.parse(fs.readFileSync(GLOBAL_DEFAULTS_JSON, "utf-8")); } catch {}
  data.savedStatusBarConfigs = configs;
  fs.writeFileSync(GLOBAL_DEFAULTS_JSON, JSON.stringify(data, null, 2));
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
