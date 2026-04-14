#!/usr/bin/env node
/**
 * list-plugin-items.js
 *
 * Enumerate the real, on-disk item names for an installed plugin by walking
 * its installPath/skills, installPath/agents, installPath/commands directories.
 * This is the **canonical source of truth** for an exclude-list generator,
 * because it matches exactly what applyExclusions() in src/electron/core.ts
 * will see when it runs at profile assembly time.
 *
 * Why this exists and is used INSTEAD of grep'ing items.ndjson in the
 * create-profile skill's Step 6c exclude-list generation:
 *
 *   items.ndjson is built from the curated marketplace repo via gh api calls,
 *   and the GitHub Contents API caps directory listings at 1000 entries. For
 *   mega-bundle plugins with more items than that (antigravity-awesome-skills
 *   had 1370 installed items but items.ndjson only listed 999), items.ndjson
 *   is silently truncated and an exclude list built from it will miss the
 *   hundreds of items it never saw. The result is a profile where applyExclusions
 *   prunes exactly the items Claude knew about and leaves every other item
 *   untouched — often ending up with many hundreds of unintended active skills.
 *
 *   The fix: for exclude-list generation, always enumerate from the real
 *   installed plugin directory. The item names in `excludedItems[pluginId]`
 *   must match the names applyExclusions actually sees at prune time, which
 *   come from scanPluginItems() in core.ts. This script mirrors that function's
 *   naming logic — frontmatter `name:` with directory-basename fallback — so
 *   the list it produces is exactly what applyExclusions will match against.
 *
 * Usage:
 *   node list-plugin-items.js '<plugin-id>'
 *     where <plugin-id> is the plugin's key from installed_plugins.json,
 *     typically "<pluginName>@<marketplaceId>" for marketplace plugins,
 *     "local:<name>" for user-installed local plugins,
 *     or "framework:<name>" for synthetic framework wrappers.
 *
 * Output: single-line JSON on stdout.
 *   success: {"ok": true, "pluginId": "...", "installPath": "...", "items": ["name1", "name2", ...]}
 *   failure: {"ok": false, "error": "<reason>", "pluginId": "..."}
 *
 * The `items` array is the full, real, on-disk item list for the plugin.
 * Compute the exclude list as (this.items) - (Claude's kept set), and the
 * result is guaranteed to match what applyExclusions will see.
 *
 * Local plugins (plugin-id starting with `local:`) are looked up by walking
 * ~/.claude/skills/<name>, ~/.claude/agents, ~/.claude/commands, since those
 * don't have an installed_plugins.json entry.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

function fail(error, pluginId) {
  process.stdout.write(
    JSON.stringify({ ok: false, error, pluginId: pluginId || null }) + "\n",
  );
  process.exit(0);
}

const pluginId = process.argv[2];
if (!pluginId) {
  fail("Missing plugin id argument. Usage: list-plugin-items.js '<plugin-id>'", null);
}

// ─── Frontmatter parser ─────────────────────────────────────────────────────

/**
 * Read a skill/command/agent .md file's frontmatter and return the `name`
 * field if present. Fallback to the file's directory basename (for skills)
 * or filename (for agents/commands).
 *
 * Mirrors core.ts:buildItem which sets item.name = fm.name ?? fallbackName.
 * applyExclusions compares excludedNames.includes(item.name), so these must
 * match — if a skill has `name: my-real-name` in its frontmatter, that's what
 * the exclude list must reference, not its directory name.
 */
function readFrontmatterName(mdPath, fallback) {
  try {
    const content = fs.readFileSync(mdPath, "utf-8");
    if (!content.startsWith("---")) return fallback;
    const end = content.indexOf("\n---", 3);
    if (end === -1) return fallback;
    const yaml = content.slice(3, end);
    const match = yaml.match(/^name:\s*(.+)$/m);
    if (!match) return fallback;
    // Strip surrounding quotes and whitespace
    return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return fallback;
  }
}

// ─── Item scanning (mirrors core.ts:scanPluginItems) ────────────────────────

function scanDir(installPath) {
  const items = [];

  // Skills: each subdirectory with a SKILL.md → one item
  const skillsDir = path.join(installPath, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try { isDir = fs.statSync(path.join(skillsDir, entry.name)).isDirectory(); }
        catch { continue; }
      }
      if (!isDir) continue;
      const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      items.push({ kind: "skill", name: readFrontmatterName(skillMd, entry.name) });
    }
  }

  // Commands: each *.md file → one item; each subdirectory is a namespace
  const cmdsDir = path.join(installPath, "commands");
  if (fs.existsSync(cmdsDir)) {
    for (const entry of fs.readdirSync(cmdsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const p = path.join(cmdsDir, entry.name);
        const fallback = entry.name.slice(0, -3);
        items.push({ kind: "command", name: readFrontmatterName(p, fallback) });
      } else if (entry.isDirectory()) {
        const nsDir = path.join(cmdsDir, entry.name);
        for (const f of fs.readdirSync(nsDir)) {
          if (!f.endsWith(".md")) continue;
          const p = path.join(nsDir, f);
          const fallback = f.slice(0, -3);
          items.push({ kind: "command", name: readFrontmatterName(p, fallback) });
        }
      }
    }
  }

  // Agents: each *.md file → one item (except README.md)
  const agentsDir = path.join(installPath, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "README.md") continue;
      const p = path.join(agentsDir, entry.name);
      const fallback = entry.name.slice(0, -3);
      items.push({ kind: "agent", name: readFrontmatterName(p, fallback) });
    }
  }

  return items;
}

// ─── Resolve the install path for a given plugin id ─────────────────────────

function resolveLocalPluginPath(pluginId) {
  // local:<name> maps to ~/.claude/{skills,agents,commands}/<name>
  // Note: for local plugins, the "installPath" convention is different —
  // each local item type has its own directory. We return ~/.claude so the
  // scanner finds skills/, agents/, commands/ inside it, but we need to
  // filter to the specific plugin name.
  const name = pluginId.slice("local:".length);
  // Some local "plugins" are actually namespaces (local:gsd → ~/.claude/commands/gsd/)
  // or single skills (local:uiux-toolkit → ~/.claude/skills/uiux-toolkit/). We try
  // all three top-level dirs and return a synthetic item list directly.
  const items = [];
  const home = os.homedir();
  const claudeHome = path.join(home, ".claude");

  // 1. Is there a ~/.claude/skills/<name>/SKILL.md? (single-skill local plugin)
  const skillMd = path.join(claudeHome, "skills", name, "SKILL.md");
  if (fs.existsSync(skillMd)) {
    items.push({ kind: "skill", name: readFrontmatterName(skillMd, name) });
  }

  // 2. Is there a ~/.claude/commands/<name>/ directory? (command namespace)
  const cmdNsDir = path.join(claudeHome, "commands", name);
  if (fs.existsSync(cmdNsDir) && fs.statSync(cmdNsDir).isDirectory()) {
    for (const f of fs.readdirSync(cmdNsDir)) {
      if (!f.endsWith(".md")) continue;
      const p = path.join(cmdNsDir, f);
      const fallback = f.slice(0, -3);
      items.push({ kind: "command", name: readFrontmatterName(p, fallback) });
    }
  }

  // 3. Special cases: local:agents (loose agents) and local:commands (loose commands)
  if (name === "agents") {
    const agentsDir = path.join(claudeHome, "agents");
    if (fs.existsSync(agentsDir)) {
      for (const e of fs.readdirSync(agentsDir)) {
        if (!e.endsWith(".md") || e === "README.md") continue;
        const p = path.join(agentsDir, e);
        items.push({ kind: "agent", name: readFrontmatterName(p, e.slice(0, -3)) });
      }
    }
  }
  if (name === "commands") {
    const cmdsDir = path.join(claudeHome, "commands");
    if (fs.existsSync(cmdsDir)) {
      for (const e of fs.readdirSync(cmdsDir)) {
        if (!e.endsWith(".md")) continue;
        const p = path.join(cmdsDir, e);
        items.push({ kind: "command", name: readFrontmatterName(p, e.slice(0, -3)) });
      }
    }
  }

  return { synthetic: true, items };
}

function resolveInstalledPlugin(pluginId) {
  const manifestPath = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
  if (!fs.existsSync(manifestPath)) {
    fail("installed_plugins.json not found at " + manifestPath, pluginId);
  }
  let mf;
  try {
    mf = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (e) {
    fail("Failed to parse installed_plugins.json: " + String(e.message || e), pluginId);
  }
  const installs = mf.plugins?.[pluginId];
  if (!installs || installs.length === 0) {
    fail("Plugin not installed: " + pluginId, pluginId);
  }
  // Prefer user-scoped, fallback to first entry
  const userInstall = installs.find((i) => i.scope === "user") ?? installs[0];
  const installPath = userInstall.installPath;
  if (!installPath || !fs.existsSync(installPath)) {
    fail("installPath missing or does not exist: " + installPath, pluginId);
  }
  return { installPath, installs };
}

// ─── Main ───────────────────────────────────────────────────────────────────

let items;
let installPath = null;

if (pluginId.startsWith("local:")) {
  const result = resolveLocalPluginPath(pluginId);
  items = result.items;
  installPath = "~/.claude (local)";
} else if (pluginId.startsWith("framework:")) {
  // Framework plugins are synthetic wrappers; we don't currently enumerate them here.
  fail(
    "Framework plugin enumeration is not supported by this script. Framework plugins " +
    "are managed by the Electron app's framework-specific logic in core.ts, not by " +
    "standard item scanning. If you need to build an exclude list for a framework " +
    "plugin, consult the app's handling for that specific framework.",
    pluginId,
  );
} else {
  // Marketplace plugin: look up install path from installed_plugins.json
  const resolved = resolveInstalledPlugin(pluginId);
  installPath = resolved.installPath;
  items = scanDir(installPath);
}

// De-duplicate by name (some plugins have items appearing under multiple kinds,
// e.g. a skill and a same-named command; applyExclusions treats them uniformly)
const uniqueNames = [...new Set(items.map((it) => it.name))].sort();

process.stdout.write(
  JSON.stringify({
    ok: true,
    pluginId,
    installPath,
    count: uniqueNames.length,
    items: uniqueNames,
  }) + "\n",
);
