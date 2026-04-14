#!/usr/bin/env node
/**
 * write-profile.js
 *
 * Persist a new profile entry to ~/.claude-profiles/profiles.json from the
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
 *     node write-profile.js
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

const profilesDir = path.join(os.homedir(), ".claude-profiles");
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

// 5. Build the profile entry. Keep the shape identical to what core.ts writes.
const profile = {
  name,
  plugins,
  excludedItems,
  description: process.env.P_DESC || "",
  model: process.env.P_MODEL || undefined,
  effortLevel: process.env.P_EFFORT || undefined,
  customClaudeMd: process.env.P_INSTRUCTIONS || "",
  workflow: process.env.P_WORKFLOW || undefined,
  useDefaultAuth: true,
};
store.profiles[name] = profile;

// 6. Atomic write via tmp file + rename — same pattern as core.ts:writeProfilesStore.
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
