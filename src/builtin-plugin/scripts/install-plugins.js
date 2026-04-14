#!/usr/bin/env node
/**
 * install-plugins.js
 *
 * Install one or more missing Claude Code plugins using the same CLI
 * commands the Claude Profiles Electron app uses internally. Invoked by
 * create-profile Step 7.5 (and by suggest-plugins when the user opts in
 * to install a non-installed pick).
 *
 * Usage:
 *   MISSING_PLUGINS='[{"id":"name@mkt","marketplaceId":"mkt","sourceUrl":"https://github.com/owner/repo"}]' \
 *     node install-plugins.js
 *
 * Output: single-line JSON on stdout with one result per plugin.
 *
 * Two load-bearing details that mirror src/electron/core.ts exactly:
 *
 *   1. Resolves the real `claude` binary by walking PATH and SKIPPING
 *      ~/.claude-profiles/bin. That directory contains alias scripts
 *      (including claude-default) that intentionally intercept bare
 *      `claude` invocations and hardcode their own CLAUDE_CONFIG_DIR
 *      inline on the command line. If we went through PATH, the alias
 *      would win and plugins would install into the wrong config dir.
 *      See core.ts:findRealClaudeBinary for the original.
 *
 *   2. Forces CLAUDE_CONFIG_DIR=$HOME/.claude on the subprocess env so
 *      installs land in the central shared location, not whatever
 *      profile-scoped config dir the parent session happens to have.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

function resolveRealClaude() {
  const profilesBin = path.join(os.homedir(), ".claude-profiles", "bin");
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    try {
      if (path.resolve(dir) === profilesBin) continue;
      const candidate = path.join(dir, "claude");
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function loadKnownMarketplaces(claudeHome) {
  try {
    const p = path.join(claudeHome, "plugins", "known_marketplaces.json");
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function ownerRepoFromSourceUrl(url) {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!m) return null;
  return m[1].replace(/\.git$/, "").replace(/\/$/, "");
}

const realClaude = resolveRealClaude();
if (!realClaude) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error:
        "Real claude binary not found in PATH outside ~/.claude-profiles/bin. Is Claude Code installed?",
      results: [],
    }) + "\n",
  );
  process.exit(0);
}

const claudeHome = path.join(os.homedir(), ".claude");
const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeHome };

let plugins;
try {
  plugins = JSON.parse(process.env.MISSING_PLUGINS || "[]");
} catch (e) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: "Failed to parse MISSING_PLUGINS env var: " + String(e.message || e),
      results: [],
    }) + "\n",
  );
  process.exit(0);
}

const known = loadKnownMarketplaces(claudeHome);
const results = [];

for (const p of plugins) {
  try {
    if (!p.id) throw new Error("Plugin entry missing 'id' field");

    // Add the marketplace if not already known.
    if (!known[p.marketplaceId] && p.sourceUrl) {
      const source = ownerRepoFromSourceUrl(p.sourceUrl);
      if (!source) {
        throw new Error(
          "Could not parse owner/repo from sourceUrl: " + p.sourceUrl,
        );
      }
      cp.execFileSync(
        realClaude,
        ["plugin", "marketplace", "add", source],
        { env, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 },
      );
      known[p.marketplaceId] = { source };
    }

    // Install the plugin.
    cp.execFileSync(
      realClaude,
      ["plugin", "install", p.id],
      { env, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 },
    );
    results.push({ id: p.id, ok: true });
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300);
    results.push({ id: p.id, ok: false, error: msg });
  }
}

process.stdout.write(
  JSON.stringify({ ok: true, realClaude, results }) + "\n",
);
