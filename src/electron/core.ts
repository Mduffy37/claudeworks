import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
import { generateTeamMd, generateStartTeamCommand } from "./team-templates";
import {
  FRAMEWORK_PLUGIN_PREFIX,
  scanInstalledPlugins,
  scanUserLocalPlugins,
  getPluginsWithItems,
  scanPluginItems,
  checkAllProfileHealth,
  scanMcpServers,
  writeMcpConfig,
  readPluginManifest,
  normaliseManifestPaths,
  isLocalPlugin,
  isFrameworkPlugin,
  resetKnownPluginNamesCache,
} from "./plugins";
import {
  resolveModelId,
  assembleProfile,
  symlinkSelectedCaches,
  symlinkShared,
  ensureBuiltinPlugin,
} from "./assembly";
import { getGitHubBackendState } from "./marketplace";
import type {
  PluginEntry,
  PluginItem,
  Profile,
  ProfileAlias,
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

function generateAliases(profile: Profile): void {
  const binDir = path.join(PROFILES_DIR, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const configDir = path.join(PROFILES_DIR, profile.name, "config");
  const claudeBin = findRealClaudeBinary();
  writeMcpHelper(binDir);

  for (const alias of profile.aliases ?? []) {
    const workDir = alias.directory ?? profile.directory ?? "$PWD";
    const workDirStr = workDir === "$PWD" ? "$PWD" : `'${escSh(workDir)}'`;

    let launchArg = '"$@"';
    if (alias.launchAction === "workflow") {
      launchArg = "'/workflow'";
    } else if (alias.launchAction === "prompt" && alias.launchPrompt) {
      launchArg = `'${escSh(alias.launchPrompt)}'`;
    }

    const script = `#!/bin/bash
# Generated by Claude Profiles — do not edit
# Profile: ${profile.name}
WORK_DIR=${workDirStr}
cd "$WORK_DIR" && node '${escSh(path.join(binDir, ".regenerate-mcp.js"))}' '${escSh(profile.name)}' "$WORK_DIR" && CLAUDE_CONFIG_DIR='${escSh(configDir)}' '${escSh(claudeBin)}' --mcp-config '${escSh(configDir)}/mcp.json' --strict-mcp-config ${launchArg}
`;
    fs.writeFileSync(path.join(binDir, alias.name), script, { mode: 0o755 });
  }
}

function removeAliases(aliases: ProfileAlias[] | undefined): void {
  for (const alias of aliases ?? []) {
    const scriptPath = path.join(PROFILES_DIR, "bin", alias.name);
    try { fs.unlinkSync(scriptPath); } catch {}
  }
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
// Diagnostics export
// ---------------------------------------------------------------------------

/**
 * Gather a diagnostic snapshot of the app state for bug report attachments.
 * Returns a plain JSON-serialisable object — no secrets, no env var values,
 * no customClaudeMd / workflow / tools content. Safe to attach to a GitHub
 * issue as a .json file.
 */
export async function exportDiagnostics(): Promise<Record<string, any>> {
  const profiles = loadProfiles();
  const teams = loadTeams();
  const plugins = getPluginsWithItems();
  const health = checkAllProfileHealth(profiles);
  const mcpServers = scanMcpServers();
  const launches = getLaunchLog();
  const globalDefaults = getGlobalDefaults();
  const marketplaces = listMarketplaces();
  const activeSessions = getActiveSessions();
  const globalHooks = getGlobalHooks();

  // GitHub backend — async
  let ghBackend: any = null;
  try { ghBackend = await getGitHubBackendState(); } catch {}

  // Credential status — async, can fail on keychain issues
  let credStatus: any = null;
  try { credStatus = await checkCredentialStatus(); } catch {}

  // Doctor findings — run detect mode for comprehensive checks
  let doctorFindings: any = null;
  try {
    const { runProfilesDoctor } = require("./doctor");
    const report = runProfilesDoctor("detect");
    doctorFindings = {
      summary: report.summary,
      issues: report.findings
        .filter((f: any) => f.status !== "healthy")
        .map((f: any) => ({ check: f.check, status: f.status, title: f.title, severity: f.severity })),
    };
  } catch {}

  // Per-profile assembly state — the detail needed to diagnose overlay,
  // container-pattern, and MCP toggle issues.
  const profileDetails = profiles.map((p) => {
    const configDir = path.join(PROFILES_DIR, p.name, "config");
    const cacheDir = path.join(configDir, "plugins", "cache");

    // Check assembly fingerprint state.
    const markerPath = path.join(configDir, ".assembly-fingerprint.json");
    let fingerprint: any = null;
    try {
      if (fs.existsSync(markerPath)) {
        const raw = JSON.parse(fs.readFileSync(markerPath, "utf-8"));
        fingerprint = { hash: raw.fingerprint?.slice(0, 16), ts: raw.ts ? new Date(raw.ts).toISOString() : null };
      }
    } catch {}

    // Per-plugin: is it overlayed or symlinked? Does it use the container pattern?
    const pluginStates: Record<string, any> = {};
    for (const pluginId of p.plugins) {
      const plugin = plugins.find((pl) => pl.name === pluginId);
      if (!plugin) { pluginStates[pluginId] = { status: "not-installed" }; continue; }

      const pluginCacheDir = path.join(cacheDir, plugin.marketplace, plugin.pluginName);
      let cacheState = "unknown";
      try {
        if (!fs.existsSync(pluginCacheDir)) {
          cacheState = "missing";
        } else if (fs.lstatSync(pluginCacheDir).isSymbolicLink()) {
          cacheState = "symlink";
        } else {
          cacheState = "overlay";
        }
      } catch {}

      // Check for container-pattern fix (skills/ dir created by our assembly).
      const versionDir = path.join(pluginCacheDir, plugin.version);
      let hasSkillsDir = false;
      let hasContainerPattern = false;
      try {
        hasSkillsDir = fs.existsSync(path.join(versionDir, "skills"));
        const manifest = readPluginManifest(plugin.installPath);
        if (manifest) {
          const skillsDecl = normaliseManifestPaths(manifest.skills);
          hasContainerPattern = !!(skillsDecl && skillsDecl.some((s: string) => s === "./" || s === "."));
        }
      } catch {}

      const excluded = p.excludedItems?.[pluginId] ?? [];
      pluginStates[pluginId] = {
        version: plugin.version,
        cacheState,
        excludedCount: excluded.length,
        containerPattern: hasContainerPattern,
        hasSkillsDir,
        itemCount: plugin.items.length,
      };
    }

    return {
      name: p.name,
      pluginCount: p.plugins.length,
      model: p.model ?? "default",
      effortLevel: p.effortLevel ?? "default",
      hasCustomClaudeMd: !!p.customClaudeMd,
      hasWorkflow: !!p.workflow,
      disabledMcpServers: p.disabledMcpServers ?? null,
      assemblyFingerprint: fingerprint,
      plugins: pluginStates,
      lastLaunched: p.lastLaunched ? new Date(p.lastLaunched).toISOString() : null,
    };
  });

  return {
    version: 3,
    exportedAt: new Date().toISOString(),

    environment: {
      appVersion: (() => { try { return require(path.join(__dirname, "..", "..", "package.json")).version; } catch { return "unknown"; } })(),
      electronVersion: process.versions.electron ?? "unknown",
      nodeVersion: process.versions.node ?? "unknown",
      os: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
    },

    githubBackend: ghBackend ? {
      kind: ghBackend.kind,
      rateLimit: ghBackend.rateLimit,
    } : null,

    credentials: credStatus ? {
      hasDefaultEntry: credStatus.hasDefaultEntry,
      profileCount: credStatus.profileCount,
    } : null,

    globalDefaults: {
      model: globalDefaults.model || "default",
      effortLevel: globalDefaults.effortLevel || "default",
      terminalApp: globalDefaults.terminalApp ?? "iterm2",
      hasGlobalEnv: !!globalDefaults.env && Object.keys(globalDefaults.env).length > 0,
      hasCustomFlags: !!globalDefaults.customFlags,
    },

    globalHooks: {
      eventCount: Object.keys(globalHooks).length,
      events: Object.keys(globalHooks),
    },

    profiles: profileDetails,

    teams: {
      count: teams.length,
      names: teams.map((t) => t.name),
    },

    plugins: {
      installedCount: plugins.length,
      marketplaces: [...new Set(plugins.map((p) => p.marketplace))].sort(),
      registeredMarketplaces: marketplaces.map((m) => ({
        name: m.name,
        repo: m.repo,
        lastUpdated: m.lastUpdated,
      })),
      list: plugins.map((p) => ({
        name: p.name,
        version: p.version,
        itemCount: p.items.length,
        mcpCount: p.mcpServers.length,
        hookCount: p.hooks.length,
        source: (p as any).source?.type ?? null,
      })),
    },

    mcpServers: {
      userServers: mcpServers.filter((m) => m.scope === "user").map((m) => m.name),
      projectServers: mcpServers.filter((m) => m.scope === "project").map((m) => ({
        name: m.name,
        project: m.projectPath?.split("/").pop() ?? null,
      })),
    },

    doctor: doctorFindings,
    healthIssues: Object.keys(health).length > 0 ? health : null,

    activeSessions: activeSessions.map((s) => ({
      profile: s.profile,
      pid: s.pid,
    })),

    recentLaunches: launches.slice(-10).reverse().map((l) => ({
      type: l.type,
      name: l.name,
      timestamp: new Date(l.timestamp).toISOString(),
    })),
  };
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

// ---------------------------------------------------------------------------
// Re-exports from extracted modules (keeps main.ts imports working unchanged)
// ---------------------------------------------------------------------------

export {
  invalidatePluginCaches,
  scanInstalledPlugins,
  scanPluginItems,
  scanPluginHooks,
  scanPluginMcpServers,
  writeMcpConfig,
  getPluginsWithItems,
  checkProfileHealth,
  checkAllProfileHealth,
  scanLocalItems,
  isLocalPlugin,
  isFrameworkPlugin,
  isGsdInstalled,
  readSkillfishMarker,
  parseRemoteOwnerRepo,
  detectSkillLockSource,
  detectGitSource,
  scanUserLocalPlugins,
  scanMcpServers,
  readPluginManifest,
  normaliseManifestPaths,
  readFrontmatter,
  resetKnownPluginNamesCache,
  FRAMEWORK_PLUGIN_PREFIX,
} from "./plugins";

export {
  resolveModelId,
  assembleProfile,
  symlinkSelectedCaches,
  symlinkShared,
  ensureBuiltinPlugin,
} from "./assembly";

export {
  getGitHubBackendState,
  fetchRepoReadme,
  fetchUpstreamMarketplace,
  fetchPluginItems,
  getCuratedMarketplace,
  refreshCuratedMarketplace,
  getCuratedIndex,
  refreshCuratedIndex,
} from "./marketplace";
