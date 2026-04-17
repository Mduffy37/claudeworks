#!/usr/bin/env node
/**
 * write-team.js
 *
 * Persist a new team entry to ~/.claudeworks/teams.json from the create-team
 * skill's final step. Mirrors write-profile.js: strict validation, atomic
 * write via .tmp + rename, schemaVersion stamp.
 *
 * Every member's `profile` field is validated against the current
 * profiles.json. Exactly one member must have `isLead: true`. If an invariant
 * is violated the script refuses to write, so the Electron app never reads
 * a teams.json in a state it would otherwise crash on.
 *
 * Usage:
 *   T_NAME='my-team' \
 *   T_DESC='Team description (optional)' \
 *   T_MEMBERS='[{"profile":"frontend-dev","role":"UI implementation","instructions":"...","isLead":true},...]' \
 *   T_MODEL='opus' T_OPUS_CTX='1m' T_SONNET_CTX='' T_EFFORT='high' T_CUSTOM_FLAGS='' T_TAGS='[]' \
 *     node write-team.js
 *
 * Output: single-line JSON on stdout.
 *   success: {"ok": true, "name": "my-team", "tmPath": "/Users/.../teams.json"}
 *   failure: {"ok": false, "error": "<reason>"}
 *
 * All T_* env vars except T_NAME and T_MEMBERS are optional. Pass empty
 * string to omit a scalar; pass "[]" to omit tags.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const SCHEMA_VERSION = 1;
const ALLOWED_MODELS = new Set(["opus", "sonnet", "haiku"]);
const ALLOWED_CONTEXTS = new Set(["200k", "1m"]);
const ALLOWED_EFFORTS = new Set(["low", "medium", "high", "max"]);

function fail(error) {
  process.stdout.write(JSON.stringify({ ok: false, error }) + "\n");
  process.exit(1);
}

// 1. Validate T_NAME — mirrors core.ts:validateProfileName (same invariants
//    apply to teams because they occupy the same namespace/disk layout).
const name = process.env.T_NAME;
if (!name || typeof name !== "string" || name.trim() === "") {
  fail("T_NAME is not set or empty. Set the T_NAME environment variable before running this command.");
}
if (
  name.indexOf("/") >= 0 ||
  name.indexOf("\\") >= 0 ||
  name.indexOf("..") >= 0 ||
  name.indexOf(String.fromCharCode(0)) >= 0
) {
  fail(`T_NAME "${name}" contains invalid characters. Team names must not contain path separators, "..", or null bytes.`);
}

const profilesDir = path.join(os.homedir(), ".claudeworks");
const tmPath = path.join(profilesDir, "teams.json");
const pfPath = path.join(profilesDir, "profiles.json");

// 2. Parse T_MEMBERS — required, array of TeamMember objects.
let members;
try {
  members = JSON.parse(process.env.T_MEMBERS || "[]");
  if (!Array.isArray(members)) throw new Error("T_MEMBERS must be a JSON array");
  if (members.length === 0) throw new Error("T_MEMBERS cannot be empty — a team needs at least one member");
  for (const m of members) {
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      throw new Error("Each T_MEMBERS entry must be an object");
    }
    if (typeof m.profile !== "string" || m.profile.trim() === "") {
      throw new Error("Each T_MEMBERS entry needs a non-empty string 'profile'");
    }
    if (typeof m.role !== "string") {
      throw new Error(`T_MEMBERS entry for profile "${m.profile}" needs a string 'role' (may be empty)`);
    }
    if (typeof m.instructions !== "string") {
      throw new Error(`T_MEMBERS entry for profile "${m.profile}" needs a string 'instructions' (may be empty)`);
    }
    if (typeof m.isLead !== "boolean") {
      throw new Error(`T_MEMBERS entry for profile "${m.profile}" needs a boolean 'isLead'`);
    }
  }
  const leadCount = members.filter((m) => m.isLead).length;
  if (leadCount !== 1) {
    throw new Error(`Exactly one member must have isLead: true (got ${leadCount}).`);
  }
} catch (e) {
  fail("Failed to parse T_MEMBERS: " + String(e.message || e));
}

// 3. Validate every member's profile reference exists.
let profilesStore = { profiles: {} };
if (fs.existsSync(pfPath)) {
  try {
    profilesStore = JSON.parse(fs.readFileSync(pfPath, "utf-8"));
  } catch (e) {
    fail("Failed to read profiles.json (team members reference it): " + String(e.message || e));
  }
}
for (const m of members) {
  if (!profilesStore.profiles || !profilesStore.profiles[m.profile]) {
    fail(
      `Team member references profile "${m.profile}" which does not exist in profiles.json. ` +
      `Create the profile via /create-profile first, or remove this member from T_MEMBERS.`,
    );
  }
}

// 4. Parse optional scalar fields.
const model = (process.env.T_MODEL || "").trim();
if (model && !ALLOWED_MODELS.has(model)) {
  fail(`T_MODEL must be one of: ${Array.from(ALLOWED_MODELS).join(", ")}, or empty. Got "${model}".`);
}

const opusContext = (process.env.T_OPUS_CTX || "").trim();
if (opusContext && !ALLOWED_CONTEXTS.has(opusContext)) {
  fail(`T_OPUS_CTX must be one of: ${Array.from(ALLOWED_CONTEXTS).join(", ")}, or empty. Got "${opusContext}".`);
}

const sonnetContext = (process.env.T_SONNET_CTX || "").trim();
if (sonnetContext && !ALLOWED_CONTEXTS.has(sonnetContext)) {
  fail(`T_SONNET_CTX must be one of: ${Array.from(ALLOWED_CONTEXTS).join(", ")}, or empty. Got "${sonnetContext}".`);
}

const effortLevel = (process.env.T_EFFORT || "").trim();
if (effortLevel && !ALLOWED_EFFORTS.has(effortLevel)) {
  fail(`T_EFFORT must be one of: ${Array.from(ALLOWED_EFFORTS).join(", ")}, or empty. Got "${effortLevel}".`);
}

// 5. Parse optional array fields.
let tags;
try {
  tags = JSON.parse(process.env.T_TAGS || "[]");
  if (!Array.isArray(tags)) throw new Error("T_TAGS must be a JSON array");
  for (const t of tags) {
    if (typeof t !== "string") throw new Error(`T_TAGS entries must be strings, got ${JSON.stringify(t)}`);
  }
} catch (e) {
  fail("Failed to parse T_TAGS: " + String(e.message || e));
}

// 6. Read existing teams store (or start fresh).
let store;
try {
  store = fs.existsSync(tmPath)
    ? JSON.parse(fs.readFileSync(tmPath, "utf-8"))
    : { teams: {} };
} catch (e) {
  fail("Failed to read existing teams.json: " + String(e.message || e));
}
if (!store || typeof store !== "object") store = { teams: {} };
if (!store.teams || typeof store.teams !== "object") store.teams = {};

// 7. Build the team entry.
const team = {
  name,
  description: process.env.T_DESC || "",
  members,
};
if (model) team.model = model;
if (opusContext) team.opusContext = opusContext;
if (sonnetContext) team.sonnetContext = sonnetContext;
if (effortLevel) team.effortLevel = effortLevel;
const customFlags = (process.env.T_CUSTOM_FLAGS || "").trim();
if (customFlags) team.customFlags = customFlags;
if (tags.length > 0) team.tags = tags;

store.teams[name] = team;
store.schemaVersion = SCHEMA_VERSION;

// 8. Atomic write via tmp file + rename.
try {
  if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
  const tmp = tmPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
  fs.renameSync(tmp, tmPath);
} catch (e) {
  fail("Failed to write teams.json: " + String(e.message || e));
}

process.stdout.write(JSON.stringify({ ok: true, name, tmPath }) + "\n");
