/**
 * plugin-resolver.ts — unified plugin ID resolution.
 *
 * Single source of truth for "does this plugin ID map to something real on
 * disk?"  Scans all plugin sources once (marketplace manifest, local skills,
 * framework dirs, builtins) and builds a Map<string, ResolvedPlugin> that the
 * doctor, profile health checker, and IPC handler can query.
 *
 * Read-only — never writes files. Errors from unreadable sources are swallowed
 * so the remaining sources still register.
 */

import * as fs from "fs";
import * as path from "path";

import type { ResolvedPlugin } from "./types";
import {
  readSkillfishMarker,
  detectSkillLockSource,
  detectGitSource,
  scanInstalledPlugins,
} from "./plugins";
import { CLAUDE_HOME } from "./config";

// ── constants (mirror core.ts to avoid importing non-exported values) ──────

const LOCAL_PLUGIN_PREFIX = "local:";
const FRAMEWORK_PLUGIN_PREFIX = "framework:";
const BUILTIN_PLUGIN_NAME = "profiles-manager@claude-profiles";

// ── helpers ────────────────────────────────────────────────────────────────

/** Register an ID → ResolvedPlugin mapping, first-write wins. */
function register(
  map: Map<string, ResolvedPlugin>,
  id: string,
  source: ResolvedPlugin["source"],
  dirPath: string,
  label?: string,
): void {
  if (!map.has(id)) {
    map.set(id, { id, source, path: dirPath, ...(label ? { label } : {}) });
  }
}

/** True if `entry` is (or is a symlink to) a directory. */
function isDirLike(base: string, name: string): boolean {
  const full = path.join(base, name);
  try {
    return fs.statSync(full).isDirectory();
  } catch {
    return false;
  }
}

// ── core builder ───────────────────────────────────────────────────────────

/**
 * Build a full resolution map of every plugin ID that should be considered
 * "installed" right now. Scans:
 *
 *   1. `~/.claude/plugins/installed_plugins.json`  → marketplace plugins
 *   2. `~/.claude/skills/`                         → local / framework / skill-lock / git plugins
 *   3. `~/.claude/commands/`                       → local command namespace plugins
 *   4. `~/.claude/agents/`                         → local agents bucket plugin
 *   5. The builtin `profiles-manager@claude-profiles`
 *
 * For local skills, multiple ID forms are registered per directory so that
 * any ID a profile might have recorded will resolve correctly.
 */
export function buildResolutionMap(): Map<string, ResolvedPlugin> {
  const map = new Map<string, ResolvedPlugin>();

  // ── 1. Marketplace plugins ────────────────────────────────────────────
  try {
    const entries = scanInstalledPlugins();
    for (const entry of entries) {
      register(map, entry.name, "marketplace", entry.installPath, entry.pluginName);
    }
  } catch {
    // installed_plugins.json unreadable — skip, other sources still valid.
  }

  // ── 2. Skills directory ───────────────────────────────────────────────
  const skillsDir = path.join(CLAUDE_HOME, "skills");
  const skillLockManifestCache = new Map<string, any>();

  // Track whether any gsd-* skill dirs exist so we can register framework:gsd.
  let hasGsdSkills = false;

  // Check if GSD is installed (same logic as core.ts isGsdInstalled).
  const gsdInstalled =
    fs.existsSync(path.join(CLAUDE_HOME, "get-shit-done")) ||
    fs.existsSync(path.join(CLAUDE_HOME, "gsd-file-manifest.json"));

  // Track skill-lock groups for group-level IDs.
  const skillLockGroups = new Map<string, { groupName: string; path: string }>();

  if (fs.existsSync(skillsDir)) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (!isDirLike(skillsDir, entry.name)) continue;

      const skillDir = path.join(skillsDir, entry.name);
      const skillMd = path.join(skillDir, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;

      const dirName = entry.name;

      // Always register the local:{dirName} form.
      register(map, `${LOCAL_PLUGIN_PREFIX}${dirName}`, "local", skillDir, dirName);

      // GSD framework skills.
      if (gsdInstalled && dirName.startsWith("gsd-")) {
        hasGsdSkills = true;
        // Individual gsd-* dirs also get their local: form (already registered above).
        continue;
      }

      // Run detector chain: skillfish → skill-lock → git.
      let detectedSource: "local" | "skill-lock" | "git" = "local";
      let groupName: string | undefined;

      // Skillfish check.
      try {
        const sf = readSkillfishMarker(skillDir);
        if (sf) {
          // Skillfish skills are still "local" source type for resolution purposes.
          detectedSource = "local";
        }
      } catch { /* skip */ }

      // Skill-lock check.
      if (detectedSource === "local") {
        try {
          const sl = detectSkillLockSource(skillDir, skillLockManifestCache);
          if (sl) {
            detectedSource = "skill-lock";
            groupName = sl.groupName;

            // Register {groupName}:{dirName} form.
            if (groupName) {
              register(map, `${groupName}:${dirName}`, "skill-lock", skillDir, dirName);

              // Accumulate group-level info for registering local:{groupName} later.
              if (!skillLockGroups.has(groupName)) {
                skillLockGroups.set(groupName, { groupName, path: skillDir });
              }
            }
          }
        } catch { /* skip */ }
      }

      // Git check.
      if (detectedSource === "local") {
        try {
          const git = detectGitSource(skillDir);
          if (git) {
            detectedSource = "git";

            // Register local:{owner}/{repo} form if we can parse the remote.
            if (git.owner && git.repo) {
              register(
                map,
                `${LOCAL_PLUGIN_PREFIX}${git.owner}/${git.repo}`,
                "git",
                skillDir,
                `${git.owner}/${git.repo}`,
              );
            }
          }
        } catch { /* skip */ }
      }

      // Update the entry's source type if we detected something more specific.
      if (detectedSource !== "local") {
        const existing = map.get(`${LOCAL_PLUGIN_PREFIX}${dirName}`);
        if (existing) {
          existing.source = detectedSource;
        }
      }
    }

    // Also scan for nested owner/repo directories (e.g. ~/.claude/skills/owner/repo/).
    try {
      for (const ownerEntry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!ownerEntry.isDirectory() && !ownerEntry.isSymbolicLink()) continue;
        if (!isDirLike(skillsDir, ownerEntry.name)) continue;

        const ownerDir = path.join(skillsDir, ownerEntry.name);
        // Skip if it's a plain skill dir (has its own SKILL.md) — already handled above.
        if (fs.existsSync(path.join(ownerDir, "SKILL.md"))) continue;

        // Check for repo subdirs with SKILL.md.
        let repoEntries: fs.Dirent[];
        try {
          repoEntries = fs.readdirSync(ownerDir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const repoEntry of repoEntries) {
          if (!repoEntry.isDirectory() && !repoEntry.isSymbolicLink()) continue;
          if (!isDirLike(ownerDir, repoEntry.name)) continue;

          const repoDir = path.join(ownerDir, repoEntry.name);
          if (!fs.existsSync(path.join(repoDir, "SKILL.md"))) continue;

          const nestedId = `${ownerEntry.name}/${repoEntry.name}`;
          register(map, `${LOCAL_PLUGIN_PREFIX}${nestedId}`, "local", repoDir, nestedId);
        }
      }
    } catch { /* skip unreadable */ }
  }

  // Register group-level IDs for skill-lock groups.
  for (const [gName, info] of skillLockGroups) {
    register(map, `${LOCAL_PLUGIN_PREFIX}${gName}`, "skill-lock", info.path, gName);
  }

  // Register framework:gsd if any gsd-* skill dirs were found.
  if (gsdInstalled && hasGsdSkills) {
    register(
      map,
      `${FRAMEWORK_PLUGIN_PREFIX}gsd`,
      "framework",
      path.join(CLAUDE_HOME, "get-shit-done"),
      "Get Shit Done",
    );
  }

  // ── 3. Commands directory ─────────────────────────────────────────────
  const cmdsDir = path.join(CLAUDE_HOME, "commands");
  if (fs.existsSync(cmdsDir)) {
    try {
      for (const entry of fs.readdirSync(cmdsDir, { withFileTypes: true })) {
        if (entry.isDirectory() || (entry.isSymbolicLink() && isDirLike(cmdsDir, entry.name))) {
          const subDir = path.join(cmdsDir, entry.name);
          // Check if the dir has any .md files.
          try {
            const files = fs.readdirSync(subDir);
            if (files.some((f) => f.endsWith(".md"))) {
              // GSD command namespace → already covered by framework:gsd.
              if (gsdInstalled && entry.name === "gsd") continue;
              register(map, `${LOCAL_PLUGIN_PREFIX}${entry.name}`, "local", subDir, entry.name);
            }
          } catch { /* skip */ }
        } else if (entry.name.endsWith(".md")) {
          // Loose .md files → local:commands bucket plugin.
          register(map, `${LOCAL_PLUGIN_PREFIX}commands`, "local", cmdsDir, "commands");
        }
      }
    } catch { /* skip unreadable */ }
  }

  // ── 4. Agents directory ───────────────────────────────────────────────
  const agentsDir = path.join(CLAUDE_HOME, "agents");
  if (fs.existsSync(agentsDir)) {
    try {
      const files = fs.readdirSync(agentsDir);
      const hasNonGsdAgents = files.some(
        (f) => f.endsWith(".md") && f !== "README.md" && !(gsdInstalled && f.startsWith("gsd-")),
      );
      if (hasNonGsdAgents) {
        register(map, `${LOCAL_PLUGIN_PREFIX}agents`, "local", agentsDir, "agents");
      }
    } catch { /* skip unreadable */ }
  }

  // ── 5. Builtin plugin ────────────────────────────────────────────────
  const builtinDir = path.join(
    CLAUDE_HOME,
    "plugins",
    "cache",
    "claude-profiles",
    "profiles-manager",
  );
  register(map, BUILTIN_PLUGIN_NAME, "builtin", builtinDir, "Profiles Manager");

  return map;
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Resolve a single plugin ID. Returns null if the ID doesn't map to any
 * known plugin source.
 */
export function resolvePlugin(pluginId: string): ResolvedPlugin | null {
  const map = buildResolutionMap();
  return map.get(pluginId) ?? null;
}

/**
 * Resolve a batch of plugin IDs. Returns one entry per input ID, with
 * `resolved` set to the match or null if unresolvable. This is the main
 * consumer-facing entry point — callers pass a profile's `plugins[]` array
 * and get back everything they need to decide what's healthy vs dangling.
 */
export function resolvePlugins(
  pluginIds: string[],
): Array<{ id: string; resolved: ResolvedPlugin | null }> {
  const map = buildResolutionMap();
  return pluginIds.map((id) => ({
    id,
    resolved: map.get(id) ?? null,
  }));
}
