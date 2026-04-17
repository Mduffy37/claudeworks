/**
 * config.ts — leaf module of shared path constants and lightweight settings helpers.
 *
 * INVARIANT: imports only Node builtins. Never imports other local modules.
 *
 * This is the dependency root: feature modules (plugins, assembly, marketplace,
 * keychain, teams, launch, diagnostics) can import from here freely without
 * introducing cycles. Everything non-leaf (profile persistence, plugin operations,
 * status-line config, etc.) lives in core.ts and depends on this module.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export const CLAUDE_HOME = path.join(os.homedir(), ".claude");
export const PROFILES_DIR = path.join(os.homedir(), ".claudeworks");
export const PROFILES_JSON = path.join(PROFILES_DIR, "profiles.json");
export const GLOBAL_DEFAULTS_JSON = path.join(PROFILES_DIR, "global-defaults.json");
export const BUILTINS_LEDGER_JSON = path.join(PROFILES_DIR, "builtins-seeded.json");

export function validateProfileName(name: string): void {
  if (!name || /[\/\\\0]|\.\./.test(name)) {
    throw new Error(`Invalid profile name: "${name}". Names must not contain path separators, "..", or null bytes.`);
  }
  const resolved = path.resolve(PROFILES_DIR, name);
  if (!resolved.startsWith(PROFILES_DIR + path.sep)) {
    throw new Error(`Invalid profile name: "${name}" resolves outside the profiles directory.`);
  }
}

export function ensureProfilesDir(): void {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
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
// Builtins seed ledger
// ---------------------------------------------------------------------------
//
// Append-only record of app-shipped built-ins that have been seeded on this
// machine. Lives in its own file so the user-facing saveGlobalDefaults() round
// trip can't clobber it. Once an entry lands in the ledger, the app never
// re-seeds that built-in — even if the user deletes it. Fresh installs seed
// and record; subsequent launches no-op against the same ledger entry.

const BUILTINS_LEDGER_SCHEMA_VERSION = 1;

export interface BuiltinsLedger {
  schemaVersion: number;
  profiles: string[];
  favourites: string[];
}

function emptyLedger(): BuiltinsLedger {
  return { schemaVersion: BUILTINS_LEDGER_SCHEMA_VERSION, profiles: [], favourites: [] };
}

export function readBuiltinsLedger(): BuiltinsLedger {
  try {
    const raw = JSON.parse(fs.readFileSync(BUILTINS_LEDGER_JSON, "utf-8"));
    if (!raw || typeof raw !== "object") return emptyLedger();
    return {
      schemaVersion: typeof raw.schemaVersion === "number" ? raw.schemaVersion : BUILTINS_LEDGER_SCHEMA_VERSION,
      profiles: Array.isArray(raw.profiles) ? raw.profiles.filter((x: unknown) => typeof x === "string") : [],
      favourites: Array.isArray(raw.favourites) ? raw.favourites.filter((x: unknown) => typeof x === "string") : [],
    };
  } catch {
    return emptyLedger();
  }
}

export function saveBuiltinsLedger(ledger: BuiltinsLedger): void {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
  const stamped = { ...ledger, schemaVersion: BUILTINS_LEDGER_SCHEMA_VERSION };
  fs.writeFileSync(BUILTINS_LEDGER_JSON, JSON.stringify(stamped, null, 2));
}
