#!/usr/bin/env node
/**
 * patch-profile.js
 *
 * Targeted partial-update writer for `~/.claudeworks/profiles.json`.
 * Companion to `write-profile.js` (which creates a profile from scratch):
 * this script reads an existing profile, mutates one field, and writes
 * the store back atomically. It exists so the `suggest-plugins` and
 * `create-workflow` skills can edit profiles without having to rebuild
 * every field from environment variables — and so schema invariants
 * (plugin list dedupe, `excludedItems` shape, name validation, atomic
 * write) live in one place instead of being re-implemented in every
 * caller's inline `node -e` block.
 *
 * Operations (set P_OP):
 *
 *   add-plugins
 *     P_NAME='ux-review' P_OP=add-plugins P_VALUE='["a@mkt","local:b"]'
 *     Appends plugin IDs to `profile.plugins[]`, deduping against the
 *     existing list. No-ops on any ID already present.
 *
 *   remove-plugins
 *     P_NAME='ux-review' P_OP=remove-plugins P_VALUE='["a@mkt"]'
 *     Removes plugin IDs from `profile.plugins[]` and also drops any
 *     matching `excludedItems` entries so the store doesn't accumulate
 *     orphan exclusions.
 *
 *   set-field
 *     P_NAME='ux-review' P_OP=set-field P_FIELD=model P_VALUE='claude-sonnet-4-6'
 *     P_NAME='ux-review' P_OP=set-field P_FIELD=workflow P_VALUE='<body>'
 *     Sets a single scalar/text field on the profile. Allowed fields
 *     below (ALLOWED_SET_FIELDS). Pass an empty string to clear a field;
 *     pass the literal string "undefined" via P_VALUE to unset it.
 *
 *   set-excluded
 *     P_NAME='ux-review' P_OP=set-excluded P_PLUGIN='mega@mkt' P_VALUE='["skill-a","skill-b"]'
 *     Replaces `profile.excludedItems[pluginId]` with the given flat
 *     string array. Pass an empty array to clear exclusions for that
 *     plugin. The plugin must already be present in `profile.plugins[]`
 *     — excluding items on a plugin the profile doesn't include is a
 *     caller bug, not a silent no-op.
 *
 * Common constraints (mirror write-profile.js):
 *
 *   - P_NAME must be a non-empty string with no path separators, no
 *     "..", and no null bytes. The name must already exist in
 *     profiles.json — this script patches, it does not create.
 *   - excludedItems values must be flat string arrays. The nested
 *     {skills:[],agents:[],commands:[]} shape is rejected loudly
 *     because applyExclusions() in core.ts reads a flat list.
 *   - Writes are atomic via tmp file + rename.
 *
 * Output: single-line JSON on stdout.
 *   success: {"ok": true, "name": "...", "op": "...", "pfPath": "..."}
 *   failure: {"ok": false, "error": "<reason>"}
 *
 * The exit code is 0 on success, 1 on any error — callers should read
 * `ok` from the JSON rather than relying on exit codes alone (matches
 * the convention write-profile.js already uses).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const ALLOWED_OPS = new Set(["add-plugins", "remove-plugins", "set-field", "set-excluded"]);

// Fields that `set-field` is allowed to touch. Anything outside this set
// should go through the full-profile write path (write-profile.js) so we
// don't accidentally let a skill stomp on structural fields like `plugins`
// or `excludedItems` — those have their own dedicated ops.
const ALLOWED_SET_FIELDS = new Set([
  "description",
  "model",
  "effortLevel",
  "customClaudeMd",
  "workflow",
  "workflows",
  "tools",
  "aliases",
  "targetDirectory",
  "tags",
  "launchFlags",
  "useDefaultAuth",
]);

function fail(error) {
  process.stdout.write(JSON.stringify({ ok: false, error }) + "\n");
  process.exit(1);
}

function validateName(name) {
  if (!name || typeof name !== "string" || name.trim() === "") {
    fail("P_NAME is not set or empty. Set the P_NAME environment variable before running this command.");
  }
  if (
    name.indexOf("/") >= 0 ||
    name.indexOf("\\") >= 0 ||
    name.indexOf("..") >= 0 ||
    name.indexOf(String.fromCharCode(0)) >= 0
  ) {
    fail(`P_NAME "${name}" contains invalid characters. Profile names must not contain path separators, "..", or null bytes.`);
  }
}

function validateExcludedArray(pluginId, value) {
  // Mirrors write-profile.js's validation: each excludedItems value must
  // be a flat array of strings. The nested {skills:[],agents:[],commands:[]}
  // shape is wrong because applyExclusions() in core.ts reads a flat list.
  if (!Array.isArray(value)) {
    fail(
      `excludedItems["${pluginId}"] must be a flat array of item-name strings, not ${value === null ? "null" : typeof value}. ` +
      `Example: {"${pluginId}": ["skill-a", "skill-b"]}. ` +
      `If you were using the nested {skills:[], agents:[], commands:[]} format, that's out of date — applyExclusions in core.ts reads a flat list of bare item names.`,
    );
  }
  for (const entry of value) {
    if (typeof entry !== "string") {
      fail(
        `excludedItems["${pluginId}"] contains a non-string value: ${JSON.stringify(entry)}. ` +
        `Every entry must be a bare item name (string).`,
      );
    }
  }
}

function parseJsonEnv(varName, fallback) {
  const raw = process.env[varName];
  if (raw === undefined || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`Failed to parse ${varName} as JSON: ${String(e.message || e)}`);
  }
}

// 1. Validate op + name.
const op = process.env.P_OP;
if (!op || !ALLOWED_OPS.has(op)) {
  fail(`P_OP is missing or invalid. Set one of: ${Array.from(ALLOWED_OPS).join(", ")}`);
}
const name = process.env.P_NAME;
validateName(name);

// 2. Read existing store. patch-profile.js refuses to run if either the
//    store or the target profile is missing — creating from scratch is
//    write-profile.js's job, and a silent create here would mask caller
//    bugs (e.g. typo'd profile name).
const profilesDir = path.join(os.homedir(), ".claudeworks");
const pfPath = path.join(profilesDir, "profiles.json");
if (!fs.existsSync(pfPath)) {
  fail(`profiles.json does not exist at ${pfPath}. patch-profile.js patches existing profiles; use write-profile.js to create new ones.`);
}
let store;
try {
  store = JSON.parse(fs.readFileSync(pfPath, "utf-8"));
} catch (e) {
  fail("Failed to read profiles.json: " + String(e.message || e));
}
if (!store || typeof store !== "object" || !store.profiles || typeof store.profiles !== "object") {
  fail("profiles.json has an unexpected shape — expected {profiles: {...}}");
}
const profile = store.profiles[name];
if (!profile || typeof profile !== "object") {
  const existing = Object.keys(store.profiles).join(", ") || "(none)";
  fail(`Profile "${name}" does not exist. Existing profiles: ${existing}`);
}

// 3. Apply the operation.
if (op === "add-plugins") {
  const toAdd = parseJsonEnv("P_VALUE", []);
  if (!Array.isArray(toAdd)) fail("P_VALUE must be a JSON array of plugin IDs for add-plugins");
  for (const id of toAdd) {
    if (typeof id !== "string" || id.length === 0) {
      fail(`add-plugins: plugin ID must be a non-empty string, got ${JSON.stringify(id)}`);
    }
  }
  const current = Array.isArray(profile.plugins) ? profile.plugins.slice() : [];
  const currentSet = new Set(current);
  const added = [];
  for (const id of toAdd) {
    if (!currentSet.has(id)) {
      current.push(id);
      currentSet.add(id);
      added.push(id);
    }
  }
  profile.plugins = current;
  // Report which IDs were newly added vs already present so the caller
  // can surface an accurate summary to the user.
  profile.__patchAdded = added;
} else if (op === "remove-plugins") {
  const toRemove = parseJsonEnv("P_VALUE", []);
  if (!Array.isArray(toRemove)) fail("P_VALUE must be a JSON array of plugin IDs for remove-plugins");
  const removeSet = new Set(toRemove);
  const before = Array.isArray(profile.plugins) ? profile.plugins.slice() : [];
  const after = before.filter((id) => !removeSet.has(id));
  const removed = before.filter((id) => removeSet.has(id));
  profile.plugins = after;
  // Drop any excludedItems entries for plugins that no longer exist in
  // the list — otherwise the store accumulates orphan exclusions that
  // confuse future reads.
  if (profile.excludedItems && typeof profile.excludedItems === "object") {
    for (const pid of Object.keys(profile.excludedItems)) {
      if (removeSet.has(pid)) delete profile.excludedItems[pid];
    }
  }
  profile.__patchRemoved = removed;
} else if (op === "set-field") {
  const field = process.env.P_FIELD;
  if (!field || !ALLOWED_SET_FIELDS.has(field)) {
    fail(`P_FIELD is missing or not in the allowed set. Allowed: ${Array.from(ALLOWED_SET_FIELDS).join(", ")}. For plugins[] or excludedItems[], use the dedicated ops instead.`);
  }
  const rawValue = process.env.P_VALUE;
  if (rawValue === undefined) {
    fail("P_VALUE is not set. Pass an empty string to clear a text field, or the literal 'undefined' to unset an optional field.");
  }
  // Boolean fields: accept "true"/"false" strings so the caller doesn't
  // have to JSON-encode a bare boolean.
  if (field === "useDefaultAuth") {
    if (rawValue === "true") profile[field] = true;
    else if (rawValue === "false") profile[field] = false;
    else fail(`set-field useDefaultAuth: P_VALUE must be 'true' or 'false', got ${JSON.stringify(rawValue)}`);
  } else if (field === "tags" || field === "launchFlags") {
    // Array fields come through as JSON strings.
    let parsed;
    try { parsed = JSON.parse(rawValue); } catch (e) {
      fail(`set-field ${field}: P_VALUE must be a JSON array, got ${JSON.stringify(rawValue)}`);
    }
    if (!Array.isArray(parsed)) fail(`set-field ${field}: P_VALUE must decode to a JSON array`);
    for (const entry of parsed) {
      if (typeof entry !== "string") fail(`set-field ${field}: every entry must be a string`);
    }
    profile[field] = parsed;
  } else if (field === "workflows" || field === "aliases") {
    // Array-of-objects fields. Pass "[]" to clear.
    let parsed;
    try { parsed = JSON.parse(rawValue); } catch (e) {
      fail(`set-field ${field}: P_VALUE must be a JSON array, got ${JSON.stringify(rawValue)}`);
    }
    if (!Array.isArray(parsed)) fail(`set-field ${field}: P_VALUE must decode to a JSON array`);
    if (field === "workflows") {
      for (const w of parsed) {
        if (!w || typeof w !== "object" || Array.isArray(w)) fail(`set-field workflows: each entry must be an object`);
        if (typeof w.name !== "string" || w.name.trim() === "") fail(`set-field workflows: each entry needs a non-empty string 'name'`);
        if (typeof w.body !== "string") fail(`set-field workflows: entry "${w.name}" needs a string 'body'`);
        if (w.directory !== undefined && typeof w.directory !== "string") fail(`set-field workflows: entry "${w.name}" has a non-string 'directory'`);
      }
    } else {
      const ALLOWED = new Set(["workflow", "prompt"]);
      for (const a of parsed) {
        if (!a || typeof a !== "object" || Array.isArray(a)) fail(`set-field aliases: each entry must be an object`);
        if (typeof a.name !== "string" || a.name.trim() === "") fail(`set-field aliases: each entry needs a non-empty string 'name'`);
        if (a.directory !== undefined && typeof a.directory !== "string") fail(`set-field aliases: entry "${a.name}" has a non-string 'directory'`);
        if (a.launchAction !== undefined && !ALLOWED.has(a.launchAction)) fail(`set-field aliases: entry "${a.name}" has invalid launchAction "${a.launchAction}" (must be "workflow" or "prompt")`);
        if (a.launchPrompt !== undefined && typeof a.launchPrompt !== "string") fail(`set-field aliases: entry "${a.name}" has a non-string 'launchPrompt'`);
      }
    }
    if (parsed.length === 0) delete profile[field];
    else profile[field] = parsed;
  } else if (rawValue === "undefined") {
    // Explicit unset path for optional fields (model, effortLevel, etc.).
    delete profile[field];
  } else {
    profile[field] = rawValue;
  }
} else if (op === "set-excluded") {
  const pluginId = process.env.P_PLUGIN;
  if (!pluginId || typeof pluginId !== "string") {
    fail("set-excluded: P_PLUGIN must be set to the plugin ID whose exclusions you're updating.");
  }
  const currentPlugins = Array.isArray(profile.plugins) ? profile.plugins : [];
  if (!currentPlugins.includes(pluginId)) {
    fail(`set-excluded: plugin "${pluginId}" is not in profile "${name}". Add it with add-plugins first, or check for a typo.`);
  }
  const value = parseJsonEnv("P_VALUE", []);
  validateExcludedArray(pluginId, value);
  if (!profile.excludedItems || typeof profile.excludedItems !== "object") profile.excludedItems = {};
  if (value.length === 0) {
    delete profile.excludedItems[pluginId];
  } else {
    profile.excludedItems[pluginId] = value;
  }
}

// 4. Strip transient __patch* fields before write — they exist only for
//    the success-output below.
const patchAdded = profile.__patchAdded;
const patchRemoved = profile.__patchRemoved;
delete profile.__patchAdded;
delete profile.__patchRemoved;

// 5. Atomic write via tmp file + rename (same pattern as write-profile.js
//    and core.ts:writeProfilesStore).
try {
  if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
  const tmp = pfPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
  fs.renameSync(tmp, pfPath);
} catch (e) {
  fail("Failed to write profiles.json: " + String(e.message || e));
}

const result = { ok: true, name, op, pfPath };
if (patchAdded !== undefined) result.added = patchAdded;
if (patchRemoved !== undefined) result.removed = patchRemoved;
process.stdout.write(JSON.stringify(result) + "\n");
