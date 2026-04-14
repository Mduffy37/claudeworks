#!/usr/bin/env node
/**
 * rank-items.js
 *
 * Pre-sort `items.ndjson`-style input lines by keyword match count, stable,
 * descending. Used by the create-profile and suggest-plugins skills as a
 * pipeline stage between `grep` and `head -N` so that the top-N lines are
 * the N best matches by relevance, not the first N in file order.
 *
 * Without this script, the retrieval pipeline would be:
 *   grep ... | head -60
 * which truncates to the first 60 matches in file order — and because
 * `items.ndjson` is sorted alphabetically by marketplace ID, that means
 * early-alphabet marketplaces systematically crowd out late-alphabet ones.
 * A perfect match from `zzz-plugin` loses to six mediocre matches from
 * `aaa-plugin` purely because of the letter the marketplace ID starts with.
 *
 * With this script:
 *   grep ... | node rank-items.js '<keywords>' | head -60
 * the pipeline still reads both files sequentially, but rank-items.js
 * scores every match by DISTINCT keyword hits before the head cap, so
 * the N survivors are genuinely the N most relevant lines. Ties preserve
 * input order, so when scores match, the file-order convention (local
 * first, then alphabetical marketplace) still applies as a fair tiebreaker.
 *
 * Usage:
 *   grep ... | node rank-items.js 'kw1|kw2|kw3|kw4' | head -60
 *
 * The keyword argument is a single `|`-joined alternation — pass the
 * UNION of the stage keywords (Group A) and the tech-context keywords
 * (Group B) from Step 4a, joined with `|`. Case-insensitive matching.
 *
 * Scoring: one point per distinct keyword that appears in the line's
 * `desc` + `id` fields. A keyword matching twice in the same line
 * contributes 1, not 2 — we count distinct keywords, not occurrences.
 * This keeps the ranking aligned with how Step 6a computes its explicit
 * match-count score.
 */

// Handle EPIPE silently — the downstream `head -N` will close its stdin
// after reading N lines, and our writes after that point should exit
// cleanly rather than crashing with an unhandled error event. This is the
// standard pattern for Unix-style filters that feed into `head`.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

const keywordArg = process.argv[2];
if (!keywordArg) {
  process.stderr.write(
    "rank-items.js: missing keyword regex argument. " +
    "Usage: rank-items.js '<keyword1>|<keyword2>|...'\n",
  );
  process.exit(1);
}

// Split the alternation into distinct keyword patterns. Each keyword
// gets its own regex so we can test for distinct hits (not total matches).
const keywords = keywordArg
  .split("|")
  .map((k) => k.trim())
  .filter((k) => k.length > 0);

if (keywords.length === 0) {
  // No keywords to rank on — pass input straight through.
  process.stdin.pipe(process.stdout);
  return;
}

const keywordRegexes = keywords.map((k) => {
  // Escape regex metacharacters in user-supplied keywords so a keyword
  // like "c++" or "node.js" doesn't accidentally parse as a regex.
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "i");
});

let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
});

process.stdin.on("end", () => {
  const lines = buffer.split("\n").filter((l) => l.length > 0);
  const scored = lines.map((line, i) => {
    // Target the `desc` and `id` fields preferentially, so we score on the
    // actual descriptive content. Fall back to the full line if JSON parse
    // fails — handles non-JSON input gracefully rather than crashing.
    let target = line;
    try {
      const obj = JSON.parse(line);
      target = (obj.desc || "") + " " + (obj.id || "") + " " + (obj.plugin || "");
    } catch {
      /* non-JSON line; target stays as full line */
    }

    let score = 0;
    for (const re of keywordRegexes) {
      if (re.test(target)) score++;
    }
    return { line, score, originalIndex: i };
  });

  // Stable sort: higher score first; ties preserve input order.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.originalIndex - b.originalIndex;
  });

  for (const entry of scored) {
    process.stdout.write(entry.line + "\n");
  }
});
