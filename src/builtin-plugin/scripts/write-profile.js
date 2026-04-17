#!/usr/bin/env node
/**
 * write-profile.js
 *
 * Persist a new profile entry to ~/.claudeworks/profiles.json from the
 * create-profile skill's Step 8. Mirrors the validation and write semantics
 * of src/electron/core.ts (validateProfileName + writeProfilesStore) so the
 * skill cannot leave the store in a state the Electron app refuses to read.
 *
 * Usage:
 *   P_NAME='my-profile' \
 *   P_PLUGINS='["a@mkt","b@mkt"]' \
 *   P_EXCLUDED='{}' \
 *   P_DESC='A profile for foo' \
 *   P_MODEL='' P_EFFORT='' P_INSTRUCTIONS='' P_WORKFLOW='' \
 *   P_WORKFLOWS='[{"name":"debug","body":"..."},{"name":"deploy","body":"..."}]' \
 *   P_ALIASES='[{"name":"bug","launchAction":"workflow","directory":"/path"}]' \
 *     node write-profile.js
 *
 *   P_WORKFLOWS (optional) — named workflow variants. Each object has
 *     `name` (slug used in `/workflow-<name>`), `body` (markdown), and an
 *     optional `directory` filter. Persists to `profile.workflows[]`.
 *   P_ALIASES (optional) — named alias launch entries. Each object has
 *     `name` (command name in PATH), optional `directory`, optional
 *     `launchAction` ("workflow" | "prompt"), optional `launchPrompt`
 *     (used when launchAction === "prompt"). Persists to `profile.aliases[]`.
 *
 * Output: single-line JSON on stdout.
 *   success: {"ok": true, "name": "my-profile", "pfPath": "/Users/.../profiles.json"}
 *   failure: {"ok": false, "error": "<reason>"}
 *
 * Why this is a separate script instead of inline `node -e` in SKILL.md:
 *
 *   The prior inline version read `process.env.P_NAME` directly and used the
 *   result as the store key without checking for undefined. When Claude ran
 *   the skill and forgot to set P_NAME (or hit an earlier error and fell
 *   through to the write step), the store got `store.profiles[undefined] =
 *   partialProfile`, which JSON-stringified to a literal "undefined" key.
 *   The Electron app's loadProfiles() then crashed on `p.name.startsWith(...)`,
 *   which left the app hanging at "loading plugins". This helper refuses to
 *   write at all if P_NAME is missing or invalid, matching the guarantees
 *   the Electron IPC path already provides via validateProfileName.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

function fail(error) {
  process.stdout.write(JSON.stringify({ ok: false, error }) + "\n");
  process.exit(1);
}

// 1. Validate P_NAME — mirrors core.ts:validateProfileName.
const name = process.env.P_NAME;
if (!name || typeof name !== "string" || name.trim() === "") {
  fail(
    "P_NAME is not set or empty. Set the P_NAME environment variable before running this command.",
  );
}
if (
  name.indexOf("/") >= 0 ||
  name.indexOf("\\") >= 0 ||
  name.indexOf("..") >= 0 ||
  name.indexOf(String.fromCharCode(0)) >= 0
) {
  fail(
    `P_NAME "${name}" contains invalid characters. Profile names must not contain path separators, "..", or null bytes.`,
  );
}

const profilesDir = path.join(os.homedir(), ".claudeworks");
const pfPath = path.join(profilesDir, "profiles.json");

// 2. Defence-in-depth: ensure the name resolves to a path inside profilesDir.
const resolved = path.resolve(profilesDir, name);
if (!resolved.startsWith(profilesDir + path.sep)) {
  fail(`P_NAME "${name}" resolves outside the profiles directory.`);
}

// 3. Parse JSON env vars up-front so a malformed value fails cleanly.
let plugins;
try {
  plugins = JSON.parse(process.env.P_PLUGINS || "[]");
  if (!Array.isArray(plugins)) throw new Error("P_PLUGINS must be a JSON array");
} catch (e) {
  fail("Failed to parse P_PLUGINS: " + String(e.message || e));
}

let excludedItems;
try {
  excludedItems = JSON.parse(process.env.P_EXCLUDED || "{}");
  if (excludedItems === null || typeof excludedItems !== "object" || Array.isArray(excludedItems)) {
    throw new Error("P_EXCLUDED must be a JSON object");
  }
  // Each value must be a flat array of strings. applyExclusions() in
  // core.ts treats excludedNames as `string[]` and calls
  // `excludedNames.includes(item.name)` — so a nested object like
  // `{skills:[], agents:[], commands:[]}` (which earlier SKILL.md docs
  // incorrectly suggested) would silently no-op. Catch that here with
  // a loud error so the skill can't generate a broken profile.
  for (const [pluginId, value] of Object.entries(excludedItems)) {
    if (!Array.isArray(value)) {
      throw new Error(
        `excludedItems["${pluginId}"] must be a flat array of item-name strings, ` +
        `not ${value === null ? "null" : typeof value}. ` +
        `Example: {"${pluginId}": ["skill-a", "skill-b"]}. ` +
        `If you were using the nested {skills:[], agents:[], commands:[]} format, ` +
        `that's out of date — applyExclusions in core.ts reads a flat list of bare ` +
        `item names and filters all kinds (skills, agents, commands) against the same set.`,
      );
    }
    for (const entry of value) {
      if (typeof entry !== "string") {
        throw new Error(
          `excludedItems["${pluginId}"] contains a non-string value: ${JSON.stringify(entry)}. ` +
          `Every entry must be a bare item name (string). ` +
          `Example: {"${pluginId}": ["skill-a", "skill-b"]}.`,
        );
      }
    }
  }
} catch (e) {
  fail("Failed to parse P_EXCLUDED: " + String(e.message || e));
}

// 4. Read existing store (or start fresh if missing / unreadable).
let store;
try {
  store = fs.existsSync(pfPath)
    ? JSON.parse(fs.readFileSync(pfPath, "utf-8"))
    : { profiles: {} };
} catch (e) {
  fail("Failed to read existing profiles.json: " + String(e.message || e));
}
if (!store || typeof store !== "object") store = { profiles: {} };
if (!store.profiles || typeof store.profiles !== "object") store.profiles = {};

// 5. Parse P_DISABLED_MCP — optional, same shape as disabledMcpServers in the Profile type.
//    Keys are directory paths (for project-scoped MCPs) or "__user__" (for global MCPs).
//    Values are arrays of MCP server names to disable for this profile.
let disabledMcpServers;
try {
  disabledMcpServers = JSON.parse(process.env.P_DISABLED_MCP || "{}");
  if (disabledMcpServers === null || typeof disabledMcpServers !== "object" || Array.isArray(disabledMcpServers)) {
    throw new Error("P_DISABLED_MCP must be a JSON object");
  }
  for (const [key, value] of Object.entries(disabledMcpServers)) {
    if (!Array.isArray(value)) {
      throw new Error(`disabledMcpServers["${key}"] must be an array of server name strings`);
    }
  }
} catch (e) {
  fail("Failed to parse P_DISABLED_MCP: " + String(e.message || e));
}

// 6. Parse P_WORKFLOWS — optional, array of `{name, body, directory?}`.
//    Corresponds to Profile.workflows in types.ts. Each entry becomes a
//    slash command `/workflow-<name>` written to <config-dir>/commands/.
let workflows;
try {
  workflows = JSON.parse(process.env.P_WORKFLOWS || "[]");
  if (!Array.isArray(workflows)) throw new Error("P_WORKFLOWS must be a JSON array");
  for (const w of workflows) {
    if (!w || typeof w !== "object" || Array.isArray(w)) {
      throw new Error("Each P_WORKFLOWS entry must be an object");
    }
    if (typeof w.name !== "string" || w.name.trim() === "") {
      throw new Error("Each P_WORKFLOWS entry needs a non-empty string 'name'");
    }
    if (typeof w.body !== "string") {
      throw new Error(`P_WORKFLOWS entry "${w.name}" needs a string 'body'`);
    }
    if (w.directory !== undefined && typeof w.directory !== "string") {
      throw new Error(`P_WORKFLOWS entry "${w.name}" has a non-string 'directory'`);
    }
  }
} catch (e) {
  fail("Failed to parse P_WORKFLOWS: " + String(e.message || e));
}

// 7. Parse P_ALIASES — optional, array of ProfileAlias objects.
//    Each alias generates a shell script under ~/.claudeworks/bin/.
let aliases;
try {
  aliases = JSON.parse(process.env.P_ALIASES || "[]");
  if (!Array.isArray(aliases)) throw new Error("P_ALIASES must be a JSON array");
  const ALLOWED_LAUNCH_ACTIONS = new Set(["workflow", "prompt"]);
  for (const a of aliases) {
    if (!a || typeof a !== "object" || Array.isArray(a)) {
      throw new Error("Each P_ALIASES entry must be an object");
    }
    if (typeof a.name !== "string" || a.name.trim() === "") {
      throw new Error("Each P_ALIASES entry needs a non-empty string 'name'");
    }
    // Alias names become filenames in ~/.claudeworks/bin/. Unrestricted
    // names ("../.zshrc", "foo/bar") let a malicious write overwrite files
    // outside that directory; the shell also sources .zshrc on login. Mirror
    // the safe-slug check in src/electron/launch.ts:isSafeAliasName.
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(a.name) || a.name.includes("..")) {
      throw new Error(
        `P_ALIASES entry "${a.name}" has an unsafe name. ` +
        `Aliases must be 1–64 chars, start with a letter or digit, and use only letters, digits, underscore, dot, or hyphen.`,
      );
    }
    if (a.directory !== undefined && typeof a.directory !== "string") {
      throw new Error(`P_ALIASES entry "${a.name}" has a non-string 'directory'`);
    }
    if (a.launchAction !== undefined && !ALLOWED_LAUNCH_ACTIONS.has(a.launchAction)) {
      throw new Error(
        `P_ALIASES entry "${a.name}" has invalid launchAction "${a.launchAction}". ` +
        `Must be one of: ${Array.from(ALLOWED_LAUNCH_ACTIONS).join(", ")}.`,
      );
    }
    if (a.launchPrompt !== undefined && typeof a.launchPrompt !== "string") {
      throw new Error(`P_ALIASES entry "${a.name}" has a non-string 'launchPrompt'`);
    }
  }
} catch (e) {
  fail("Failed to parse P_ALIASES: " + String(e.message || e));
}

// 8. Build the profile entry. Keep the shape identical to what core.ts writes.
const profile = {
  name,
  plugins,
  excludedItems,
  description: process.env.P_DESC || "",
  model: process.env.P_MODEL || undefined,
  effortLevel: process.env.P_EFFORT || undefined,
  customClaudeMd: process.env.P_INSTRUCTIONS || "",
  workflow: process.env.P_WORKFLOW || undefined,
  workflows: workflows.length > 0 ? workflows : undefined,
  aliases: aliases.length > 0 ? aliases : undefined,
  tools: process.env.P_TOOLS || undefined,
  disabledMcpServers: Object.keys(disabledMcpServers).length > 0 ? disabledMcpServers : undefined,
  useDefaultAuth: true,
};
store.profiles[name] = profile;

// 9. Atomic write via tmp file + rename — same pattern as core.ts:writeProfilesStore.
//    Guards against leaving a half-written profiles.json if the process is
//    interrupted between the truncate and the final flush.
try {
  if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
  const tmp = pfPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
  fs.renameSync(tmp, pfPath);
} catch (e) {
  fail("Failed to write profiles.json: " + String(e.message || e));
}

process.stdout.write(JSON.stringify({ ok: true, name, pfPath }) + "\n");
