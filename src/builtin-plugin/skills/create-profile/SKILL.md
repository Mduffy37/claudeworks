---
name: create-profile
description: Create a new Claude Code profile from a description — infers project context, matches the user's work to curated workflow shapes, and assembles a bespoke profile by retrieving plugins from the full curated marketplace.
---

You are creating a new Claude Code profile. A profile is a named preset that controls which plugins, skills, agents, MCP servers, and settings load per Claude Code session. Your job is not to match keywords to plugins — it is to produce a **workflow-shaped profile** that covers the natural stages of the user's work with tools that fit their specific tech stack and constraints, and then to turn that draft into a finished profile through a short conversation with the user.

This skill runs as a layered flow:

- **Step 0 — Description.** Capture a one-line profile description from the user's initial message (or by asking directly). Everything downstream grounds against this intent.
- **Layer 0 — Project inference.** If launched inside a code project, infer the tech context before asking questions.
- **Layer 1 — Clarification.** Adaptive 0–3 questions depending on what Layer 0 already knows.
- **Layer 2 — Retrieval.** For each stage of the chosen workflow shape(s), pull candidate plugins from the full curated marketplace using stage keywords × tech context.
- **Layer 3 — Composition.** Assemble a draft plugin list, then self-critique it against a gap / redundancy / coherence checklist.
- **Layer 4 — Interactive presentation.** Discuss the picks with the user, co-design an optional `/workflow` command, collect final settings, then write `profiles.json`.
- **Step 7.5 — Plugin install.** For any final picks not yet installed on the machine, offer to install them before the write so the profile launches cleanly.

You never read the marketplace index in full. You use `grep` and `jq` to filter, and only ever see the subset of plugins that match the user's actual intent. And you never draft the `/workflow` body unilaterally — that is always co-designed with the user in Step 7d.

## Step 0 — Capture the profile description

Before running any inference or retrieval, lock a one-line description for this profile. This text appears next to the profile name in the ClaudeWorks app's sidebar and anchors every downstream decision — shape matching, keyword derivation, presentation rationale all reference it.

Read the user's initial message. If it already contains enough signal to draft a plausible description (e.g. *"I'm building frontend features on this app — React + TS, Tailwind, Playwright"* becomes *"Frontend feature development on a React/TS/Tailwind solo project"*), draft one and present it for a single-beat confirmation:

> *"Before I run project inference, let me lock a one-line description for this profile (it'll show up next to the profile name in the ClaudeWorks app). How about: 'Frontend feature development on a React/TS desktop app'? Sound right, or do you want a different wording?"*

Accept the user's confirmation or revision. Store the final description as the `profile_description` you'll reference in Step 3 (shape matching), Step 7a (presentation header), and Step 8 (as `P_DESC` when writing to `profiles.json`).

If the user's initial message is too thin to draft from (e.g. *"I want a profile"* or *"make me a profile"*), ask directly:

> *"What's this profile for, in one line? It'll show up in the profile list — something like 'Frontend features on my React app' or 'PR review for the backend team'. Be as specific as you want."*

Do not move on from Step 0 until the description is locked. A vague description produces a vague profile; you can recover from a weak Layer 0 signal bundle, but you cannot recover from a user whose intent you never understood.

## Step 1 — Gather inputs

Run these commands and keep their outputs in mind throughout the rest of the flow. They are your entire world-model for this session.

### 1a. Project inference (Layer 0)

Every shell command in this skill needs to reach files inside the plugin's own directory (`scripts/`, `data/`). In many Claude Code contexts the `$CLAUDE_PLUGIN_ROOT` env var is set to that directory automatically, but some contexts (including the ClaudeWorks app's built-in plugin load path) leave it unset. To be robust in both cases, **every** `!` bash command below uses the POSIX parameter expansion `${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}` — it uses the env var if set, otherwise falls back to the stable installed-plugin path. Do not simplify this to a bare `$CLAUDE_PLUGIN_ROOT` or the skill will break on anyone whose runtime doesn't set it.

!`node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/scripts/infer-project.js" "$PWD" 2>&1`

This emits a single-line JSON signal bundle. Parse it and note:

- `mode` — `"project"` or `"generic"`. Generic means the skill was launched from `$HOME`, an empty directory, or a directory with no recognizable manifests.
- `confidence` — `"high"`, `"medium"`, `"low"`, or `"generic"`. This drives how much clarification you ask for in Step 2.
- `languages`, `frameworks`, `keyDependencies`, `tooling`, `testFrameworks`, `infra` — the tech context. You will fold these into retrieval keywords in Step 4.
- `existingAIConfig` — note especially `hasClaudeMd`, `hasAgentsMd`, `hasMcpConfig`. If the project already has a `CLAUDE.md`, respect it: do not duplicate its instructions in the profile's `customClaudeMd` slot later.
- `projectPurpose` — the first paragraph of the README, if any. Use it to ground your understanding of what the user is actually building.

### 1b. Workflow shapes

!`cat "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/data/workflow-shapes.json"`

This is the curated inventory of 12 workflow shapes. Each shape describes the *stages* of a kind of work (e.g. feature-development, code-review, security-audit), independent of tools or tech stack. You will match the user's intent to 1–2 shapes in Step 3. Shapes are **hints, not gates** — you may blend two shapes, synthesize a custom shape if nothing fits, or ignore them entirely for genuinely novel work.

Pay attention to each shape's `signals` (for user-intent matching), `stages` (for retrieval), `commonBlends` (for multi-hat users), and `rationale` (for understanding when each shape applies).

### 1c. Marketplace catalog — cache and fetch

The recommender needs two files from the `claudeworks-marketplace` repo: `catalog.json` (plugin-level digest) and `items.ndjson` (item-level grep stream). They are cached locally at `~/.claudeworks/marketplace-cache/` with a 24-hour TTL. Run the helper script to populate the cache if needed:

!`node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/scripts/fetch-marketplace-cache.js" 2>&1`

The script output is a single-line JSON object of the form `{"cacheDir": "...", "files": {"catalog.json": "<status>", "items.ndjson": "<status>"}}`. Possible status values per file:

- `cache-hit` — the file was already fresh in `~/.claudeworks/marketplace-cache/` (within the 24h TTL); no fetch needed
- `fetched-auth` — the file was freshly downloaded via `api.github.com` using an auth token discovered from `GITHUB_TOKEN` / `GH_TOKEN` / `gh auth token`
- `fetched-anon` — the file was freshly downloaded anonymously (only works if the marketplace repo is public)
- `sibling-fallback` — the file was copied from `$CLAUDEWORKS_MARKETPLACE_DIR` (developer escape hatch)
- `UNAVAILABLE` — no fallback worked; the caller (you) must surface an actionable error

Parse the output. If either file shows `UNAVAILABLE`, stop and tell the user that the marketplace catalog cannot be reached. The `claudeworks-marketplace` repo is currently private, so anonymous access does not work. The user needs **one** of the following:

1. **Install and authenticate the `gh` CLI** — run `gh auth login` once. This is the simplest path for most users and the skill will use the preferred authenticated `gh api` path.
2. **Set a `GITHUB_TOKEN` environment variable** — a Personal Access Token with `repo` scope, created at https://github.com/settings/tokens. Useful if the user doesn't want to install `gh`. The skill will fall through to native `fetch` with that token.
3. **Set `CLAUDEWORKS_MARKETPLACE_DIR`** — point at a local clone of the marketplace repo. This is a developer escape hatch only.

Do not proceed without the catalog. Suggest the first option unless the user has a specific reason to prefer another.

The `cacheDir` is always at `~/.claudeworks/marketplace-cache/`. Use that full path directly in the retrieval commands below — do not use a `$CACHE` placeholder, because Claude Code's `!` bash execution does not define that variable and it will expand to an empty string, breaking the path. The two files you will reference are `~/.claudeworks/marketplace-cache/catalog.json` and `~/.claudeworks/marketplace-cache/items.ndjson`.

### 1d. Installed plugins and existing profiles

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const pfPath=path.join(os.homedir(),'.claudeworks','profiles.json');
const profiles=fs.existsSync(pfPath)?JSON.parse(fs.readFileSync(pfPath,'utf-8')).profiles:{};
const mfPath=path.join(os.homedir(),'.claude','plugins','installed_plugins.json');
const mf=fs.existsSync(mfPath)?JSON.parse(fs.readFileSync(mfPath,'utf-8')):{plugins:{}};
const installed=Object.keys(mf.plugins||{}).map(n=>({id:n,short:n.split('@')[0]}));
console.log(JSON.stringify({installed,profileNames:Object.keys(profiles)}));
" 2>&1`

This tells you which plugins are already locally installed (so you can flag "already installed" vs. "needs install from Browse tab") and which profile names are taken (so you don't collide in Step 7).

### 1e. Local skills, agents, and commands

The user may have **local** skills, agents, or commands installed directly under `~/.claude/skills/`, `~/.claude/agents/`, `~/.claude/commands/` — these are real, first-class items that are *not* in the curated marketplace index. They can be referenced in profiles as `local:<name>` plugin IDs (matching the `LOCAL_PLUGIN_PREFIX` constant in the Electron app's `core.ts`), and the profile loader wires them up correctly at session launch.

**Always enumerate them at the start of Step 1** — a session that ignores the local scan will present the user with "here are some curated plugins" while silently missing tools they already installed and rely on. Run:

!`node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/scripts/list-local-plugins.js" 2>&1`

The script writes two files alongside the marketplace cache and prints a single-line summary to stdout:

- `~/.claudeworks/marketplace-cache/local-catalog.json` — plugin-level digest in the same shape as `catalog.json`, with `marketplace: "local"` on every entry and IDs like `local:uiux-toolkit`
- `~/.claudeworks/marketplace-cache/local-items.ndjson` — item-level NDJSON stream in the same shape as `items.ndjson`, one JSON object per line

Both files are rebuilt on every invocation (no TTL), because local items can be added or removed between sessions and are cheap to re-scan.

From Step 4 onward, treat these two files as a **second retrieval source** alongside the marketplace `items.ndjson` / `catalog.json` — every grep and jq against the marketplace cache should also hit the local cache in the same pass. Commands later in the skill will show this concretely.

## Step 2 — Adaptive clarification (Layer 1)

How much you ask depends on what Layer 0 already told you. **Do not ask questions the project has already answered.** That's ceremony, and ceremony kills adoption.

### If `mode: "project"` and `confidence: "high"`

Skip explicit confirmation. Embed a one-beat implicit confirmation in your first message, then proceed to Step 3. Example: *"I can see this is a Swift Vapor backend with a Python data-tooling side — I'll draft a profile shaped around that. Stop me now if I'm off; otherwise I'll show you the draft in a moment."* Then move on.

### If `mode: "project"` and `confidence: "medium"`

One confirmation beat: *"I think this is a `<description from inference>` — is that right? And what kind of work do you do on it most — building features, reviewing PRs, fixing bugs, something else?"* Accept their answer and proceed.

### If `mode: "project"` and `confidence: "low"`

Up to 3 clarifying questions, picked from the pool below based on what Layer 0 couldn't determine:

1. *"I see some code here but can't tell the shape for sure. Is this a backend API, a frontend app, a data pipeline, a monorepo, or something else?"*
2. *"What's the profile for — this whole directory, or a specific subproject inside it?"*
3. *"What kind of work do you do most — building new features, reviewing, fixing bugs, researching, something else?"*

Never ask more than 3 questions. If the user is vague after 3, proceed with your best guess and flag it in the draft.

### If `mode: "generic"`

Standard adaptive clarification, capped at 3 questions. Pool:

1. *"What's the main work this profile is for? (backend, frontend, data, security, writing, research, something else)"*
2. *"What's your primary output — code, reviews, docs, designs, data analyses, prompts?"*
3. *"Any specific tech stack or tools you already rely on that should definitely be in the profile?"*

### User overrides

If the user's initial message explicitly says *"I want a generic profile"* or *"this profile is for the ./api subdirectory,"* honor that override immediately — user intent always wins over inference. Re-run Step 1a against the specified subdirectory if needed.

## Step 3 — Match workflow shapes to user intent

From the workflow-shapes JSON you loaded in Step 1b, pick **1 or 2 shapes** that best fit the user's described work. Use each shape's `signals` field to anchor the match against the user's own words.

**How to pick:**

- **Prefer 1 shape** when the user's work is cleanly within a single loop (e.g. "I just do feature development").
- **Use 2 shapes** when the user describes two distinct loops or is clearly a multi-hat worker (e.g. "I build features and do code reviews"). Prefer shapes that appear in each other's `commonBlends` list — these combinations are known to be coherent.
- **Synthesize a custom shape** (do not pick from the file) if genuinely nothing fits. Use 4–6 stages with clear intents. This should be rare; if you find yourself synthesizing often, the user's work probably maps to an existing shape you missed.
- **Never pick more than 2 shapes.** 3+ produces a bloated profile with redundant coverage.

Write down the shape(s) you picked and which stages each one contributes. For blended shapes, union their stages and de-duplicate any that overlap (e.g. `feature-development.verify` and `bug-fixing.verify-and-close` cover similar ground — keep one).

## Step 4 — Retrieval (Layer 2)

For each stage of your chosen shape(s), derive a stage-keyword list and then pass the full stage set (plus tech-context keywords from Layer 0) to `retrieve-plugins.js` in a single call. The script reads both the marketplace and local caches, runs the intersection filter, scores by distinct keyword matches, caps per-stage, and attaches full plugin digests from `catalog.json` + `local-catalog.json` — so one invocation replaces the old grep/rank/head/jq dance entirely.

### 4a. Build per-stage keyword lists

**Group A — stage keywords** (from `workflow-shapes.json`):

- `stage.keywords` — the stage's own keyword list (typically 5–8 words)
- Plus any tools the user explicitly mentioned in Step 2 (e.g. "I use Playwright" → add `playwright` to the relevant stage)

**Group B — tech context keywords** (from Layer 0, project mode only):

- `signal_bundle.languages`
- `signal_bundle.frameworks`
- `signal_bundle.keyDependencies.slice(0, 5)` — top 5 deps, capped to avoid noise
- `signal_bundle.tooling` — include when tooling is load-bearing (e.g. the `verify` stage)

In **generic mode** (no Layer 0 tech signal), leave Group B empty — the script falls through to a stage-keywords-only filter.

**Also use the empty-Group-B path when retrieving cross-cutting staples in Step 6b** (planning, git workflow, debugging). Staples are meant to be general-purpose, and narrowing them by tech context is counterproductive.

### 4b. Call retrieve-plugins.js

Build a single JSON payload with all your stages and the tech-context keywords, then pipe it to the script via a heredoc. For a TypeScript/React/Electron project with `implement` and `verify` stages, the call looks like this — use *your* actual stage IDs and keywords, not these:

!`node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/scripts/retrieve-plugins.js" <<'JSON'
{
  "stages": [
    {"id": "implement", "keywords": ["implement","write","code","wire","integrate","develop"]},
    {"id": "verify",    "keywords": ["test","verify","check","validate"]}
  ],
  "techKeywords": ["typescript","react","electron","tsx","frontend"],
  "cap": 60
}
JSON`

The script emits a single-line JSON object of the shape:

```
{
  "stages": [
    {"id": "<stage-id>", "hitCount": N,
     "hits": [{"kind","id","plugin","desc","sourceUrl"}, ...]}, ...
  ],
  "plugins": [
    {"id","displayName","description","marketplace","collections","featured",
     "counts","sourceUrl","topKeywords","source":"marketplace"|"local"}, ...
  ],
  "diagnostics": {"itemsCount","localItemsCount","catalogCount","localCatalogCount","missingFiles":[]}
}
```

Each `stages[i].hits` is ranked by distinct-keyword match count (same formula as the old `rank-items.js` pipeline), capped at 60, with local items leading marketplace items on score ties. The `plugins` array is the unique set of plugins referenced across all stages, **with full catalog digests already joined** — no follow-up `jq` pass is needed. This is why Step 5 (plugin-level lookup) is gone: the join happens inside `retrieve-plugins.js`.

**Error handling.** If the response has an `error` key instead of `stages`/`plugins`, surface the message verbatim to the user and stop. If `diagnostics.missingFiles` contains `catalog.json` or `items.ndjson`, the marketplace cache is incomplete — re-run `fetch-marketplace-cache.js` from Step 1c. If it contains `local-items.ndjson` or `local-catalog.json`, re-run `list-local-plugins.js` from Step 1e.

**If a stage returns fewer than ~5 hits**, either (a) broaden its `keywords` list with synonyms you derive from the stage's `intent` field in `workflow-shapes.json` and re-run the script, or (b) note the gap and flag it explicitly in the self-critique (Step 6d) and presentation (Step 7a).

### 4c. Candidate pool

The script's `response.plugins` array **is** your candidate plugin pool for Step 6 — typically 20–40 unique plugins across 4–6 stages, each carrying `displayName`, `description`, `featured`, `collections`, `counts`, `topKeywords`, `sourceUrl`, and a `source` tag (`"marketplace"` or `"local"`). Use `response.stages[].hits` when you need to know *which* stages a given plugin matched for (for multi-stage leverage scoring in Step 6a).

## Step 6 — Composition and self-critique (Layer 3)

### 6a. Per-stage selection (explicit scoring, not file order)

For each stage, you have up to ~60 candidate items in `response.stages[i].hits` and the unique plugin digests in `response.plugins`. The script's per-stage ranking is a good starting order (distinct-keyword match score, stable, local-first tiebreak), but Step 6a applies additional signals on top of it. Compute an explicit score per *unique plugin* (aggregating the matched items across a plugin into a single plugin-level score), then pick the 1–2 highest-scoring plugins for the stage.

**Scoring formula** (compute this for every candidate plugin, then rank):

```
score = 0
score += (distinct Group A keywords matched in any of the plugin's items)
score += (distinct Group B keywords matched in any of the plugin's items)
score += (distinct Group A keywords matched in the plugin's catalog description)
score += (distinct Group B keywords matched in the plugin's catalog description)
score += 2   if featured: true
score += 1   if the plugin's `collections[]` in catalog.json contains a token that matches any Group B keyword
score += 1   for each additional stage this plugin's items showed up in (multi-stage leverage)
score += 1   if the plugin's id starts with `local:` (already installed = the user's own quality signal, small nudge only — does not override a clearly-better marketplace match)
```

Rank candidates by `score` descending. Pick the top 1 (or top 2 if two candidates tie or are both strong fits for different sub-aspects of the stage). Break ties in this order:

1. **Featured beats non-featured.** `featured: true` wins. Local plugins never have `featured: true` (by convention), so a featured marketplace plugin will always beat a local one at equal score — but the local-plugin +1 nudge above gives local a fair shot when keyword match is equivalent.
2. **Higher `counts.skills + counts.agents + counts.commands`** — prefer a richer plugin over a single-skill one, unless the single-skill plugin is the clearly better fit for this specific stage.
3. **Collection alignment** — prefer plugins whose `collections[]` overlap with the user's project context.
4. **Alphabetical** — last resort only, never the primary criterion.

### Mega-bundle plugins — use exclusions, don't reject

**This is the single most important rule in the ranking step, and the one most likely to trip Claude up:** do NOT reject large plugins on cognitive-load grounds. The profile engine supports per-item exclusions, and exclusions are **physical filesystem pruning**, not metadata hints — `applyExclusions()` in `src/electron/core.ts:1589` deletes the excluded skill directories from the profile's config dir before the session launches, and patches the plugin's own manifest to strip them from the `skills[]`/`agents[]`/`commands[]` arrays. So an unused skill inside an enabled plugin contributes **zero** context cost at session time: Claude Code never sees its SKILL.md, never reads its frontmatter, and never registers it in the `available_skills` list.

**Concrete rule:**

> When a candidate plugin has `counts.skills + counts.agents + counts.commands > 15` **AND** only 1–3 of its items actually matched retrieval in Step 4, **do not reject it for being "too big."** Instead, plan to include it with exclusions: keep the 1–3 matched items, exclude everything else. You will populate `excludedItems[<plugin-id>]` in Step 6c with the bare item names to remove. The effective cognitive load for that plugin is the count of items you kept, not the raw plugin size.

Example: `antigravity-awesome-skills@antigravity-awesome-skills` ships 999 skills. If the user's project is a biomech research notebook and only the `pubmed` skill is load-bearing, the correct recommendation is:

```jsonc
"plugins": [ ..., "antigravity-awesome-skills@antigravity-awesome-skills" ],
"excludedItems": {
  "antigravity-awesome-skills@antigravity-awesome-skills": [
    // every item name in the plugin except "pubmed" — see Step 6c on how to
    // enumerate the full list via a targeted grep against items.ndjson
  ]
}
```

The user sees a profile with a single effective `pubmed` skill. The other 998 are physically absent from the session. No context bloat. No trade-off. The only cost is a few milliseconds of file deletion during profile assembly, which happens once at save/launch time, never per session.

**Anti-pattern: the 999-skills-rejected failure mode.** In iteration-1 testing, Claude looked at `antigravity-awesome-skills` and reasoned "this is 999 skills, it'll bloat the context, reject it." That's wrong. Claude applied the cognitive-load rubric to raw plugin size instead of effective item count after exclusions. The right answer is always: *if the plugin has a small number of valuable items and many irrelevant ones, include with exclusions*. Use the `counts > 15` threshold as the trigger — anything above that is a mega-bundle that should flow through exclusion composition.

**Anti-patterns to watch for (retrieval-level):**

- **Marketplace-prefix clustering.** If all your winners across stages come from plugins whose marketplace IDs start with the same one or two letters (e.g. all `agenticnotetaking`, `agricidaniel-claude-ads`, `ai-research-skills`), that's a red flag — you ranked by file order, not by score. Recompute the scoring formula before continuing.
- **Generic-verb false positives.** A plugin description that contains the word `implement` or `code` does not automatically mean it belongs in the `implement` stage — a note-taking plugin might have `"Use this to implement better notes"` in its description. Low Group B score (no tech-context match) should heavily penalize these.
- **Over-scoring small plugins with one perfect keyword match.** A one-skill plugin that hits every Group A word gets a high score mechanically, but a larger, better-rounded plugin that hits 3 of 5 may serve the stage better. Use the tiebreakers above.
- **Ignoring local plugins.** If your final picks for a stage include zero local candidates when the user has several plausible local skills (you can see them in the `local-catalog.json` Step 1e generated), double-check `response.diagnostics.localItemsCount` from the Step 4b call — if it's `0`, the local cache wasn't built and the retrieval ran against marketplace-only data. Re-run `list-local-plugins.js` from Step 1e and re-run Step 4b. The symptom of silently skipping locals is an all-marketplace final profile even when the user has perfect local matches installed.

### 6b. Cross-cutting staples

Beyond the workflow shape's stages, some tools are valuable regardless of stage — planning skills, git workflow tools, general debugging helpers, note-taking. Add 1–3 cross-cutting staples to the profile. Retrieve them with a second call to `retrieve-plugins.js` using a single synthetic `"staples"` stage with generic keywords and an **empty** `techKeywords` array (staples are meant to be general-purpose; narrowing them by tech context is counterproductive):

!`node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/scripts/retrieve-plugins.js" <<'JSON'
{
  "stages": [
    {"id": "staples", "keywords": ["plan","planning","git","debug","note","todo","task"]}
  ],
  "techKeywords": [],
  "cap": 30
}
JSON`

Prefer featured plugins here especially — you are adding baseline utility, not domain-specific tooling.

### 6c. Draft the plugin shell (provisional)

Build a draft plugin shell with:

- **`plugins[]`** — the union of stage picks + staples, as an array of plugin IDs. Marketplace plugins use the `<name>@<marketplace>` format (e.g. `frontend-design@claude-plugins-official`); local plugins use `local:<name>` (e.g. `local:uiux-toolkit`); framework plugins use `framework:<name>`. Mix all three freely — the profile engine handles each correctly.
- **`excludedItems{}`** — populated ONLY for plugins where you want to keep a subset of items. See the exclusion-computation recipe below. Leave the key out entirely for plugins where you want every item enabled (the default).
- **`enabledItemsSummary`** (for your own mental bookkeeping, not a real field) — for each plugin, note which items are effectively enabled. This feeds into Step 7a's presentation, where you'll show the `(N of M enabled)` ratio for exclusion-heavy plugins.
- **provisional model choice** — `claude-opus-4-7` for deep-reasoning workflows (feature-development, refactoring, security-audit, research, prompt-engineering), `claude-sonnet-4-6` for balanced work, `claude-haiku-4-5-20251001` for high-loop-count lightweight work. The user will confirm or override in Step 7e.
- **provisional effort level** — `high` for research/refactoring/incident-investigation, `medium` for most feature work, `low` for lightweight loops. The user will confirm in Step 7e.

**Do not draft the `/workflow` body here.** The `/workflow` body is not a composition artifact — it's the output of an interactive co-design step (7d) that runs only if the user explicitly opts in (7c). Leave `workflow` unset in the draft. Do not draft `customClaudeMd` either — that gets collected in Step 7e with an explicit opt-in and a recommendation based on whether the project already has a `CLAUDE.md`.

### Computing `excludedItems` for mega-bundle plugins

When you apply the mega-bundle rule from Step 6a — "include a plugin with `counts > 15` but keep only the 1–3 items that matched retrieval" — you need to build the `excludedItems[<plugin-id>]` array with every item name EXCEPT the ones you're keeping.

**Critical: enumerate from the installed plugin's actual on-disk directory, NOT from `items.ndjson`.** This is a subtle but load-bearing distinction. `items.ndjson` is built from the curated marketplace repo via `gh api` directory listings, and the GitHub Contents API silently caps directory reads at 1000 entries per folder. For mega-bundle plugins with more items than that, `items.ndjson` is truncated and missing hundreds of real items — you'll build a correct-looking exclude list that omits the invisible ones, and when `applyExclusions` runs at profile assembly, it'll prune the items you listed and leave the hundreds it never saw. The real antigravity-awesome-skills plugin has 1368 items installed but `items.ndjson` only has 999 for it — an exclude list built from `items.ndjson` would miss 369 of them and silently leave the profile bloated.

The correct source of truth is the same source `applyExclusions` uses at prune time: the plugin's own `installPath` directory, walked with `scanPluginItems`-equivalent logic. A helper script at `scripts/list-plugin-items.js` does this — it reads `installed_plugins.json` to find the plugin's install path, walks `installPath/{skills,agents,commands}`, uses frontmatter `name:` with directory-basename fallback (exactly matching `core.ts:buildItem`), and returns the complete real item list.

Here is the exact procedure:

1. **Enumerate all items in the plugin** by running the helper script:

   ```
   node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/scripts/list-plugin-items.js" '<plugin-id>'
   ```

   Concrete example for antigravity:

   !`node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/scripts/list-plugin-items.js" 'antigravity-awesome-skills@antigravity-awesome-skills'`

   The output is `{"ok": true, "pluginId": "...", "installPath": "...", "count": <N>, "items": [<sorted array>]}`. The `items` array is the full, real, on-disk item list — every name is guaranteed to match what `applyExclusions` will see at prune time, because this script uses the same frontmatter-name-with-dirname-fallback convention as `core.ts:buildItem`.

   If the script returns `{"ok": false, "error": ...}`, the plugin isn't installed yet (the user probably needs to run Step 7.5 first) or its install path is broken. Surface the error to the user and either rerun after install or skip the exclusion for that plugin (include it without exclusions, accept the cognitive load, note the tradeoff).

2. **Compute the exclude list** as (every item name from the script output) minus (the bare item names of items you're keeping from Step 6a's ranking).

3. **Set** `excludedItems["<plugin-id>"] = [<sorted array of names to exclude>]`. Use the same plugin ID as the key — format matters, `core.ts:1594` does a strict string match via `plugins.find((p) => p.name === pluginName)` and a wrong key silently no-ops.

**Do NOT use a grep against `items.ndjson` for this step.** You can still grep `items.ndjson` in Step 4 for *retrieval* (it's the right source for broad keyword search across the whole marketplace, even if it's occasionally truncated for mega-plugins), but for exclude-list generation you must use `list-plugin-items.js` because the exclude list's correctness depends on byte-exact name matching against what `applyExclusions` sees, and `items.ndjson`'s pagination cap breaks that invariant for mega-bundles.

**Schema reminder (CRITICAL):** `excludedItems[pluginId]` is a **flat array of item-name strings**. It is NOT the nested `{skills:[], agents:[], commands:[]}` form — that format does not exist and the write script rejects it. `applyExclusions` applies the same flat array uniformly to skills, agents, and commands.

Concrete example — `antigravity-awesome-skills@antigravity-awesome-skills` (999 items, keeping only `pubmed`):

```jsonc
"plugins": [
  "frontend-design@claude-plugins-official",
  "antigravity-awesome-skills@antigravity-awesome-skills",
  "superpowers@claude-plugins-official"
],
"excludedItems": {
  "antigravity-awesome-skills@antigravity-awesome-skills": [
    "skill-a", "skill-b", "skill-c", /* ... 995 more ... */ "skill-zzz"
  ]
}
```

You can omit the mega-bundle's `excludedItems` key if you're keeping *every* item — but for any plugin where you applied the mega-bundle rule in Step 6a, the key must be present.

The draft is *provisional* — it's a proposal you will bring to the Step 7 discussion, not a final answer. Every field in it is subject to user revision.

### 6d. Self-critique

Before presenting the draft, run your own eyes over it against this checklist:

1. **Stage coverage.** Does every stage of the chosen workflow shape(s) have at least one pick? If a stage is empty, is that *intentional* or an *oversight*? If an oversight, re-run retrieval for that stage with broadened keywords.
2. **Redundancy.** Are two picks covering the same thing (two linters, two planners, two slash-command plans)? If yes, de-dupe to the stronger one.
3. **Conflict.** Do any picks have clearly colliding slash commands or conflicting hooks based on their descriptions? Flag for user review.
4. **Cognitive load.** Is the total plugin count in the 4–10 range? Fewer than 4 is probably under-equipped; more than 10 is probably over-equipped. Trim or expand.
5. **Model + effort fit.** Does the workflow complexity actually call for the model you picked? Re-evaluate if the justification is weak.
6. **Respect existing project config.** If `existingAIConfig.hasClaudeMd` is true, `customClaudeMd` must be empty (or clearly additive, not duplicative). If `existingAIConfig.hasMcpConfig` is true, do not propose MCP-related plugins that would conflict.
7. **Ready for discussion.** This draft is a proposal you're about to bring to the Step 7 conversation, not a final answer. For each pick, can you state its rationale in one sentence the user can push back on? If the rationale is weak or hand-wavy, strengthen it before presenting — a thin rationale makes Step 7b's discussion performative instead of productive.
8. **Gap flags.** Any stage where you couldn't find a confident match? Note it explicitly — the user should know the profile has a gap before they accept.

If any check fails, revise the draft and re-run the checklist **once** (not in a loop — avoid infinite revision).

## Step 7 — Interactive presentation and co-design (Layer 4)

This is where the skill stops making unilateral decisions and starts collaborating with the user. Steps 1–6 produced a provisional draft; Step 7 turns that draft into a final profile through a short conversation. **The user should feel like a co-author here, not a reviewer stamping a form.**

Step 7 has six sub-steps. Run them in order, don't skip, and don't batch questions — each sub-step is a distinct conversational beat.

### 7a. Present the tool set (flat, ranked by relevance)

Lead with the locked profile description from Step 0 so the user always sees what they originally asked for. Then present the draft picks as a **single flat list in Step 6a rank order**, highest-scoring tool first.

**Do NOT group the picks by workflow stage.** The stages exist as an internal retrieval and composition scaffold, but they are *not* a user-facing structure at this step. Grouping tools under `## Stage: <name>` headers implicitly promises the user a sequence they haven't asked for yet, and mis-frames the presentation for users whose profile has no workflow orientation at all. At this step the user wants to see *what tools they're getting*, not *what sequence Claude will run them in* — the sequence question only arrives in Step 7c, and the actual sequence design only happens in Step 7d for users who opt in.

Lead the list with a simple framing line that tells the user how many tools they're about to see, then present each tool as a **compact 5–6 line block** with:

1. **Plugin ID** in its canonical format, followed by one or more tags in parentheses:
   - `(featured)` if `featured: true` from the catalog
   - `(local)` if the plugin ID starts with `local:` — signals to the user that this one is already installed directly from their own `~/.claude/` directory, not from the curated marketplace
   - `(<N> of <M> enabled)` if you're applying the mega-bundle exclusion rule — where `N` is the number of items you're keeping and `M` is the plugin's total `counts.skills + counts.agents + counts.commands`. Example: `(2 of 999 enabled)` for an `antigravity-awesome-skills` pick where you're keeping only `pubmed` and one sibling skill.
2. **One-line description** from `catalog.json` / `local-catalog.json` (truncated to ~80 chars)
3. **Enabled items** — the specific skills/agents/commands that will be active from this plugin. For plugins with no exclusions, list the items retrieved in Step 4 plus any obviously-load-bearing siblings. For mega-bundles with exclusions, list ONLY the kept items (the ones that won't be deleted by `applyExclusions`). Never list "all 999 skills" for an exclusion-heavy plugin — the user will panic.
4. **When to use it** — one concrete usage example framed as *purpose*, not *sequence*. Write *"use when auditing a page for accessibility issues"* or *"reach for this when you need live DOM inspection"*, NOT *"fires during the analyze stage of code review."* The user should understand what the tool is FOR, independent of any workflow ordering.
5. **Why picked** — one line on the match strength (e.g. "featured + 8 keyword matches", "only candidate with a purpose-built PubMed wrapper", or "local skill you installed yourself; matched 6 of the 7 UX-review keywords directly — strongest single-item score in the candidate pool")

Example format showing all three tag types, flat layout:

```
# Draft profile for: Systematic UX review of the ClaudeWorks Electron app

Here are the 6 tools this profile would give you (ordered by relevance to your request):

`local:uiux-toolkit` (local)
  What it is: Comprehensive UX/UI evaluation meta-skill — Nielsen heuristics,
    Gestalt principles, WCAG 2.2 compliance, Diátaxis doc framework.
  Enabled items:
    - skill: uiux-toolkit
  When to use it: Reach for this when auditing a page or component for usability,
    accessibility, and visual hierarchy issues. Covers 10+ evaluation methodologies.
  Why picked: Local skill you installed yourself; matched 6 of 7 UX-review
    keywords directly — strongest single-item score in the candidate pool.

`chrome-devtools-mcp@chrome-devtools-plugins` (featured)
  What it is: Browser devtools MCP server that lets Claude drive a running
    Chrome/Electron instance via CDP — inspect DOM, read console, capture screenshots.
  Enabled items:
    - skill: inspect-dom
    - skill: capture-screenshot
  When to use it: When you need to actually see what the UI is doing — measure
    spacing, capture visual state, inspect element trees, pull console errors.
    Requires the app to be running with --remote-debugging-port.
  Why picked: Only candidate with live browser inspection. Featured + 5 keyword matches.

`antigravity-awesome-skills@antigravity-awesome-skills` (2 of 999 enabled)
  What it is: Mega-bundle of 999 developer skills covering every language and tool.
  Enabled items (998 excluded):
    - skill: pubmed              — biomedical literature search via PubMed E-utilities
    - skill: huggingface-papers  — arXiv + HF paper fetch and summarization
  When to use it: Pubmed for biomedical literature lookup in your biomech research;
    huggingface-papers for the ML side. The other 997 skills are physically removed
    from the profile's config dir at launch — zero context cost.
  Why picked: Only catalog entry with a purpose-built PubMed wrapper. Mega-bundle
    rule applies: keep 2, exclude 997.

`frontend-design@claude-plugins-official` (featured)
  ...

`superpowers@claude-plugins-official` (featured)
  ...

[etc — one block per tool, flat, in rank order. No ## Stage headers. No
separate "Cross-cutting staples" section. Cross-cutting tools (planning,
git, debugging) just appear in the list wherever their rank score puts them.]
```

**Do not yet show:** model choice, effort level, customClaudeMd, `/workflow` body, `/tools` command, or profile name. Those all come in Step 7e. Step 7a is focused purely on *"here are the tools you'd get"* — keep it readable and exclusively about composition.

**If you applied the mega-bundle exclusion rule to any plugin**, explicitly mention the `(N of M enabled)` ratio and briefly explain the mechanism in the "When to use it" line (*"the other N skills are physically removed from the profile's config dir at launch — zero context cost"*). This prevents the user from reading "999 skills" and assuming the profile is bloated. The exclusion mechanism is counter-intuitive to anyone who hasn't seen it before; spell it out once per mega-bundle pick.

**Ordering rule:** use your Step 6a score as the primary sort key, descending. For ties, prefer (in order): featured > local > highest item count > alphabetical. This matches the tiebreaker rules in Step 6a so the presentation order is consistent with how the ranking step actually chose the picks.

### 7b. Discussion beat

After presenting, invite discussion explicitly. The goal here is to converge on the final tool set **before** the optional `/workflow` sequence question in 7c — separate "what tools" from "what sequence":

> *"That's the tool set. Tell me: any tools you want to swap out, any gaps you want me to fill, anything obviously missing? You can also ask me why I picked any specific tool over alternatives — I'll explain my reasoning or propose a different candidate from the retrieval pool. Once you're happy with the tools, I'll ask whether you want a /workflow command to orchestrate them."*

Handle the user's response patiently:

- **"Looks good"** → proceed to 7c
- **"Why X over Y?"** → re-run a supplemental retrieval if needed, explain the ranking rules that put X ahead (featured status, keyword match count, collection alignment, multi-stage leverage, local nudge), offer to swap if Y is a better fit for the user's actual work
- **"Swap X for Z"** → verify Z exists in `catalog.json` or `local-catalog.json`, confirm it's on-topic, swap it in, show the change
- **"Add something for <topic>"** → derive new keywords from the topic, run a supplemental pipe-intersection grep through `rank-items.js`, propose 1–3 candidates, let the user pick
- **"Remove X"** → remove X, note any role coverage that's now weaker, flag if it matters
- **"Tell me more about X"** → pull X's full catalog entry, summarize its skills/agents/commands at more depth, quote the `desc` field in full if helpful

Stay in this loop until the user signals they're done. Do not proceed to 7c until the plugin composition is explicitly locked. Do not batch the next question onto the end of a swap — give the user a distinct conversational turn to say "anything else" before moving on.

### 7c. Ask whether a `/workflow` command is wanted

Now and only now, ask. Never assume — always explicit, and explain what it is so the user can make an informed choice:

> *"Optional next step: I can draft a `/workflow` command for this profile. It's a dormant slash command — type `/workflow` in a session and Claude walks through a specific orchestration of the tools we just picked (for example, for your feature-development work, it might be plan → scaffold → implement → verify → ship, firing specific tools at each step). Useful when you want predictable multi-step flows on demand rather than reinventing the sequence each time. Want one, or skip it?"*

- **User says skip** → proceed to 7e
- **User says yes** → proceed to 7d
- **User asks "what would it look like?"** → sketch a one-paragraph version from the workflow shape's stages, then ask the question again
- **User asks about named variants** (e.g. *"can I also have `/workflow-debug` and `/workflow-ship`?"*) → answer: *"Yes, but variant collection happens after the profile is created. Let's lock in the default `/workflow` first, then once the profile exists you can re-run `create-workflow` in standalone mode and I'll collect named variants there."* Then continue as if they said yes to the default `/workflow`.

### 7d. Hand off to `create-workflow` to sequence the tool set

**Preflight:** before invoking `create-workflow`, clear any stale workflow-body temp file from a previous run in the same shell with `rm -f "${TMPDIR:-/tmp}/claudeworks-pending-workflow.md"`. This guarantees Step 8's `cat` sees either a fresh file (user went through the workflow) or no file at all (user opted out), never a stale body from a prior session.

The actual stage-by-stage sequencing lives in the **`create-workflow`** skill (also in this `profiles-manager` plugin). Don't duplicate that logic here — hand control over with a context block so `create-workflow` can skip its own profile-selection and shape-picking steps and go straight into interactive sequencing using the plugins and shape you already locked in.

Emit the handoff context block verbatim, in exactly this shape, substituting your locked state:

```
CREATE_WORKFLOW_CONTEXT
{
  "profileDescription": "<profile_description from Step 0>",
  "profileName": "<P_NAME you're about to write — if not yet locked, use a placeholder and update once 7e sets it>",
  "pickedPlugins": [
    {"id": "frontend-design@claude-plugins-official", "displayName": "frontend-design",
     "enabledItems": {"skills": ["frontend-design"], "commands": [], "agents": []}},
    ...
  ],
  "shapeId": "<the shape id you picked in Step 3, e.g. 'feature-development'>",
  "stages": [
    {"id": "plan", "name": "Plan", "intent": "...", "keywords": ["..."]},
    ...
  ]
}
END_CREATE_WORKFLOW_CONTEXT
```

Then announce the handoff in one line — *"Handing off to the `create-workflow` skill to co-design the `/workflow` body with you."* — and invoke the skill. `create-workflow` will detect the context block, skip its standalone flow, and run Step 3 (interactive sequencing) directly. It does not write to `profiles.json` in parent mode — instead it stashes the final body in a temp file at:

```
<$TMPDIR>/claudeworks-pending-workflow.md
```

(Resolve `$TMPDIR` via Bash when you need to read the file; fall back to `/tmp` if unset.) **Past runs printed `WORKFLOW_BODY_BEGIN/END` marker lines to the user — that contract is gone. Do not look for those markers in `create-workflow`'s output, do not print them yourself.** The temp file is the only handoff channel.

`create-workflow` will also transition **in the same assistant turn** into asking the Step 7e questions (profile name first). You are not waiting for a separate user turn — the child skill drives straight into 7e on your behalf. Answer the Step 7e questions as you normally would; the temp file will be read by Step 8 when it builds the `write-profile.js` command. Specifically:

- **When Step 8 is about to build the `P_WORKFLOW` value**, `cat` the temp file with Bash. If the file is missing or empty, the user opted out — leave `P_WORKFLOW` unset and Step 8 will write the profile with no `/workflow` command. If the file has content, set `P_WORKFLOW` to its contents via a heredoc-fed env var (same shape as `create-workflow`'s standalone mode) so newlines and shell specials survive.
- After Step 8 succeeds, delete the temp file with `rm -f` so a subsequent `create-profile` run in the same shell starts clean. If the `rm` fails (file already gone), ignore it.

Do not re-ask the workflow question, do not re-sequence stages, and do not re-ask for the profile name after `create-workflow` already asked — duplicating those produces confusing double-prompts.

### 7e. Final settings (administrative)

After plugins and `/workflow` are locked, collect the remaining fields. Ask each as a distinct question, not a batched form:

1. **Profile name** — *"What should I call this profile? Short and no-spaces is easiest (e.g. `frontend-dev`, `bug-triage`). It mustn't collide with existing profile names: [list from Step 1d]."*
2. **Model** — present your provisional pick from Step 6c with a one-line justification: *"I was planning to use `claude-opus-4-7` because feature-development is deep-reasoning work and your project is non-trivial. Does that work, or do you want `claude-sonnet-4-6` (faster, cheaper) or `claude-haiku-4-5-20251001` (fastest, best for simple loops)?"*
3. **Effort level** — same pattern: *"For effort I'd suggest `high` because [reason]. `medium` or `low` also valid if you want lighter reasoning."*
4. **customClaudeMd** — opt-in, with a specific recommendation:
   - If `existingAIConfig.hasClaudeMd` is true: *"Your project already has a `CLAUDE.md`, so I'd leave the profile's custom instructions slot empty to avoid duplication. Keep it empty, or add something profile-specific the project CLAUDE.md doesn't cover?"*
   - Otherwise: *"The profile can carry its own always-on instructions appended to every session's context. Want me to draft something profile-specific based on the picks we made, or skip it?"*
5. **`/tools` command** — opt-in, default-leaning-yes:

   > *"Optional: I can also generate a `/tools` command for this profile — a persistent slash command you can type in any session to see this exact tool breakdown. Think of it as a bookmark: the same 'here are your tools, what each one does, and when to use each' view you saw in Step 7a, always one command away. Useful if you come back to the profile weeks later and forget what's in it. Costs nothing at runtime — it's a dormant slash command that loads zero context until you invoke it. Want one?"*

   - **User says yes** → build the `/tools` body. Reuse the same compact block format from Step 7a (plugin ID + tags, what it is, enabled items, when to use it) but **drop the "Why picked" line** — that's scoring meta-commentary the user doesn't need after the fact. Add a short header (`# Tools in this profile`, `Profile: <name> — <description>`) and a footer (`_Generated by create-profile on <ISO date>. Re-run the skill to rebuild this reference._`). Pass the full assembled markdown as `P_TOOLS` in the Step 8 write command, and the Electron app will write it to `commands/tools.md` during profile assembly so `/tools` is available from first launch.
   - **User says skip** → leave `P_TOOLS` unset; no `/tools` command gets created. They can always re-run the skill later to generate one.

6. **Optional fields** — target directory, alias, tags, launch flags. Mention once, don't interrogate: *"Anything else — target directory, alias, tags, launch flags? Skip if you don't care."*

### 7f. Final confirmation

Show the complete profile as a compact summary. Include all the locked fields so the user can see the full shape before the write happens:

- description
- workflow shape(s) used internally for retrieval + sequencing
- plugin count (with a count of any mega-bundle exclusions applied)
- model + effort
- customClaudeMd status (set or empty, with one-line reason)
- `/workflow` status (set or skipped)
- `/tools` status (set or skipped)
- profile name

Then ask:

> *"Here's the final profile. Anything to change before I check for missing plugin installs and write it?"*

Accept tweaks (jump back to the relevant sub-step if needed), then proceed to Step 7.5.

## Step 7.5 — Install missing plugins

Before writing the profile, check whether any of the final plugin picks are not yet installed on this machine. Build the list of "missing plugins" by:

1. Starting from the final plugin IDs from Step 7f
2. **Filtering out every plugin ID that starts with `local:`** — local plugins live under `~/.claude/skills/`, `~/.claude/agents/`, or `~/.claude/commands/` by definition, so they are *already* on disk. Running `claude plugin install local:uiux-toolkit` is a nonsense operation and the install script would fail. Exclude them from the check entirely.
3. **Filtering out every plugin ID that starts with `framework:`** — framework plugins (GSD, gstack, etc.) are synthetic wrappers around user-installed frameworks that are managed outside the standard plugin installer. The Electron app handles their activation via separate logic; they never flow through `claude plugin install`.
4. Subtracting the `installed` list captured in Step 1d from the remaining marketplace-only plugin IDs.

If the final "missing marketplace plugins" list is empty after the filters, skip this step entirely and go to Step 8.

Otherwise, present the missing plugins and ask:

> *"Your profile references N plugins that aren't installed on this machine yet:*
> - *`<plugin-id-1>` — <one-line description from catalog>*
> - *`<plugin-id-2>` — <one-line description>*
> 
> *Want me to install these now so the profile launches cleanly? I'll use the same CLI commands the ClaudeWorks app uses when you click Install in the Browse tab. If you skip, the profile will still be written, but you'll need to install these from the Browse tab in the app before first launch."*

- **User says skip** → proceed to Step 8. The two-step-flow reminder in Step 9 will still mention the missing installs.
- **User says yes** → run the install block below.

### Install block

The install is handled by a helper script at `$CLAUDE_PLUGIN_ROOT/scripts/install-plugins.js`. It mirrors the Electron app's `installPlugin` and `addMarketplace` functions from `src/electron/core.ts`, and encodes two load-bearing details:

1. **It resolves the real `claude` binary by walking PATH and skipping `~/.claudeworks/bin`.** The profiles bin directory contains alias scripts (including the `claude-default` alias, which is *designed* to intercept bare `claude` invocations) that hardcode their own `CLAUDE_CONFIG_DIR` inline on the command line. If you reach `claude` through PATH in this environment, the alias wins and the plugin installs into the wrong config dir. The helper always calls the real binary by absolute path.
2. **It sets `CLAUDE_CONFIG_DIR=$HOME/.claude`** on the subprocess env so installs land in the central `~/.claude/plugins/` location, which is where every profile sources plugins from. Without this override, installs would go to whatever profile-scoped `CLAUDE_CONFIG_DIR` the current session happens to have.

Build the `MISSING_PLUGINS` JSON array inline. For each missing plugin, include its `id`, its `marketplaceId` (short id from catalog.json, e.g. `claude-plugins-official`), and its `sourceUrl` from catalog.json (used to derive the `owner/repo` to pass to `plugin marketplace add`). Prefix the bash command with the variable assignment so the helper script sees it via `process.env.MISSING_PLUGINS`.

Example — **inline the JSON directly in the command** rather than trying to reference a shell variable from a previous step:

!`MISSING_PLUGINS='[{"id":"frontend-design@claude-plugins-official","marketplaceId":"claude-plugins-official","sourceUrl":"https://github.com/anthropics/claude-plugins"},{"id":"pw@claude-code-skills","marketplaceId":"claude-code-skills","sourceUrl":"https://github.com/someone/claude-code-skills"}]' node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/scripts/install-plugins.js" 2>&1`

Use single quotes around the JSON array so the embedded double-quotes don't collide with bash's own double-quote parsing. Substitute the actual plugin metadata from the profile draft (not the example IDs above) when you run the command.

The script output is a JSON object of the form `{"ok": true, "realClaude": "<path>", "results": [{"id": "...", "ok": true|false, "error": "..."}]}`. Parse it and handle each plugin:

- **Success** → confirm to the user (*"Installed `<plugin-id>` ✓"*)
- **Failure** → show the error, then ask whether to (a) retry that plugin, (b) skip it and note in the profile that the install is pending, or (c) abort the whole write so the user can investigate before creating a half-broken profile

Once all installs are handled (success, skipped, or the user accepted the partial state), proceed to Step 8.

## Step 8 — Write the profile

The write is handled by `$CLAUDE_PLUGIN_ROOT/scripts/write-profile.js`. The script validates `P_NAME` before touching `profiles.json` and refuses to write if it's missing, empty, or contains path separators — mirroring the same guarantees the Electron app's `validateProfileName` enforces on its IPC path. This is load-bearing: the prior inline version silently wrote `store.profiles[undefined] = partialProfile` whenever `P_NAME` was unset, which broke the Electron app's `loadProfiles()` and left it hanging at "loading plugins".

**Inline all `P_*` variables on the same command line as the script invocation** — don't try to `export` them in a previous step and then run the script, because each `!` command runs in its own shell. Example:

!`P_NAME='my-profile' P_PLUGINS='["frontend-design@claude-plugins-official"]' P_EXCLUDED='{}' P_DISABLED_MCP='{}' P_DESC='Frontend work' P_MODEL='' P_EFFORT='' P_INSTRUCTIONS='' P_WORKFLOW='' P_TOOLS='' node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/scripts/write-profile.js" 2>&1`

Substitute the actual values from the profile draft. Required: `P_NAME`. Optional (leave empty string if not used): `P_PLUGINS` (JSON array of plugin IDs), `P_EXCLUDED` (JSON object `{"pluginId": ["item-name-1", "item-name-2", ...]}` — a **flat array of bare item names** per plugin ID; items to *exclude* from each plugin; leave as `'{}'` to enable everything in every plugin), `P_DESC`, `P_MODEL`, `P_EFFORT`, `P_INSTRUCTIONS`, `P_WORKFLOW`, `P_TOOLS` (markdown body of the `/tools` command if the user opted in at Step 7e; leave empty string to skip generating the command), `P_DISABLED_MCP` (JSON object for disabling MCP servers — see below).

**Note on `disabledMcpServers`:** the profile engine defaults to *enabling* all user-level MCP servers (from `~/.claude.json` and `~/.mcp.json`). If the user's prompt specifies which MCP servers to enable (e.g. "use exa, firecrawl, reddit and hn"), compute the disable list as: all available user MCP servers MINUS the ones the user wants. To discover available MCPs, run:

!`node -e "const fs=require('fs'),os=require('os'),p=require('path');const cj=p.join(os.homedir(),'.claude.json');const mj=p.join(os.homedir(),'.mcp.json');const servers=new Set();try{const d=JSON.parse(fs.readFileSync(cj,'utf-8'));for(const k of Object.keys(d.mcpServers||{}))servers.add(k)}catch{}try{const d=JSON.parse(fs.readFileSync(mj,'utf-8'));for(const k of Object.keys((d.mcpServers||{})))servers.add(k)}catch{}console.log(JSON.stringify([...servers].sort()))" 2>&1`

This outputs a JSON array of all user-level MCP server names. Build `P_DISABLED_MCP` as `{"__user__": ["server-a", "server-b"]}` — the `"__user__"` key controls global MCP toggles. Servers NOT in this array remain enabled. If the user didn't mention MCP preferences, leave as `'{}'` (all MCPs enabled).

The script outputs a single-line JSON object:

- **Success** → `{"ok": true, "name": "<name>", "pfPath": "<path>"}` — proceed to Step 9.
- **Failure** → `{"ok": false, "error": "<reason>"}` — stop and tell the user what went wrong. Common causes: `P_NAME` not set (you forgot to include it on the command line), `P_PLUGINS` not valid JSON (check the quoting), or the home directory is not writable.

**Note on `excludedItems`:** the profile engine defaults to *including* all items from each enabled plugin. Populate `P_EXCLUDED` in two cases:

1. **The user explicitly opted out of specific items during Step 7b discussion.** Pass through whatever they asked for.
2. **You applied the mega-bundle rule in Step 6a.** For every plugin where `counts > 15` and only 1–3 items matched retrieval, you should have built the exclude list in Step 6c using the enumeration recipe there (`grep -hE '"plugin":"<id>"' items.ndjson`, extract last segment of each `id`, subtract the kept items). Pass that exclude list through here — one entry per mega-bundle plugin, each value a flat array of bare item names.

The write script validates the schema: each value must be a flat array of strings. The old nested `{skills:[], agents:[], commands:[]}` form is rejected — `applyExclusions` in the Electron app reads a flat list and filters skills, agents, and commands uniformly against the same set. If you accidentally construct the nested form, `write-profile.js` will fail with a descriptive error and the profile will not be written.

## Step 9 — Report back and flag the two-step flow

The skill has only written the profile entry to `profiles.json`. The profile is **not yet usable** until the user finishes setup in the ClaudeWorks app. Tell the user clearly:

1. The profile entry has been saved to `profiles.json`.
2. **Open the ClaudeWorks app.** If the app was already running while this skill wrote the profile, it's reading from an in-memory cache of `profiles.json` and won't know about the new entry yet — **click the refresh button in the top-right of the app** to force a re-read. Once the new profile shows up in the sidebar list, either save or launch it from the editor. That save/launch is what actually assembles the config directory, seeds credentials, and writes the `/workflow` command file (if they added one).
3. They may also want to set a **target directory** and any other fields the skill didn't cover (alias, tags, launch flags) from the profile editor. The write script doesn't expose those, so the app is the only place to set them.
4. If the profile includes any plugins that are not yet installed (i.e. not in the `installed` list from Step 1d), remind them to **install those from the app's Browse tab first**, otherwise the profile will launch broken. (If the user opted in at Step 7.5 and the installs succeeded, this is already handled.)

---

## Important notes

- **Plugin IDs use one of three formats depending on source:** `<name>@<marketplace>` for curated marketplace plugins (e.g. `frontend-design@claude-plugins-official`), `local:<name>` for user-installed local skills/agents/commands from `~/.claude/` (e.g. `local:uiux-toolkit`), and `framework:<name>` for synthetic framework wrappers (e.g. `framework:gsd`). Mix all three freely in the same profile — `plugins[]` in `profiles.json` accepts any of them and the Electron app's plugin loader routes each format correctly at session launch.
- **Local plugins are first-class citizens, not a fallback.** Every session must run Step 1e to enumerate local skills and include them in retrieval alongside the marketplace catalog. Missing the local scan produces all-marketplace profiles that silently skip tools the user already installed and relies on. The iteration-1 `ux-review` test run missed this exact case and had to verbally disclaim `local:uiux-toolkit` — don't repeat that.
- **Mega-bundle plugins (total counts > 15) are first-class picks via the exclusion lever.** Do NOT reject them on cognitive-load grounds. `excludedItems` is physical filesystem pruning — `applyExclusions()` in `src/electron/core.ts:1589` deletes excluded items from disk before session launch, so unused skills contribute zero context. A 999-skill plugin with 997 exclusions has the same runtime footprint as a 2-skill plugin. The cognitive-load rubric applies to *effective item count after exclusions*, not raw plugin size. See Step 6a for the rule and Step 6c for the computation recipe.
- **`excludedItems` is a flat array of bare item names per plugin ID.** `{"plugin@mkt": ["skill-a", "skill-b"]}`. The nested `{skills:[], agents:[], commands:[]}` form does not exist — `applyExclusions` filters all item kinds against the same flat set. `write-profile.js` validates the schema and refuses to write a profile with the wrong shape.
- **The skill writes `profiles.json` and, with user consent, installs missing plugins.** Config directory assembly, credential seeding, and `/workflow` command file generation still happen when the profile is saved or launched from the ClaudeWorks app — not when this skill runs. But plugin installation is now handled inline in Step 7.5 using the same CLI commands the app uses internally.
- **Do not read the marketplace catalog in full.** Always filter via `grep` and `jq`. The full `items.ndjson` is ~2.6 MB; the full `catalog.json` is ~450 KB. Reading either whole will blow your context budget.
- **Workflow shapes are hints, not gates.** If a user's work genuinely doesn't match any shape, synthesize a custom one with 4–6 stages. Do not force a bad fit.
- **Never draft the `/workflow` body unilaterally.** It's always co-designed in Step 7d, and only if the user explicitly opts in at Step 7c. A thoughtful, collaborative `/workflow` beats an auto-drafted one every time — the orchestration depends entirely on how the specific user thinks about their work, and auto-drafting it is exactly the wrong kind of confidence.
- **Capture the profile description first, not last.** Step 0 is not ceremony — it's the anchor every downstream decision grounds against. A vague description produces a vague profile.
- **Respect existing project `CLAUDE.md`.** If Layer 0 flagged it, recommend keeping the profile's `customClaudeMd` empty unless the user explicitly wants profile-level additions on top.
- **Multi-shape blending is expected.** Real users often do multiple workflows (build + review, research + write). Two shapes is fine; three or more is a smell.
- **Bespoke, not generic.** Two users who both describe "frontend dev" should get meaningfully different profiles, because their tech stacks, project inference, specific tooling, and *how they actually work* all differ. Your job is to reflect the individual, not the archetype.
- **Gap flags are better than fake matches.** If a stage has no confident match, say so explicitly in Step 7a. A profile with an honest gap is better than one with a confident-sounding wrong pick.
- **The install step must bypass `claude-default`.** The `~/.claudeworks/bin/claude-default` alias (and others) intentionally intercepts bare `claude` invocations and hardcodes its own `CLAUDE_CONFIG_DIR`. The Step 7.5 install block handles this by resolving the real binary via absolute path (skipping `~/.claudeworks/bin`) and explicitly setting `CLAUDE_CONFIG_DIR=$HOME/.claude`. Do not replace that block with a naive `claude plugin install` — it will silently install to the wrong config dir.

## Self-critique checklist (reference)

Keep this in mind during Step 6d. Revise the draft once if any of these fail; don't loop.

1. Stage coverage — every stage has at least one pick (or an explicit gap flag)
2. Redundancy — no duplicate coverage of the same role
3. Conflict — no colliding slash commands or hooks
4. Cognitive load — 4–10 plugins total
5. Model + effort fit — complexity matches settings (provisional; user will confirm in 7e)
6. Respects existing project config (`CLAUDE.md`, `.mcp.json`)
7. Ready for discussion — each pick has a one-sentence rationale the user can push back on
8. Honest gap flags where retrieval was thin
