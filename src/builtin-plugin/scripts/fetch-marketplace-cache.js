#!/usr/bin/env node
/**
 * fetch-marketplace-cache.js
 *
 * Populate the marketplace cache at ~/.claudeworks/marketplace-cache/ with
 * fresh catalog.json and items.ndjson from the claudeworks-marketplace repo.
 * Used by the create-profile and suggest-plugins skills as Step 1c.
 *
 * Usage:  node fetch-marketplace-cache.js
 * Output: single-line JSON on stdout with fetch results per file.
 *
 * Fallback chain for each file:
 *   1. Cache hit (24h TTL)
 *   2. HTTPS fetch to api.github.com with auth discovered from
 *      GITHUB_TOKEN / GH_TOKEN env vars or `gh auth token` CLI
 *   3. Sibling repo at $CLAUDEWORKS_MARKETPLACE_DIR (dev escape hatch)
 *   4. UNAVAILABLE — the caller should surface an actionable error
 *
 * Never throws to the caller; failures surface as per-file status strings.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const cacheDir = path.join(os.homedir(), ".claudeworks", "marketplace-cache");
fs.mkdirSync(cacheDir, { recursive: true });

const FILES = ["catalog.json", "items.ndjson"];
const TTL_MS = 24 * 60 * 60 * 1000;
const REPO = "Mduffy37/claudeworks-marketplace";

// Discover an auth token once from env, then from the gh CLI.
// Anonymous HTTPS fetch works for public repos but fails on private ones.
let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
if (!token) {
  try {
    token = cp
      .execFileSync("gh", ["auth", "token"], {
        stdio: ["ignore", "pipe", "ignore"],
      })
      .toString()
      .trim();
  } catch {
    token = null;
  }
}

async function fetchFile(name) {
  const dest = path.join(cacheDir, name);

  // 1. Cache hit.
  try {
    const stat = fs.statSync(dest);
    if (Date.now() - stat.mtimeMs < TTL_MS) return "cache-hit";
  } catch {
    /* cache miss */
  }

  // 2. HTTPS fetch against api.github.com with the raw media type so the
  //    response body is the file contents, not a JSON envelope.
  try {
    const headers = {
      Accept: "application/vnd.github.raw",
      "User-Agent": "claudeworks-recommender",
    };
    if (token) headers["Authorization"] = "Bearer " + token;

    const url =
      "https://api.github.com/repos/" + REPO + "/contents/" + name;
    const resp = await fetch(url, { headers });

    if (resp.ok) {
      const text = await resp.text();
      fs.writeFileSync(dest, text);
      return token ? "fetched-auth" : "fetched-anon";
    }
  } catch {
    /* fetch failed */
  }

  // 3. Sibling repo escape hatch (dev mode, opt-in via env var only).
  const siblingDir = process.env.CLAUDEWORKS_MARKETPLACE_DIR;
  if (siblingDir) {
    try {
      const src = path.join(siblingDir, name);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        return "sibling-fallback";
      }
    } catch {
      /* sibling fallback failed */
    }
  }

  return "UNAVAILABLE";
}

(async () => {
  const files = {};
  for (const name of FILES) {
    files[name] = await fetchFile(name);
  }
  process.stdout.write(JSON.stringify({ cacheDir, files }) + "\n");
})();
