#!/usr/bin/env node
/**
 * list-local-plugins.js
 *
 * Scan the user's local, non-marketplace items under ~/.claude/ and emit them
 * in the same shape as the curated marketplace's catalog.json and items.ndjson.
 * This lets the create-profile and suggest-plugins skills treat locally-installed
 * skills, agents, and commands as first-class candidates during retrieval.
 *
 * Mirrors src/electron/core.ts:scanUserLocalPlugins() at a fraction of the
 * complexity — enough that the skills' grep-and-rank pipeline can include
 * local items without needing any new code paths.
 *
 * Usage:  node list-local-plugins.js
 * Output:
 *   - Writes ~/.claude-profiles/marketplace-cache/local-catalog.json
 *     (same shape as catalog.json, with marketplace: "local" on each plugin)
 *   - Writes ~/.claude-profiles/marketplace-cache/local-items.ndjson
 *     (same shape as items.ndjson, one JSON object per line)
 *   - Prints a single-line JSON summary to stdout
 *
 * The files are rebuilt on every invocation (no TTL) because local items can
 * change between skill runs and are cheap to re-scan.
 *
 * Plugin ID format: local:<name> — matches LOCAL_PLUGIN_PREFIX from core.ts
 * and is recognized by the Electron app's profile loader.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const CLAUDE_HOME = path.join(os.homedir(), ".claude");
const CACHE_DIR = path.join(os.homedir(), ".claude-profiles", "marketplace-cache");
const CATALOG_OUT = path.join(CACHE_DIR, "local-catalog.json");
const ITEMS_OUT = path.join(CACHE_DIR, "local-items.ndjson");

// ─── Frontmatter parser ─────────────────────────────────────────────────────

/**
 * Minimal YAML-ish frontmatter reader. Pulls top-level scalar keys plus
 * handles the two most common multi-line patterns used in Claude Code
 * skills: folded scalars (`description: >` followed by indented lines,
 * joined with spaces) and literal blocks (`description: |`, joined with
 * newlines). That covers the real skills in ~/.claude/skills/ without
 * pulling in a full YAML dependency.
 *
 * Everything else — nested maps, anchors, tags, quoted multi-line strings
 * with embedded colons — is ignored. If it matters later we can upgrade
 * to a real YAML parser.
 */
function readFrontmatter(mdPath) {
  try {
    const content = fs.readFileSync(mdPath, "utf-8");
    if (!content.startsWith("---")) return {};
    const end = content.indexOf("\n---", 3);
    if (end === -1) return {};
    const yaml = content.slice(3, end).trim();
    const lines = yaml.split("\n");
    const out = {};

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (!m) { i++; continue; }

      const key = m[1];
      let value = m[2].trim();

      // Folded scalar (>) or literal block (|) — collect indented continuation.
      if (value === ">" || value === "|") {
        const joiner = value === ">" ? " " : "\n";
        const continuation = [];
        i++;
        while (i < lines.length) {
          const next = lines[i];
          // Stop when we hit a non-indented line that looks like the next key.
          if (/^[a-zA-Z0-9_-]+:/.test(next)) break;
          // Stop on a completely empty line followed by a new key — for
          // simplicity, an empty line in the middle of a block terminates it.
          if (next.trim() === "" && i + 1 < lines.length && /^[a-zA-Z0-9_-]+:/.test(lines[i + 1])) break;
          continuation.push(next.trim());
          i++;
        }
        out[key] = continuation.filter(Boolean).join(joiner);
        continue;
      }

      // Plain scalar — strip surrounding quotes if present.
      out[key] = value.replace(/^["']|["']$/g, "");
      i++;
    }

    return out;
  } catch {
    return {};
  }
}

// ─── Collectors ─────────────────────────────────────────────────────────────

const plugins = [];
const items = [];

function pushPlugin(id, displayName, description, counts, sourceUrl) {
  plugins.push({
    id,
    displayName,
    description: description || "",
    marketplace: "local",
    collections: [],
    featured: false,
    counts,
    sourceUrl,
    topKeywords: [],
  });
}

function pushItem(kind, id, plugin, desc, sourceUrl) {
  items.push({
    kind,
    id,
    plugin,
    desc: (desc || "").replace(/\s+/g, " ").trim(),
    sourceUrl,
  });
}

// ─── Skill-lock grouping ────────────────────────────────────────────────────
//
// Mirror of core.ts:detectSkillLockSource. Skills installed by a CLI that
// writes .skill-lock.json (e.g. Leonxlnx's skill-cli used by taste-skill)
// collapse into one synthetic plugin per `source` so both the skill and the
// Electron scanner agree on plugin IDs. Without this, the skill would write
// profiles with per-skill `local:<name>` IDs that the scanner has already
// grouped away, firing the "missing plugins" banner.

const _skillLockManifestCache = new Map();

function detectSkillLockSource(skillDir) {
  let realPath;
  try { realPath = fs.realpathSync(skillDir); } catch { return null; }
  const skillKey = path.basename(realPath);

  const home = os.homedir();
  let dir = path.dirname(realPath);
  let manifest = null;
  while (dir && dir !== path.dirname(dir)) {
    const candidate = path.join(dir, ".skill-lock.json");
    if (_skillLockManifestCache.has(candidate)) {
      manifest = _skillLockManifestCache.get(candidate);
      break;
    }
    if (fs.existsSync(candidate)) {
      try {
        manifest = JSON.parse(fs.readFileSync(candidate, "utf-8"));
        _skillLockManifestCache.set(candidate, manifest);
      } catch {
        _skillLockManifestCache.set(candidate, null);
      }
      break;
    }
    if (dir === home) break;
    dir = path.dirname(dir);
  }

  if (!manifest || !manifest.skills || typeof manifest.skills !== "object") return null;
  const entry = manifest.skills[skillKey];
  if (!entry || !entry.source) return null;

  return {
    groupKey: `skill-lock:${entry.source}`,
    groupName: String(entry.source),
    sourceUrl: entry.sourceUrl,
  };
}

// ─── Skills: ~/.claude/skills/<name>/SKILL.md ───────────────────────────────

function scanSkills() {
  const dir = path.join(CLAUDE_HOME, "skills");
  if (!fs.existsSync(dir)) return;

  const groupedSkills = new Map();

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try { isDir = fs.statSync(fullPath).isDirectory(); } catch { continue; }
    }
    if (!isDir) continue;

    const skillMd = path.join(fullPath, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;

    const fm = readFrontmatter(skillMd);
    const skillName = fm.name || entry.name;

    const group = detectSkillLockSource(fullPath);
    if (group) {
      let bucket = groupedSkills.get(group.groupKey);
      if (!bucket) {
        bucket = { groupName: group.groupName, sourceUrl: group.sourceUrl, items: [] };
        groupedSkills.set(group.groupKey, bucket);
      }
      bucket.items.push({ dirName: entry.name, skillName, description: fm.description, skillMd });
      continue;
    }

    const pluginId = `local:${entry.name}`;
    pushPlugin(
      pluginId,
      entry.name,
      fm.description,
      { skills: 1, agents: 0, commands: 0 },
      "file://" + fullPath,
    );
    pushItem(
      "skill",
      `local/${entry.name}/${skillName}`,
      pluginId,
      fm.description,
      "file://" + skillMd,
    );
  }

  for (const bucket of groupedSkills.values()) {
    const pluginId = `local:${bucket.groupName}`;
    const roster = bucket.items.map((i) => i.skillName).join(", ");
    pushPlugin(
      pluginId,
      bucket.groupName,
      `Grouped skills from ${bucket.groupName}: ${roster}`,
      { skills: bucket.items.length, agents: 0, commands: 0 },
      bucket.sourceUrl || undefined,
    );
    for (const it of bucket.items) {
      pushItem(
        "skill",
        `local/${bucket.groupName}/${it.skillName}`,
        pluginId,
        it.description,
        "file://" + it.skillMd,
      );
    }
  }
}

// ─── Agents: ~/.claude/agents/*.md ──────────────────────────────────────────

function scanAgents() {
  const dir = path.join(CLAUDE_HOME, "agents");
  if (!fs.existsSync(dir)) return;

  const looseAgents = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const agentPath = path.join(dir, entry.name);
    const fm = readFrontmatter(agentPath);
    const agentName = fm.name || path.basename(entry.name, ".md");
    looseAgents.push({
      name: agentName,
      description: fm.description,
      path: agentPath,
    });
  }

  if (looseAgents.length === 0) return;

  // Group all loose agents into a single synthetic local:agents plugin —
  // matches scanUserLocalPlugins()'s "catch-all plugin for loose agents" behavior.
  pushPlugin(
    "local:agents",
    "agents",
    `${looseAgents.length} user-installed agents in ~/.claude/agents/`,
    { skills: 0, agents: looseAgents.length, commands: 0 },
    "file://" + dir,
  );
  for (const a of looseAgents) {
    pushItem(
      "agent",
      `local/agents/${a.name}`,
      "local:agents",
      a.description,
      "file://" + a.path,
    );
  }
}

// ─── Commands: ~/.claude/commands/{*.md,<namespace>/*.md} ───────────────────

function scanCommands() {
  const dir = path.join(CLAUDE_HOME, "commands");
  if (!fs.existsSync(dir)) return;

  const looseCmds = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Namespace directory: collect all *.md files inside as one plugin.
      const nsDir = path.join(dir, entry.name);
      const nsItems = [];
      for (const file of fs.readdirSync(nsDir)) {
        if (!file.endsWith(".md")) continue;
        const cmdPath = path.join(nsDir, file);
        const fm = readFrontmatter(cmdPath);
        const cmdName = fm.name || `${entry.name}:${path.basename(file, ".md")}`;
        nsItems.push({ name: cmdName, description: fm.description, path: cmdPath });
      }
      if (nsItems.length === 0) continue;

      const pluginId = `local:${entry.name}`;
      pushPlugin(
        pluginId,
        entry.name,
        `${nsItems.length} commands in the ${entry.name} namespace`,
        { skills: 0, agents: 0, commands: nsItems.length },
        "file://" + nsDir,
      );
      for (const c of nsItems) {
        pushItem(
          "command",
          `local/${entry.name}/${c.name}`,
          pluginId,
          c.description,
          "file://" + c.path,
        );
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      // Loose .md command at the root of commands/.
      const cmdPath = path.join(dir, entry.name);
      const fm = readFrontmatter(cmdPath);
      const cmdName = fm.name || path.basename(entry.name, ".md");
      looseCmds.push({ name: cmdName, description: fm.description, path: cmdPath });
    }
  }

  if (looseCmds.length === 0) return;

  pushPlugin(
    "local:commands",
    "commands",
    `${looseCmds.length} loose user commands in ~/.claude/commands/`,
    { skills: 0, agents: 0, commands: looseCmds.length },
    "file://" + dir,
  );
  for (const c of looseCmds) {
    pushItem(
      "command",
      `local/commands/${c.name}`,
      "local:commands",
      c.description,
      "file://" + c.path,
    );
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  scanSkills();
  scanAgents();
  scanCommands();

  // Write the catalog (JSON) and items (NDJSON) files.
  const catalog = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "local",
    plugins,
  };
  fs.writeFileSync(CATALOG_OUT, JSON.stringify(catalog, null, 2) + "\n");

  const ndjson = items.map((it) => JSON.stringify(it)).join("\n");
  fs.writeFileSync(ITEMS_OUT, ndjson + (ndjson.length > 0 ? "\n" : ""));

  // Summary to stdout.
  const summary = {
    pluginCount: plugins.length,
    skillCount: items.filter((i) => i.kind === "skill").length,
    agentCount: items.filter((i) => i.kind === "agent").length,
    commandCount: items.filter((i) => i.kind === "command").length,
    catalogPath: CATALOG_OUT,
    itemsPath: ITEMS_OUT,
  };
  process.stdout.write(JSON.stringify(summary) + "\n");
}

main();
