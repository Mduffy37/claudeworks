#!/usr/bin/env node
/**
 * list-addons.js
 *
 * Enumerate the skills, commands, agents, and local additions that the current
 * profile actually exposes — matching what src/electron/core.ts:scanPluginItems
 * will see at profile-assembly time.
 *
 * Why this exists: the previous inline `node -e` script inside list-addons'
 * SKILL.md did a naive `readdirSync(installPath + '/skills')` and missed three
 * categories of real skills:
 *
 *   1. Plugins declaring skills at a non-default path via `plugin.json`
 *      (e.g. `"skills": ["./.claude/skills/ui-ux-pro-max"]`).
 *   2. The container pattern `"skills": "./"` — where the plugin root is a
 *      container of skill subdirectories. Applies to both the "many subdirs"
 *      form (engineering-advanced-skills) and the "single SKILL.md at root"
 *      form (a11y-audit).
 *   3. `local:*` plugins that live in ~/.claude/skills/ and never appear in
 *      installed_plugins.json — including grouped local plugins whose source
 *      lives in a .skill-lock.json manifest (the skill-lock detector added
 *      in src/electron/core.ts).
 *
 * This helper implements all three in plain node so the skill output matches
 * the Electron app's badge counts. It's a verbatim port of scanPluginItems +
 * scanUserLocalPlugins from core.ts — keep them in sync when core.ts changes.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

// ─── Frontmatter parser (mirrors core.ts:readFrontmatter) ───────────────────

function readFrontmatter(mdPath) {
  try {
    const content = fs.readFileSync(mdPath, "utf-8");
    if (!content.startsWith("---")) return {};
    const end = content.indexOf("\n---", 3);
    if (end === -1) return {};
    const yaml = content.slice(3, end);
    const fm = {};
    for (const line of yaml.split("\n")) {
      const m = line.match(/^([A-Za-z_-][\w-]*)\s*:\s*(.+?)\s*$/);
      if (!m) continue;
      fm[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return fm;
  } catch {
    return {};
  }
}

// ─── Plugin manifest reader (mirrors core.ts:readPluginManifest) ────────────

function readPluginManifest(pluginRoot) {
  const manifestPath = path.join(pluginRoot, ".claude-plugin", "plugin.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return null;
  }
}

function normaliseManifestPaths(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  if (typeof v === "string") return [v];
  return null;
}

// ─── Directory-ish test (mirrors core.ts:direntIsDirLike) ───────────────────

function direntIsDirLike(entry, parentDir) {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) {
    try { return fs.statSync(path.join(parentDir, entry.name)).isDirectory(); }
    catch { return false; }
  }
  return false;
}

// ─── Manifest path resolvers (mirror core.ts) ───────────────────────────────

function resolveSkillManifestEntry(pluginRoot, entry) {
  if (typeof entry !== "string") return [];
  const absolute = path.resolve(pluginRoot, entry);
  const rootResolved = path.resolve(pluginRoot);
  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + path.sep)) return [];
  if (!fs.existsSync(absolute)) return [];

  const stat = fs.statSync(absolute);
  if (stat.isFile() && absolute.endsWith(".md")) return [absolute];
  if (!stat.isDirectory()) return [];

  // Prefer multi-skill container: immediate subdirs with SKILL.md.
  const subdirs = [];
  try {
    for (const child of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (!direntIsDirLike(child, absolute)) continue;
      const skillMd = path.join(absolute, child.name, "SKILL.md");
      if (fs.existsSync(skillMd)) subdirs.push(skillMd);
    }
  } catch { /* ignore */ }
  if (subdirs.length > 0) return subdirs;

  // Fallback: single-skill layout, SKILL.md at the directory itself.
  const direct = path.join(absolute, "SKILL.md");
  if (fs.existsSync(direct)) return [direct];

  return [];
}

function resolveSingleFileManifestEntry(pluginRoot, entry) {
  if (typeof entry !== "string") return null;
  const absolute = path.resolve(pluginRoot, entry);
  const rootResolved = path.resolve(pluginRoot);
  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + path.sep)) return null;
  if (!fs.existsSync(absolute)) return null;
  const stat = fs.statSync(absolute);
  if (stat.isFile() && absolute.endsWith(".md")) return absolute;
  return null;
}

// ─── Item scanner (mirrors core.ts:scanPluginItems) ─────────────────────────

/**
 * Returns { skills, commands, agents } each an array of { name, description }.
 * Skips items where SKILL.md frontmatter sets `user-invocable: false`.
 */
function scanPluginItems(installPath) {
  const out = { skills: [], commands: [], agents: [] };
  if (!fs.existsSync(installPath)) return out;

  const manifest = readPluginManifest(installPath);
  const mSkills = manifest ? normaliseManifestPaths(manifest.skills) : null;
  const mCommands = manifest ? normaliseManifestPaths(manifest.commands) : null;
  const mAgents = manifest ? normaliseManifestPaths(manifest.agents) : null;

  // Skills
  if (mSkills) {
    const seen = new Set();
    for (const entry of mSkills) {
      for (const skillMd of resolveSkillManifestEntry(installPath, entry)) {
        if (seen.has(skillMd)) continue;
        seen.add(skillMd);
        pushSkill(out, skillMd, path.basename(path.dirname(skillMd)));
      }
    }
  } else {
    const skillsDir = path.join(installPath, "skills");
    if (fs.existsSync(skillsDir)) {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!direntIsDirLike(entry, skillsDir)) continue;
        const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
        if (!fs.existsSync(skillMd)) continue;
        pushSkill(out, skillMd, entry.name);
      }
    }
  }

  // Commands
  if (mCommands) {
    for (const entry of mCommands) {
      const resolved = resolveSingleFileManifestEntry(installPath, entry);
      if (!resolved) continue;
      pushCommand(out, resolved, path.basename(resolved, ".md"));
    }
  } else {
    const cmdsDir = path.join(installPath, "commands");
    if (fs.existsSync(cmdsDir)) {
      for (const file of fs.readdirSync(cmdsDir)) {
        if (!file.endsWith(".md")) continue;
        pushCommand(out, path.join(cmdsDir, file), path.basename(file, ".md"));
      }
    }
  }

  // Agents
  if (mAgents) {
    for (const entry of mAgents) {
      const resolved = resolveSingleFileManifestEntry(installPath, entry);
      if (!resolved) continue;
      pushAgent(out, resolved, path.basename(resolved, ".md"));
    }
  } else {
    const agentsDir = path.join(installPath, "agents");
    if (fs.existsSync(agentsDir)) {
      for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
        // Flat file: agents/foo.md
        if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") {
          pushAgent(out, path.join(agentsDir, entry.name), path.basename(entry.name, ".md"));
          continue;
        }
        // Directory layout: agents/foo/AGENT.md (mirrors skills/<name>/SKILL.md)
        if (direntIsDirLike(entry, agentsDir)) {
          const agentMd = path.join(agentsDir, entry.name, "AGENT.md");
          if (fs.existsSync(agentMd)) {
            pushAgent(out, agentMd, entry.name);
          }
        }
      }
    }
  }

  // Root-.md heuristic fallback (mirrors core.ts): plugins with no manifest
  // and no subdirs may ship bare .md files at the root as agents.
  if (out.skills.length === 0 && out.commands.length === 0 && out.agents.length === 0 && !manifest) {
    const hasSubdirs = ["skills", "agents", "commands"].some((d) => fs.existsSync(path.join(installPath, d)));
    if (!hasSubdirs) {
      const EXCLUDES = new Set(["README.md", "CLAUDE.md", "CHANGELOG.md", "LICENSE.md", "CONTRIBUTING.md"]);
      for (const file of fs.readdirSync(installPath)) {
        if (!file.endsWith(".md") || EXCLUDES.has(file)) continue;
        pushAgent(out, path.join(installPath, file), path.basename(file, ".md"));
      }
    }
  }

  return out;
}

function pushSkill(out, skillMd, fallbackName) {
  const fm = readFrontmatter(skillMd);
  const userInvocable = (fm["user-invocable"] ?? "true").toLowerCase() !== "false";
  if (!userInvocable) return;
  out.skills.push({
    name: fm.name ?? fallbackName,
    description: (fm.description ?? "").trim(),
  });
}

function pushCommand(out, cmdPath, fallbackName) {
  const fm = readFrontmatter(cmdPath);
  out.commands.push({ name: fm.name ?? fallbackName, description: (fm.description ?? "").trim() });
}

function pushAgent(out, agentPath, fallbackName) {
  const fm = readFrontmatter(agentPath);
  out.agents.push({ name: fm.name ?? fallbackName, description: (fm.description ?? "").trim() });
}

// ─── Local-plugin resolvers (mirror core.ts:scanUserLocalPlugins) ───────────

/**
 * Build a map from grouped-local-plugin-name → list of skill directories,
 * by reading .skill-lock.json manifests reachable via symlinks in ~/.claude/skills.
 * Mirrors detectSkillLockSource in core.ts.
 */
function buildSkillLockGroups() {
  const groups = new Map();  // groupName → [{ skillDir, skillName }]
  const claudeSkills = path.join(os.homedir(), ".claude", "skills");
  if (!fs.existsSync(claudeSkills)) return groups;

  const manifestCache = new Map();
  for (const entry of fs.readdirSync(claudeSkills, { withFileTypes: true })) {
    if (!entry.isSymbolicLink() && !entry.isDirectory()) continue;
    const skillDir = path.join(claudeSkills, entry.name);
    const skillMd = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;

    let realPath;
    try { realPath = fs.realpathSync(skillDir); } catch { continue; }
    const skillKey = path.basename(realPath);

    // Walk up from real path looking for .skill-lock.json (bounded at $HOME).
    let manifest = null;
    let dir = path.dirname(realPath);
    const home = os.homedir();
    while (dir && dir !== path.dirname(dir)) {
      const candidate = path.join(dir, ".skill-lock.json");
      if (manifestCache.has(candidate)) { manifest = manifestCache.get(candidate); break; }
      if (fs.existsSync(candidate)) {
        try {
          manifest = JSON.parse(fs.readFileSync(candidate, "utf-8"));
          manifestCache.set(candidate, manifest);
        } catch {
          manifestCache.set(candidate, null);
        }
        break;
      }
      if (dir === home) break;
      dir = path.dirname(dir);
    }
    if (!manifest || !manifest.skills) continue;

    const manifestEntry = manifest.skills[skillKey];
    if (!manifestEntry || !manifestEntry.source) continue;
    const groupName = String(manifestEntry.source);

    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push({ skillDir, skillName: entry.name });
  }
  return groups;
}

/**
 * Resolve a local:<name> entry to its items. Three shapes are supported:
 *   - local:<simple-name>         → ~/.claude/skills/<name>/ (single skill)
 *                                   or ~/.claude/commands/<name>/ (command namespace)
 *   - local:<source-with-slash>   → grouped skill-lock plugin; items come from
 *                                   buildSkillLockGroups() keyed by <source-with-slash>
 *   - local:agents / local:commands → loose top-level items
 */
function resolveLocalPlugin(name, skillLockGroups) {
  const out = { skills: [], commands: [], agents: [] };
  const claudeHome = path.join(os.homedir(), ".claude");

  // Grouped skill-lock plugin (name contains `/`, looks like owner/repo).
  if (name.includes("/") && skillLockGroups.has(name)) {
    for (const { skillDir, skillName } of skillLockGroups.get(name)) {
      const skillMd = path.join(skillDir, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      const fm = readFrontmatter(skillMd);
      const userInvocable = (fm["user-invocable"] ?? "true").toLowerCase() !== "false";
      if (!userInvocable) continue;
      out.skills.push({
        name: fm.name ?? skillName,
        description: (fm.description ?? "").trim(),
      });
    }
    return out;
  }

  // Single-skill local plugin at ~/.claude/skills/<name>/.
  const skillMd = path.join(claudeHome, "skills", name, "SKILL.md");
  if (fs.existsSync(skillMd)) {
    pushSkill(out, skillMd, name);
  }

  // Command namespace at ~/.claude/commands/<name>/.
  const cmdNs = path.join(claudeHome, "commands", name);
  if (fs.existsSync(cmdNs) && fs.statSync(cmdNs).isDirectory()) {
    for (const f of fs.readdirSync(cmdNs)) {
      if (!f.endsWith(".md")) continue;
      pushCommand(out, path.join(cmdNs, f), path.basename(f, ".md"));
    }
  }

  // Special buckets for loose top-level items.
  if (name === "agents") {
    const agentsDir = path.join(claudeHome, "agents");
    if (fs.existsSync(agentsDir)) {
      for (const f of fs.readdirSync(agentsDir)) {
        if (!f.endsWith(".md") || f === "README.md") continue;
        pushAgent(out, path.join(agentsDir, f), path.basename(f, ".md"));
      }
    }
  }
  if (name === "commands") {
    const cmdsDir = path.join(claudeHome, "commands");
    if (fs.existsSync(cmdsDir)) {
      for (const f of fs.readdirSync(cmdsDir)) {
        if (!f.endsWith(".md")) continue;
        pushCommand(out, path.join(cmdsDir, f), path.basename(f, ".md"));
      }
    }
  }

  return out;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  const cd = process.env.CLAUDE_CONFIG_DIR;
  if (!cd) {
    console.log("Not running under a profile (no CLAUDE_CONFIG_DIR)");
    return;
  }
  const parts = cd.split(path.sep);
  const profileName = parts[parts.lastIndexOf("config") - 1];

  const profilesPath = path.join(os.homedir(), ".claude-profiles", "profiles.json");
  if (!fs.existsSync(profilesPath)) {
    console.log("profiles.json not found");
    return;
  }
  const profile = JSON.parse(fs.readFileSync(profilesPath, "utf-8")).profiles[profileName];
  if (!profile) {
    console.log("Profile not found: " + profileName);
    return;
  }

  const manifestPath = path.join(cd, "plugins", "installed_plugins.json");
  const installed = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
    : { plugins: {} };

  const excluded = profile.excludedItems || {};
  const skillLockGroups = buildSkillLockGroups();

  const skills = [], commands = [], agents = [];

  for (const pluginId of profile.plugins || []) {
    const shortName = pluginId.split("@")[0].replace(/^local:/, "");
    const pluginExcl = excluded[pluginId] || [];

    if (pluginId.startsWith("local:")) {
      const localName = pluginId.slice("local:".length);
      const items = resolveLocalPlugin(localName, skillLockGroups);
      for (const s of items.skills)
        skills.push({ pluginShort: shortName, ...s, excluded: pluginExcl.includes(s.name) });
      for (const c of items.commands)
        commands.push({ pluginShort: shortName, ...c, excluded: pluginExcl.includes(c.name) });
      for (const a of items.agents)
        agents.push({ pluginShort: shortName, ...a, excluded: pluginExcl.includes(a.name) });
      continue;
    }

    const installs = installed.plugins?.[pluginId];
    if (!installs) continue;
    for (const inst of installs) {
      const items = scanPluginItems(inst.installPath);
      for (const s of items.skills)
        skills.push({ pluginShort: shortName, ...s, excluded: pluginExcl.includes(s.name) });
      for (const c of items.commands)
        commands.push({ pluginShort: shortName, ...c, excluded: pluginExcl.includes(c.name) });
      for (const a of items.agents)
        agents.push({ pluginShort: shortName, ...a, excluded: pluginExcl.includes(a.name) });
    }
  }

  // Local items from the working directory's .claude/ folder (independent of profile plugins).
  const wd = profile.directory || process.cwd();
  const localWd = path.join(wd, ".claude");
  const localItems = [];
  if (fs.existsSync(localWd)) {
    const ls = path.join(localWd, "skills");
    if (fs.existsSync(ls)) {
      for (const d of fs.readdirSync(ls)) {
        if (fs.existsSync(path.join(ls, d, "SKILL.md"))) localItems.push(`${d} (skill)`);
      }
    }
    const lc = path.join(localWd, "commands");
    if (fs.existsSync(lc)) {
      for (const f of fs.readdirSync(lc)) {
        if (f.endsWith(".md")) localItems.push(`${f.replace(/\.md$/, "")} (command)`);
      }
    }
    const la = path.join(localWd, "agents");
    if (fs.existsSync(la)) {
      for (const f of fs.readdirSync(la)) {
        if (f.endsWith(".md") && f !== "README.md") localItems.push(`${f.replace(/\.md$/, "")} (agent)`);
      }
    }
  }

  // ─── JSON output mode (Phase 1 of the three-phase validator) ──────────────
  //
  // When invoked with `--json`, emit a machine-readable structure that the
  // SKILL.md can pipe into Claude for comparison against what's actually
  // loaded in the session. Format:
  //   { profile, counts, skills, commands, agents }
  // Items are flat `plugin:name` strings for trivial set-difference diffing.

  if (process.argv.includes("--json")) {
    const toKey = (x) => `${x.pluginShort}:${x.name}`;
    const activeKeys = (arr) => arr.filter((x) => !x.excluded).map(toKey).sort();
    const excludedKeys = (arr) => arr.filter((x) => x.excluded).map(toKey).sort();
    const payload = {
      profile: profileName,
      pluginCount: (profile.plugins || []).length,
      counts: {
        skills: skills.filter((x) => !x.excluded).length,
        commands: commands.filter((x) => !x.excluded).length,
        agents: agents.filter((x) => !x.excluded).length,
        excluded:
          skills.filter((x) => x.excluded).length +
          commands.filter((x) => x.excluded).length +
          agents.filter((x) => x.excluded).length,
      },
      skills: activeKeys(skills),
      commands: activeKeys(commands),
      agents: activeKeys(agents),
      excludedSkills: excludedKeys(skills),
      excludedCommands: excludedKeys(commands),
      excludedAgents: excludedKeys(agents),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }

  // ─── Format output (matches the previous inline script's shape) ────────────

  console.log("");
  console.log("Profile: " + profileName);
  console.log("Plugins: " + (profile.plugins || []).length);
  console.log("");

  const render = (label, arr, prefix) => {
    if (arr.length === 0) return;
    const active = arr.filter((x) => !x.excluded);
    const excl = arr.filter((x) => x.excluded);
    // Excluded items are summarised in the header count only — never enumerated,
    // because mega-bundle plugins (e.g. antigravity-awesome-skills) can have
    // 1000+ exclusions that would bury the active list.
    console.log(
      `${label} (${active.length} active${excl.length ? ", " + excl.length + " excluded" : ""}):`,
    );
    for (const x of active) {
      const desc = x.description ? ` — ${x.description.slice(0, 80)}` : "";
      console.log(`  + ${prefix}${x.pluginShort}:${x.name}${desc}`);
    }
  };

  render("Skills", skills, "");
  render("Commands", commands, "/");
  render("Agents", agents, "");

  if (localItems.length) {
    console.log("");
    console.log(`Local (from ${wd}/.claude/):`);
    for (const l of localItems) console.log("  ~ " + l);
  }
  console.log("");
}

main();
