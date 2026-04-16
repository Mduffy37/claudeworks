/**
 * doctor.ts
 *
 * Diagnostic and repair pass over the Claude Profiles store and related
 * config files. Invoked via the `run-profiles-doctor` IPC from two places:
 *
 *   1. The error panel on App.tsx when any of the initial load hooks
 *      (useProfiles / usePlugins / useTeams) rejects. This is the
 *      "the app hung and the user clicked a button" entry point.
 *
 *   2. A "Run Repair" button in AppSettingsDialog's Diagnostics section
 *      for proactive use when the app is healthy and the user wants to
 *      spot-check things.
 *
 * Design rules (enforced per-check):
 *
 *   - Fix what's unambiguously corrupt (nameless rows in profiles.json,
 *     malformed JSON with a usable backup, stale bin aliases).
 *
 *   - Report what's ambiguous (orphan profile directories, dangling plugin
 *     refs, alias collisions). These surface to the user but are never
 *     auto-modified — losing in-progress work or installed plugin state
 *     has too much blast radius.
 *
 *   - Never run auto-repair at startup. The caller chooses mode="detect"
 *     or mode="repair" explicitly. Silent auto-repair hides write-side
 *     bugs (this is how the /create-profile write bug lived for so long).
 *
 *   - Always back up a file before modifying it, via in-place .bak-<ts>.
 *     Mirrors the manual recovery pattern we've already been using.
 *
 *   - All writes are atomic (tmp + rename), matching writeProfilesStore
 *     in core.ts so an interrupted repair can't truncate the store.
 */

import fs from "fs";
import path from "path";
import os from "os";
import type { DoctorFinding, DoctorReport } from "./types";
import { resolvePlugins } from "./plugin-resolver";

const PROFILES_DIR = path.join(os.homedir(), ".claude-profiles");
const PROFILES_JSON = path.join(PROFILES_DIR, "profiles.json");
const TEAMS_JSON = path.join(PROFILES_DIR, "teams.json");
const BIN_DIR = path.join(PROFILES_DIR, "bin");
const CLAUDE_HOME = path.join(os.homedir(), ".claude");
const INSTALLED_PLUGINS_JSON = path.join(CLAUDE_HOME, "plugins", "installed_plugins.json");

type DoctorMode = "detect" | "repair";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function backupFile(filePath: string, stamp: string): string {
  const backup = `${filePath}.bak-${stamp}`;
  fs.copyFileSync(filePath, backup);
  return backup;
}

function atomicWrite(filePath: string, content: string): void {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

// ─── profiles.json ──────────────────────────────────────────────────────────

function checkProfilesStore(mode: DoctorMode): DoctorFinding[] {
  const findings: DoctorFinding[] = [];

  if (!fs.existsSync(PROFILES_JSON)) {
    findings.push({
      check: "profiles-file-exists",
      title: "profiles.json is missing",
      severity: "info",
      status: "healthy",
      detail: "No profiles.json found. A new one will be created when the app next starts.",
    });
    return findings;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(PROFILES_JSON, "utf-8");
  } catch (e: any) {
    findings.push({
      check: "profiles-file-readable",
      title: "profiles.json cannot be read",
      severity: "error",
      status: "unfixable",
      detail: `Read failed: ${e.message ?? e}. Check file permissions.`,
    });
    return findings;
  }

  let store: any;
  try {
    store = JSON.parse(raw);
  } catch (e: any) {
    // Try to restore from the most recent .bak-* sitting next to the file.
    if (mode === "repair") {
      const backups = fs
        .readdirSync(PROFILES_DIR)
        .filter((f) => f.startsWith("profiles.json.bak-") && !f.endsWith("-broken"))
        .sort()
        .reverse();
      if (backups.length > 0) {
        const best = path.join(PROFILES_DIR, backups[0]);
        const brokenBackup = backupFile(PROFILES_JSON, timestamp() + "-broken");
        fs.copyFileSync(best, PROFILES_JSON);
        findings.push({
          check: "profiles-file-parseable",
          title: "profiles.json was malformed — restored from backup",
          severity: "error",
          status: "fixed",
          detail:
            `JSON.parse failed (${e.message ?? e}). Restored from ${path.basename(best)}. ` +
            `The broken file was preserved at ${path.basename(brokenBackup)} in case you need to inspect it.`,
          backupPath: brokenBackup,
        });
        return findings;
      }
    }
    findings.push({
      check: "profiles-file-parseable",
      title: "profiles.json is malformed",
      severity: "error",
      status: mode === "repair" ? "unfixable" : "detected",
      detail: `JSON.parse failed: ${e.message ?? e}. No backup is available to restore from automatically.`,
    });
    return findings;
  }

  if (!store || typeof store !== "object" || !store.profiles || typeof store.profiles !== "object") {
    if (mode === "repair") {
      const backup = backupFile(PROFILES_JSON, timestamp());
      atomicWrite(PROFILES_JSON, JSON.stringify({ profiles: {} }, null, 2) + "\n");
      findings.push({
        check: "profiles-root-shape",
        title: "profiles.json root shape repaired",
        severity: "error",
        status: "fixed",
        detail: `The file had an unexpected shape (no top-level 'profiles' object). Reset to an empty store. Backup saved to ${path.basename(backup)}.`,
        backupPath: backup,
      });
      return findings;
    }
    findings.push({
      check: "profiles-root-shape",
      title: "profiles.json has no profiles object",
      severity: "error",
      status: "detected",
      detail: "The file is missing a top-level 'profiles' object. Running repair will reset it to an empty store (after backup).",
    });
    return findings;
  }

  // Row integrity: every value must be an object with a non-empty string name,
  // and the store key must match value.name.
  const nameless: string[] = [];
  const keyMismatches: string[] = [];
  const nonObjects: string[] = [];

  for (const [key, value] of Object.entries(store.profiles as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      nonObjects.push(key);
      continue;
    }
    const v = value as { name?: unknown };
    if (typeof v.name !== "string" || v.name === "") {
      nameless.push(key);
    } else if (v.name !== key) {
      keyMismatches.push(`${key} → ${v.name}`);
    }
  }

  if (nameless.length === 0 && keyMismatches.length === 0 && nonObjects.length === 0) {
    findings.push({
      check: "profiles-row-integrity",
      title: "Profile rows are well-formed",
      severity: "info",
      status: "healthy",
      detail: `Checked ${Object.keys(store.profiles).length} profile(s).`,
    });
    return findings;
  }

  if (mode === "repair") {
    const backup = backupFile(PROFILES_JSON, timestamp());
    const fixed: { profiles: Record<string, any> } = { profiles: {} };
    for (const [, value] of Object.entries(store.profiles as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const v = value as { name?: unknown };
      if (typeof v.name !== "string" || v.name === "") continue;
      fixed.profiles[v.name] = v;
    }
    atomicWrite(PROFILES_JSON, JSON.stringify(fixed, null, 2) + "\n");

    const parts: string[] = [];
    if (nameless.length) parts.push(`dropped ${nameless.length} nameless`);
    if (nonObjects.length) parts.push(`dropped ${nonObjects.length} non-object`);
    if (keyMismatches.length) parts.push(`re-keyed ${keyMismatches.length} mismatched`);

    findings.push({
      check: "profiles-row-integrity",
      title: "Repaired malformed profile rows",
      severity: "error",
      status: "fixed",
      detail: `${parts.join(", ")}. Backup saved to ${path.basename(backup)}.`,
      itemsAffected: [...nameless, ...keyMismatches, ...nonObjects],
      backupPath: backup,
    });
  } else {
    findings.push({
      check: "profiles-row-integrity",
      title: "Malformed profile rows detected",
      severity: "error",
      status: "detected",
      detail: `Found ${nameless.length} nameless, ${keyMismatches.length} key-mismatched, ${nonObjects.length} non-object entry(ies). Running repair will drop nameless/non-object rows and re-key mismatched ones (backup taken first).`,
      itemsAffected: [...nameless, ...keyMismatches, ...nonObjects],
    });
  }

  return findings;
}

// ─── teams.json ─────────────────────────────────────────────────────────────

function checkTeamsStore(mode: DoctorMode): DoctorFinding[] {
  const findings: DoctorFinding[] = [];

  if (!fs.existsSync(TEAMS_JSON)) {
    findings.push({
      check: "teams-file",
      title: "teams.json is missing",
      severity: "info",
      status: "healthy",
      detail: "No teams defined. This is normal if you haven't created any.",
    });
    return findings;
  }

  let store: any;
  try {
    store = JSON.parse(fs.readFileSync(TEAMS_JSON, "utf-8"));
  } catch (e: any) {
    if (mode === "repair") {
      const backup = backupFile(TEAMS_JSON, timestamp());
      atomicWrite(TEAMS_JSON, JSON.stringify({ teams: {} }, null, 2) + "\n");
      findings.push({
        check: "teams-file-parseable",
        title: "teams.json was malformed — reset",
        severity: "error",
        status: "fixed",
        detail: `JSON.parse failed (${e.message ?? e}). Reset to empty store. Backup saved to ${path.basename(backup)}.`,
        backupPath: backup,
      });
    } else {
      findings.push({
        check: "teams-file-parseable",
        title: "teams.json is malformed",
        severity: "error",
        status: "detected",
        detail: `JSON.parse failed: ${e.message ?? e}. Running repair will reset it (backup taken first).`,
      });
    }
    return findings;
  }

  if (!store || typeof store !== "object" || !store.teams || typeof store.teams !== "object") {
    if (mode === "repair") {
      const backup = backupFile(TEAMS_JSON, timestamp());
      atomicWrite(TEAMS_JSON, JSON.stringify({ teams: {} }, null, 2) + "\n");
      findings.push({
        check: "teams-root-shape",
        title: "teams.json root shape repaired",
        severity: "error",
        status: "fixed",
        detail: `Missing 'teams' object. Reset to empty store. Backup saved to ${path.basename(backup)}.`,
        backupPath: backup,
      });
    } else {
      findings.push({
        check: "teams-root-shape",
        title: "teams.json has no teams object",
        severity: "error",
        status: "detected",
        detail: "The file is missing a top-level 'teams' object.",
      });
    }
    return findings;
  }

  findings.push({
    check: "teams-file",
    title: "teams.json is valid",
    severity: "info",
    status: "healthy",
    detail: `${Object.keys(store.teams).length} team(s) found.`,
  });
  return findings;
}

// ─── installed_plugins.json (report-only) ───────────────────────────────────

function checkInstalledPluginsJson(): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  if (!fs.existsSync(INSTALLED_PLUGINS_JSON)) {
    findings.push({
      check: "installed-plugins-file",
      title: "installed_plugins.json is missing",
      severity: "info",
      status: "healthy",
      detail: "No plugins have been installed via Claude Code yet.",
    });
    return findings;
  }
  try {
    const data = JSON.parse(fs.readFileSync(INSTALLED_PLUGINS_JSON, "utf-8"));
    if (!data.plugins || typeof data.plugins !== "object") {
      findings.push({
        check: "installed-plugins-file",
        title: "installed_plugins.json has unexpected shape",
        severity: "error",
        status: "unfixable",
        detail: "Expected a top-level 'plugins' object. Not auto-repairing — plugin registration state is too important to replace automatically. Manually restore or reinstall your plugins.",
      });
    } else {
      findings.push({
        check: "installed-plugins-file",
        title: "installed_plugins.json is valid",
        severity: "info",
        status: "healthy",
        detail: `${Object.keys(data.plugins).length} plugin registration(s) found.`,
      });
    }
  } catch (e: any) {
    findings.push({
      check: "installed-plugins-file",
      title: "installed_plugins.json is malformed",
      severity: "error",
      status: "unfixable",
      detail: `JSON.parse failed: ${e.message ?? e}. Not auto-repairing — plugin state is too important to replace. Manually restore from a backup or reinstall plugins.`,
    });
  }
  return findings;
}

// ─── stale bin aliases ──────────────────────────────────────────────────────

function checkStaleBinAliases(mode: DoctorMode): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  if (!fs.existsSync(BIN_DIR)) {
    findings.push({
      check: "stale-bin-aliases",
      title: "No bin directory",
      severity: "info",
      status: "healthy",
      detail: "Nothing to check — ~/.claude-profiles/bin/ does not exist yet.",
    });
    return findings;
  }

  let validAliases: Set<string>;
  try {
    const store = JSON.parse(fs.readFileSync(PROFILES_JSON, "utf-8"));
    validAliases = new Set<string>();
    for (const p of Object.values(store.profiles ?? {})) {
      const profile = p as { aliases?: Array<{ name: string }> };
      for (const alias of profile?.aliases ?? []) {
        if (typeof alias.name === "string" && alias.name) {
          validAliases.add(alias.name);
        }
      }
    }
  } catch {
    findings.push({
      check: "stale-bin-aliases",
      title: "Skipped bin alias check",
      severity: "info",
      status: "skipped",
      detail: "Cannot read profiles.json, so stale-alias detection is inconclusive. Fix profiles.json first, then re-run.",
    });
    return findings;
  }

  const stale: string[] = [];
  for (const entry of fs.readdirSync(BIN_DIR)) {
    if (entry.startsWith(".")) continue;
    if (!validAliases.has(entry)) stale.push(entry);
  }

  if (stale.length === 0) {
    findings.push({
      check: "stale-bin-aliases",
      title: "No stale bin aliases",
      severity: "info",
      status: "healthy",
      detail: `${validAliases.size} alias(es) match profiles.`,
    });
    return findings;
  }

  if (mode === "repair") {
    for (const name of stale) {
      try {
        fs.unlinkSync(path.join(BIN_DIR, name));
      } catch {
        // ignore — best effort
      }
    }
    findings.push({
      check: "stale-bin-aliases",
      title: "Removed stale bin aliases",
      severity: "warn",
      status: "fixed",
      detail: `Removed ${stale.length} alias(es) that no longer matched any profile.`,
      itemsAffected: stale,
    });
  } else {
    findings.push({
      check: "stale-bin-aliases",
      title: "Stale bin aliases detected",
      severity: "warn",
      status: "detected",
      detail: `${stale.length} alias(es) in ~/.claude-profiles/bin/ no longer match any profile.`,
      itemsAffected: stale,
    });
  }

  return findings;
}

// ─── orphan profile directories (report-only) ──────────────────────────────

function checkOrphanProfileDirs(): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  if (!fs.existsSync(PROFILES_DIR)) {
    findings.push({
      check: "orphan-profile-dirs",
      title: "No profiles directory",
      severity: "info",
      status: "healthy",
      detail: "",
    });
    return findings;
  }

  let validNames: Set<string>;
  try {
    const store = JSON.parse(fs.readFileSync(PROFILES_JSON, "utf-8"));
    validNames = new Set<string>();
    for (const name of Object.keys(store.profiles ?? {})) {
      validNames.add(name);
      validNames.add("_team_" + name);
    }
  } catch {
    findings.push({
      check: "orphan-profile-dirs",
      title: "Skipped orphan directory check",
      severity: "info",
      status: "skipped",
      detail: "Cannot read profiles.json.",
    });
    return findings;
  }

  const IGNORE = new Set(["bin", "marketplace-cache", "doctor-backups"]);
  const orphans: string[] = [];
  for (const entry of fs.readdirSync(PROFILES_DIR)) {
    if (IGNORE.has(entry)) continue;
    if (entry.startsWith(".")) continue;
    // Skip files (json, backups, etc.) — only interested in directories.
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(PROFILES_DIR, entry));
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (validNames.has(entry)) continue;
    orphans.push(entry);
  }

  if (orphans.length === 0) {
    findings.push({
      check: "orphan-profile-dirs",
      title: "No orphan profile directories",
      severity: "info",
      status: "healthy",
      detail: "Every directory under ~/.claude-profiles/ matches a known profile.",
    });
  } else {
    findings.push({
      check: "orphan-profile-dirs",
      title: "Orphan profile directories",
      severity: "warn",
      status: "detected",
      detail: `${orphans.length} director${orphans.length === 1 ? "y" : "ies"} under ~/.claude-profiles/ don't match any profile. Not auto-removing — they may be in-progress or leftover from deleted profiles.`,
      itemsAffected: orphans,
    });
  }
  return findings;
}

// ─── alias collisions (report-only) ────────────────────────────────────────

function checkAliasCollisions(): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  let store: any;
  try {
    store = JSON.parse(fs.readFileSync(PROFILES_JSON, "utf-8"));
  } catch {
    findings.push({
      check: "alias-collisions",
      title: "Skipped alias collision check",
      severity: "info",
      status: "skipped",
      detail: "Cannot read profiles.json.",
    });
    return findings;
  }

  const aliases = new Map<string, string[]>();
  for (const [name, p] of Object.entries(store.profiles ?? {})) {
    const profile = p as { aliases?: Array<{ name: string }> };
    for (const alias of profile?.aliases ?? []) {
      if (typeof alias.name === "string" && alias.name) {
        const owners = aliases.get(alias.name) ?? [];
        owners.push(name);
        aliases.set(alias.name, owners);
      }
    }
  }

  const collisions: string[] = [];
  for (const [alias, owners] of aliases) {
    if (owners.length > 1) collisions.push(`${alias} → ${owners.join(", ")}`);
  }

  if (collisions.length === 0) {
    findings.push({
      check: "alias-collisions",
      title: "No alias collisions",
      severity: "info",
      status: "healthy",
      detail: `${aliases.size} alias(es) in use.`,
    });
  } else {
    findings.push({
      check: "alias-collisions",
      title: "Alias collisions",
      severity: "warn",
      status: "detected",
      detail: `${collisions.length} alias(es) claimed by multiple profiles. Open each profile and change its alias to resolve.`,
      itemsAffected: collisions,
    });
  }
  return findings;
}

// ─── dangling plugin refs (report-only) ────────────────────────────────────

function checkDanglingPluginRefs(): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  let store: any;
  try {
    store = JSON.parse(fs.readFileSync(PROFILES_JSON, "utf-8"));
  } catch {
    findings.push({
      check: "dangling-plugin-refs",
      title: "Skipped plugin reference check",
      severity: "info",
      status: "skipped",
      detail: "Cannot read profiles.json.",
    });
    return findings;
  }

  // Collect every plugin ID referenced by any profile.
  const allRefs: Array<{ profile: string; pluginId: string }> = [];
  for (const [name, p] of Object.entries(store.profiles ?? {})) {
    const profile = p as { plugins?: unknown };
    if (!Array.isArray(profile?.plugins)) continue;
    for (const pid of profile.plugins) {
      if (typeof pid === "string") {
        allRefs.push({ profile: name, pluginId: pid });
      }
    }
  }

  if (allRefs.length === 0) {
    findings.push({
      check: "dangling-plugin-refs",
      title: "No dangling plugin references",
      severity: "info",
      status: "healthy",
      detail: "No profiles reference any plugins.",
    });
    return findings;
  }

  // Resolve all unique IDs in one pass.
  const uniqueIds = [...new Set(allRefs.map((r) => r.pluginId))];
  const resolved = resolvePlugins(uniqueIds);
  const resolvedMap = new Map(resolved.map((r) => [r.id, r.resolved]));

  const dangling: string[] = [];
  for (const { profile, pluginId } of allRefs) {
    if (!resolvedMap.get(pluginId)) {
      dangling.push(`${profile}: ${pluginId}`);
    }
  }

  if (dangling.length === 0) {
    findings.push({
      check: "dangling-plugin-refs",
      title: "No dangling plugin references",
      severity: "info",
      status: "healthy",
      detail: "Every plugin referenced by a profile is installed.",
    });
  } else {
    findings.push({
      check: "dangling-plugin-refs",
      title: "Dangling plugin references",
      severity: "warn",
      status: "detected",
      detail: `${dangling.length} plugin reference(s) point at uninstalled plugins. Those profiles will launch broken. Install the missing plugins or remove them from the profile.`,
      itemsAffected: dangling,
    });
  }
  return findings;
}

// ─── top-level runner ───────────────────────────────────────────────────────

export function runProfilesDoctor(mode: DoctorMode): DoctorReport {
  const findings: DoctorFinding[] = [
    ...checkProfilesStore(mode),
    ...checkTeamsStore(mode),
    ...checkInstalledPluginsJson(),
    ...checkStaleBinAliases(mode),
    ...checkOrphanProfileDirs(),
    ...checkAliasCollisions(),
    ...checkDanglingPluginRefs(),
  ];

  const summary = {
    total: findings.length,
    healthy: findings.filter((f) => f.status === "healthy").length,
    detected: findings.filter((f) => f.status === "detected").length,
    fixed: findings.filter((f) => f.status === "fixed").length,
    unfixable: findings.filter((f) => f.status === "unfixable").length,
    skipped: findings.filter((f) => f.status === "skipped").length,
  };

  return {
    ranAt: new Date().toISOString(),
    mode,
    findings,
    summary,
  };
}
