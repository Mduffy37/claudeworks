import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Profile } from "./types";
import { PROFILES_DIR } from "./config";
import { loadProfiles } from "./core";

const execFileAsync = promisify(execFile);

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
