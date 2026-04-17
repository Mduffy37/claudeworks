#!/usr/bin/env node
/**
 * retrieve-plugins.js
 *
 * One-shot retrieval pass used by `create-profile` (Layer 2) and
 * `suggest-plugins`. Takes a list of stages (each with its own keyword
 * set) plus an optional tech-context keyword set, and returns a ranked
 * candidate pool with full plugin digests attached.
 *
 * Replaces the previous grep | grep | rank-items | head | jq pipeline
 * that both skills used to orchestrate in shell — consolidating the
 * mechanics here removes the escaping footguns, the `-h`/file-order
 * warnings, the `$CACHE` expansion trap, and the angle-bracket
 * placeholder trap that the Step 4 prose had to carry.
 *
 * Behavior matches the old pipeline:
 *   - Reads both `local-items.ndjson` (first) and `items.ndjson` from
 *     `~/.claudeworks/marketplace-cache/`.
 *   - For each stage, filters lines by (stageKeywords AND techKeywords)
 *     case-insensitively. If techKeywords is empty the second filter is
 *     skipped — the "generic mode" fallback.
 *   - Scores surviving lines by distinct keyword matches against
 *     `desc` + `id` + `plugin` (same formula as `rank-items.js`), sorts
 *     stable-descending, and caps per-stage at `--cap` (default 60).
 *     Local items keep their file-order lead on score ties because
 *     local-items.ndjson is read first.
 *   - Collects the union of plugin IDs across all stages and joins
 *     against `catalog.json` + `local-catalog.json` to attach the full
 *     plugin digest (displayName, description, featured, collections,
 *     counts, topKeywords, sourceUrl, source).
 *
 * Input: a single JSON object on stdin of the shape
 *   {
 *     "stages": [{"id": "implement", "keywords": ["implement","write","code"]}, ...],
 *     "techKeywords": ["typescript","react","electron"],
 *     "cap": 60
 *   }
 *
 * Output: a single JSON object on stdout of the shape
 *   {
 *     "stages": [
 *       {"id":"implement","hitCount":42,"hits":[{"kind","id","plugin","desc","sourceUrl"}, ...]},
 *       ...
 *     ],
 *     "plugins": [
 *       {"id","displayName","description","marketplace","collections","featured",
 *        "counts","sourceUrl","topKeywords","source":"marketplace"|"local"},
 *       ...
 *     ],
 *     "diagnostics": {
 *       "itemsFile": "...","itemsCount": 5904,
 *       "localItemsFile": "...","localItemsCount": 12,
 *       "catalogCount": 779,"localCatalogCount": 6,
 *       "missingFiles": []
 *     }
 *   }
 *
 * Errors (missing cache files, malformed input) are reported as JSON on
 * stdout with an `error` key so the calling skill can surface a clean
 * message without having to parse stderr.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const CACHE_DIR = path.join(os.homedir(), ".claudeworks", "marketplace-cache");
const ITEMS_PATH = path.join(CACHE_DIR, "items.ndjson");
const LOCAL_ITEMS_PATH = path.join(CACHE_DIR, "local-items.ndjson");
const CATALOG_PATH = path.join(CACHE_DIR, "catalog.json");
const LOCAL_CATALOG_PATH = path.join(CACHE_DIR, "local-catalog.json");

function fail(msg, extra) {
  process.stdout.write(JSON.stringify({ error: msg, ...(extra || {}) }) + "\n");
  process.exit(0); // exit 0 so the calling `!` block still shows the JSON
}

function readJsonFile(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) {
    return null;
  }
}

function readNdjsonFile(p) {
  // Returns an array of { raw, obj } — raw is the original line (so the
  // skill's calling convention of "hits look like ndjson rows" stays
  // stable), obj is the parsed JSON for scoring + plugin collection.
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, "utf-8");
  const lines = text.split("\n").filter((l) => l.length > 0);
  const out = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      out.push({ raw: obj, id: obj.id || "", plugin: obj.plugin || "", desc: obj.desc || "", kind: obj.kind || "" });
    } catch {
      // Skip malformed lines silently — they're data-pipeline artifacts,
      // not user errors, and we'd rather return what we can than abort.
    }
  }
  return out;
}

function buildKeywordRegex(keywords) {
  // Escape regex metacharacters so "c++", "node.js", "next.js" etc.
  // match literally rather than exploding as regex. Returns a single
  // case-insensitive alternation regex, or null if the list is empty.
  const cleaned = (keywords || [])
    .map((k) => String(k || "").trim())
    .filter((k) => k.length > 0)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (cleaned.length === 0) return null;
  return new RegExp("(" + cleaned.join("|") + ")", "i");
}

function buildDistinctScorer(keywords) {
  // Matches the rank-items.js contract: one point per distinct keyword
  // that appears in the target string. Duplicate matches of the same
  // keyword count once.
  const cleaned = (keywords || [])
    .map((k) => String(k || "").trim())
    .filter((k) => k.length > 0);
  const regexes = cleaned.map((k) => {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, "i");
  });
  return (target) => {
    let score = 0;
    for (const re of regexes) {
      if (re.test(target)) score++;
    }
    return score;
  };
}

async function readStdinJson() {
  return new Promise((resolve, reject) => {
    let buf = "";
    if (process.stdin.isTTY) {
      // No piped input — treat as empty so the --help path below can fire.
      resolve(null);
      return;
    }
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { buf += chunk; });
    process.stdin.on("end", () => {
      if (!buf.trim()) { resolve(null); return; }
      try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
    });
    process.stdin.on("error", reject);
  });
}

function printUsageAndExit() {
  process.stdout.write(JSON.stringify({
    error: "retrieve-plugins.js: expected a JSON object on stdin",
    usage: {
      stdin: { stages: [{ id: "<stage-id>", keywords: ["kw1", "kw2"] }], techKeywords: ["tech1", "tech2"], cap: 60 },
      example: "echo '{\"stages\":[{\"id\":\"implement\",\"keywords\":[\"implement\",\"code\"]}],\"techKeywords\":[\"react\"],\"cap\":60}' | node retrieve-plugins.js",
    },
  }) + "\n");
  process.exit(0);
}

async function main() {
  let input;
  try {
    input = await readStdinJson();
  } catch (e) {
    fail("retrieve-plugins.js: could not parse stdin as JSON: " + e.message);
    return;
  }
  if (!input) { printUsageAndExit(); return; }

  const stages = Array.isArray(input.stages) ? input.stages : [];
  if (stages.length === 0) {
    fail("retrieve-plugins.js: input.stages must be a non-empty array of {id,keywords} objects");
    return;
  }
  const techKeywords = Array.isArray(input.techKeywords) ? input.techKeywords : [];
  const cap = Number.isFinite(input.cap) && input.cap > 0 ? Math.floor(input.cap) : 60;

  // Load the two NDJSON sources. Local first so its lines keep file-order
  // priority on score ties (same invariant the old shell pipeline relied
  // on via `grep -h local first, then marketplace`).
  const localItems = readNdjsonFile(LOCAL_ITEMS_PATH);
  const marketItems = readNdjsonFile(ITEMS_PATH);
  const allItems = localItems.concat(marketItems);

  const catalog = readJsonFile(CATALOG_PATH);
  const localCatalog = readJsonFile(LOCAL_CATALOG_PATH);

  const missingFiles = [];
  if (!fs.existsSync(ITEMS_PATH)) missingFiles.push("items.ndjson");
  if (!fs.existsSync(LOCAL_ITEMS_PATH)) missingFiles.push("local-items.ndjson");
  if (!catalog) missingFiles.push("catalog.json");
  if (!localCatalog) missingFiles.push("local-catalog.json");
  if (!fs.existsSync(ITEMS_PATH) && !fs.existsSync(LOCAL_ITEMS_PATH)) {
    fail("retrieve-plugins.js: both items.ndjson and local-items.ndjson are missing from " + CACHE_DIR + " — run fetch-marketplace-cache.js and list-local-plugins.js first", { missingFiles });
    return;
  }

  const techRegex = buildKeywordRegex(techKeywords); // null when generic mode
  const techSet = techKeywords.filter((k) => String(k || "").trim().length > 0);

  const stageResults = [];
  const pluginIds = new Set();

  for (const stage of stages) {
    const stageId = String(stage.id || "unnamed");
    const stageKeywords = Array.isArray(stage.keywords) ? stage.keywords : [];
    const stageRegex = buildKeywordRegex(stageKeywords);

    // If a stage has zero keywords, skip it rather than returning
    // everything — an empty filter on an intersection pipeline is almost
    // always a caller bug, and silent "match everything" would pollute
    // the candidate pool with unrelated items.
    if (!stageRegex) {
      stageResults.push({ id: stageId, hitCount: 0, hits: [], note: "no keywords provided for this stage" });
      continue;
    }

    // First filter: stage keywords. Second filter (optional): tech
    // context. Both operate on the composite target string so short
    // item IDs and plugin names contribute to the match.
    const filtered = [];
    for (const it of allItems) {
      const target = it.desc + " " + it.id + " " + it.plugin;
      if (!stageRegex.test(target)) continue;
      if (techRegex && !techRegex.test(target)) continue;
      filtered.push(it);
    }

    // Score by distinct-keyword count across the union of stage +
    // tech keywords — mirrors the old rank-items.js scoring contract.
    const scoreKeywords = stageKeywords.concat(techSet);
    const scorer = buildDistinctScorer(scoreKeywords);
    const scored = filtered.map((it, originalIndex) => ({
      it,
      originalIndex,
      score: scorer(it.desc + " " + it.id + " " + it.plugin),
    }));

    // Stable sort: higher score first, ties preserve file order (which
    // puts local items ahead of same-score marketplace items).
    scored.sort((a, b) => (b.score - a.score) || (a.originalIndex - b.originalIndex));

    const capped = scored.slice(0, cap);
    const hits = capped.map(({ it }) => ({
      kind: it.kind,
      id: it.id,
      plugin: it.plugin,
      desc: it.desc,
      sourceUrl: it.raw.sourceUrl || null,
    }));
    for (const h of hits) {
      if (h.plugin) pluginIds.add(h.plugin);
    }
    stageResults.push({ id: stageId, hitCount: hits.length, hits });
  }

  // Plugin-level join. Marketplace IDs have the `name@marketplace` form;
  // local IDs are prefixed `local:`. Index each catalog by id for O(1)
  // lookup and pull digests for the unique set we collected.
  const marketIndex = new Map();
  if (catalog && Array.isArray(catalog.plugins)) {
    for (const p of catalog.plugins) marketIndex.set(p.id, p);
  }
  const localIndex = new Map();
  if (localCatalog && Array.isArray(localCatalog.plugins)) {
    for (const p of localCatalog.plugins) localIndex.set(p.id, p);
  }

  const plugins = [];
  for (const pid of pluginIds) {
    if (pid.startsWith("local:")) {
      const digest = localIndex.get(pid);
      if (digest) plugins.push({ ...digest, source: "local" });
      // If the local digest is missing it means the NDJSON and catalog
      // are out of sync — surface it in diagnostics rather than aborting,
      // so the skill can still present the hits it does have.
      else plugins.push({ id: pid, displayName: pid, description: "", marketplace: "local", collections: [], featured: false, counts: {}, sourceUrl: null, topKeywords: [], source: "local", _missing: true });
    } else {
      const digest = marketIndex.get(pid);
      if (digest) plugins.push({ ...digest, source: "marketplace" });
      else plugins.push({ id: pid, displayName: pid, description: "", marketplace: "", collections: [], featured: false, counts: {}, sourceUrl: null, topKeywords: [], source: "marketplace", _missing: true });
    }
  }

  // Stable ordering for the plugin list: featured first, then by id.
  plugins.sort((a, b) => {
    if ((b.featured ? 1 : 0) !== (a.featured ? 1 : 0)) return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
    return String(a.id).localeCompare(String(b.id));
  });

  const result = {
    stages: stageResults,
    plugins,
    diagnostics: {
      itemsFile: ITEMS_PATH,
      itemsCount: marketItems.length,
      localItemsFile: LOCAL_ITEMS_PATH,
      localItemsCount: localItems.length,
      catalogCount: catalog && Array.isArray(catalog.plugins) ? catalog.plugins.length : 0,
      localCatalogCount: localCatalog && Array.isArray(localCatalog.plugins) ? localCatalog.plugins.length : 0,
      missingFiles,
    },
  };
  process.stdout.write(JSON.stringify(result) + "\n");
}

main().catch((e) => {
  fail("retrieve-plugins.js: unexpected error: " + (e && e.message ? e.message : String(e)));
});
