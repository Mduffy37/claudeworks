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

Before running any inference or retrieval, lock a one-line description for this profile. This text appears next to the profile name in the Claude Profiles app's sidebar and anchors every downstream decision — shape matching, keyword derivation, presentation rationale all reference it.

Read the user's initial message. If it already contains enough signal to draft a plausible description (e.g. *"I'm building frontend features on this app — React + TS, Tailwind, Playwright"* becomes *"Frontend feature development on a React/TS/Tailwind solo project"*), draft one and present it for a single-beat confirmation:

> *"Before I run project inference, let me lock a one-line description for this profile (it'll show up next to the profile name in the Claude Profiles app). How about: 'Frontend feature development on a React/TS desktop app'? Sound right, or do you want a different wording?"*

Accept the user's confirmation or revision. Store the final description as the `profile_description` you'll reference in Step 3 (shape matching), Step 7a (presentation header), and Step 8 (as `P_DESC` when writing to `profiles.json`).

If the user's initial message is too thin to draft from (e.g. *"I want a profile"* or *"make me a profile"*), ask directly:

> *"What's this profile for, in one line? It'll show up in the profile list — something like 'Frontend features on my React app' or 'PR review for the backend team'. Be as specific as you want."*

Do not move on from Step 0 until the description is locked. A vague description produces a vague profile; you can recover from a weak Layer 0 signal bundle, but you cannot recover from a user whose intent you never understood.

## Step 1 — Gather inputs

Run these commands and keep their outputs in mind throughout the rest of the flow. They are your entire world-model for this session.

### 1a. Project inference (Layer 0)

Every shell command in this skill needs to reach files inside the plugin's own directory (`scripts/`, `data/`). In many Claude Code contexts the `$CLAUDE_PLUGIN_ROOT` env var is set to that directory automatically, but some contexts (including the Claude Profiles app's built-in plugin load path) leave it unset. To be robust in both cases, **every** `!` bash command below uses the POSIX parameter expansion `${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}` — it uses the env var if set, otherwise falls back to the stable installed-plugin path. Do not simplify this to a bare `$CLAUDE_PLUGIN_ROOT` or the skill will break on anyone whose runtime doesn't set it.

!`node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/infer-project.js" "$PWD" 2>&1`

This emits a single-line JSON signal bundle. Parse it and note:

- `mode` — `"project"` or `"generic"`. Generic means the skill was launched from `$HOME`, an empty directory, or a directory with no recognizable manifests.
- `confidence` — `"high"`, `"medium"`, `"low"`, or `"generic"`. This drives how much clarification you ask for in Step 2.
- `languages`, `frameworks`, `keyDependencies`, `tooling`, `testFrameworks`, `infra` — the tech context. You will fold these into retrieval keywords in Step 4.
- `existingAIConfig` — note especially `hasClaudeMd`, `hasAgentsMd`, `hasMcpConfig`. If the project already has a `CLAUDE.md`, respect it: do not duplicate its instructions in the profile's `customClaudeMd` slot later.
- `projectPurpose` — the first paragraph of the README, if any. Use it to ground your understanding of what the user is actually building.

### 1b. Workflow shapes

!`cat "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/data/workflow-shapes.json"`

This is the curated inventory of 12 workflow shapes. Each shape describes the *stages* of a kind of work (e.g. feature-development, code-review, security-audit), independent of tools or tech stack. You will match the user's intent to 1–2 shapes in Step 3. Shapes are **hints, not gates** — you may blend two shapes, synthesize a custom shape if nothing fits, or ignore them entirely for genuinely novel work.

Pay attention to each shape's `signals` (for user-intent matching), `stages` (for retrieval), `commonBlends` (for multi-hat users), and `rationale` (for understanding when each shape applies).

### 1c. Marketplace catalog — cache and fetch

The recommender needs two files from the `claude-profiles-marketplace` repo: `catalog.json` (plugin-level digest) and `items.ndjson` (item-level grep stream). They are cached locally at `~/.claude-profiles/marketplace-cache/` with a 24-hour TTL. Run the helper script to populate the cache if needed:

!`node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/fetch-marketplace-cache.js" 2>&1`

The script output is a single-line JSON object of the form `{"cacheDir": "...", "files": {"catalog.json": "<status>", "items.ndjson": "<status>"}}`. Possible status values per file:

- `cache-hit` — the file was already fresh in `~/.claude-profiles/marketplace-cache/` (within the 24h TTL); no fetch needed
- `fetched-auth` — the file was freshly downloaded via `api.github.com` using an auth token discovered from `GITHUB_TOKEN` / `GH_TOKEN` / `gh auth token`
- `fetched-anon` — the file was freshly downloaded anonymously (only works if the marketplace repo is public)
- `sibling-fallback` — the file was copied from `$CLAUDE_PROFILES_MARKETPLACE_DIR` (developer escape hatch)
- `UNAVAILABLE` — no fallback worked; the caller (you) must surface an actionable error

Parse the output. If either file shows `UNAVAILABLE`, stop and tell the user that the marketplace catalog cannot be reached. The `claude-profiles-marketplace` repo is currently private, so anonymous access does not work. The user needs **one** of the following:

1. **Install and authenticate the `gh` CLI** — run `gh auth login` once. This is the simplest path for most users and the skill will use the preferred authenticated `gh api` path.
2. **Set a `GITHUB_TOKEN` environment variable** — a Personal Access Token with `repo` scope, created at https://github.com/settings/tokens. Useful if the user doesn't want to install `gh`. The skill will fall through to native `fetch` with that token.
3. **Set `CLAUDE_PROFILES_MARKETPLACE_DIR`** — point at a local clone of the marketplace repo. This is a developer escape hatch only.

Do not proceed without the catalog. Suggest the first option unless the user has a specific reason to prefer another.

The `cacheDir` is always at `~/.claude-profiles/marketplace-cache/`. Use that full path directly in the retrieval commands below — do not use a `$CACHE` placeholder, because Claude Code's `!` bash execution does not define that variable and it will expand to an empty string, breaking the path. The two files you will reference are `~/.claude-profiles/marketplace-cache/catalog.json` and `~/.claude-profiles/marketplace-cache/items.ndjson`.

### 1d. Installed plugins and existing profiles

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const pfPath=path.join(os.homedir(),'.claude-profiles','profiles.json');
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

!`node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/list-local-plugins.js" 2>&1`

The script writes two files alongside the marketplace cache and prints a single-line summary to stdout:

- `~/.claude-profiles/marketplace-cache/local-catalog.json` — plugin-level digest in the same shape as `catalog.json`, with `marketplace: "local"` on every entry and IDs like `local:uiux-toolkit`
- `~/.claude-profiles/marketplace-cache/local-items.ndjson` — item-level NDJSON stream in the same shape as `items.ndjson`, one JSON object per line

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

## Step 4 — Per-stage retrieval (Layer 2)

For each stage of your chosen shape(s), derive a retrieval query and run it against the cached `items.ndjson` grep stream. The retrieval pattern uses a **pipe intersection** (stage keywords AND tech context), which gives dramatically higher precision than a single OR-grep across both keyword sets.

### 4a. Build two keyword groups per stage

Group A — **stage keywords** (from workflow-shapes.json):

- `stage.keywords` — the stage's own keyword list (typically 5–8 words)
- Plus any tools the user explicitly mentioned in Step 2 (e.g. "I use Playwright" → add `playwright`)

Group B — **tech context** (from Layer 0, project mode only):

- `signal_bundle.languages`
- `signal_bundle.frameworks`
- `signal_bundle.keyDependencies.slice(0, 5)` (top 5 deps — cap to avoid noise)
- `signal_bundle.tooling` (for stages where tooling is load-bearing, e.g. `verify`)

Join each group with `|` to form a regex alternation. Example for the `implement` stage of a TypeScript/React/Electron project:

- Group A: `(implement|write|code|wire|integrate|develop)`
- Group B: `(typescript|react|electron|tsx|frontend)`

### 4b. Run the intersection grep

For each stage, construct a command of the following shape, then run it via `!`. The command pipes Group A (stage keywords) through Group B (tech context), which is what gives the intersection its precision. It grep-reads **two** NDJSON files together — the local `local-items.ndjson` Step 1e generated *and* the marketplace `items.ndjson` — with `local-items.ndjson` listed **first** so local items always appear in the head before marketplace items crowd them out:

```
grep -hiE '(<stage keyword 1>|<stage keyword 2>|...)' \
  ~/.claude-profiles/marketplace-cache/local-items.ndjson \
  ~/.claude-profiles/marketplace-cache/items.ndjson \
  | grep -iE '(<tech keyword 1>|<tech keyword 2>|...)' \
  | node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/rank-items.js" '<all keywords from both groups, joined with |>' \
  | head -60
```

**Load-bearing details:**

- `grep -h` (the `h` flag) suppresses grep's default "filename:" prefix when reading multiple files. Without it, each line gets `<path>:` prepended, which breaks JSON parsing downstream. Always use `-h` on the first grep. The second grep in the pipe doesn't need `-h` because its input is stdin, not multiple files.
- **File order matters as a tiebreaker.** `local-items.ndjson` MUST come first, `items.ndjson` second. `rank-items.js` uses a stable sort, so items with the same keyword-match score preserve their input order — which means local items stay ahead of alphabetically-earlier marketplace items on ties. Without the local-first ordering, local items would lose all ties to marketplace items from `aaa`-prefixed marketplace IDs, which is how iteration-1 testing lost `local:uiux-toolkit` from its candidate pool.
- **`rank-items.js` is the critical stage** that prevents alphabetical pollution. Without it, `head -60` takes the first 60 matches in *file order* — meaning early-alphabet marketplace IDs systematically crowd out late-alphabet ones, regardless of relevance. With it, every line is scored by **distinct keyword match count against the `desc` + `id` fields** (case-insensitive), sorted descending, and THEN head-capped — so the top 60 are genuinely the top 60 by relevance. Do not remove this stage or the retrieval pipeline silently reverts to alphabetical ordering.
- **The keyword argument to `rank-items.js` must be the UNION of both groups**, joined with `|`. If Group A is `(implement|code|wire)` and Group B is `(react|typescript|electron)`, then pass `'implement|code|wire|react|typescript|electron'` to rank-items. The script then scores each grep-matched line by how many of those 6 distinct keywords appear in its `desc`/`id`/`plugin` fields.
- **You must substitute the keyword groups with the actual words you built in Step 4a before running.** Do not run the command above with `<stage keyword 1>` literally — those angle brackets are placeholders, not shell tokens. Do not use a `$CACHE` variable anywhere; always write out the full cache paths literally.

Concrete example for a TypeScript/React/Electron project's `implement` stage — run something like this (with *your* actual keywords, not these):

!`grep -hiE '(implement|write|code|wire|integrate|develop)' ~/.claude-profiles/marketplace-cache/local-items.ndjson ~/.claude-profiles/marketplace-cache/items.ndjson | grep -iE '(typescript|react|electron|tsx|frontend)' | node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/rank-items.js" 'implement|write|code|wire|integrate|develop|typescript|react|electron|tsx|frontend' | head -60`

Only items that match **both** the stage intent and the tech context survive the two greps, and the 60 that reach the head cap are the 60 with the highest distinct-keyword match counts — so you see the *best* matches regardless of which marketplace letter they come from. In practice this narrows a ~6000-entry index (plus however many local items the user has) to 60 candidates sorted by relevance.

**You can still double-check in Step 6a.** The scoring formula there applies additional signals (featured status, collection alignment, multi-stage leverage, local nudge) on top of the raw keyword count `rank-items.js` computes. The pre-sort gives you a good starting order; Step 6a refines it.

### 4c. Fallback for generic mode and cross-cutting staples

In **generic mode** (`mode: "generic"` in the Layer 0 bundle), or when Group B is empty because Layer 0 couldn't find any tech context, fall back to a single grep with only Group A — but still read both files with `local-items.ndjson` first for tiebreaker ordering, and still pipe through `rank-items.js` so the head cap preserves relevance:

```
grep -hiE '(<stage keyword 1>|<stage keyword 2>|...)' \
  ~/.claude-profiles/marketplace-cache/local-items.ndjson \
  ~/.claude-profiles/marketplace-cache/items.ndjson \
  | node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/rank-items.js" '<stage keywords, joined with |>' \
  | head -60
```

Note: in generic mode the keywords passed to `rank-items.js` are just the stage keywords — there's no Group B to merge in, because Layer 0 didn't produce tech context.

Concrete example for a `research` stage in generic mode — run something like this with *your* actual keywords:

!`grep -hiE '(research|investigate|compare|survey|evaluate|source|prior art)' ~/.claude-profiles/marketplace-cache/local-items.ndjson ~/.claude-profiles/marketplace-cache/items.ndjson | node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/rank-items.js" 'research|investigate|compare|survey|evaluate|source|prior art' | head -60`

Retrieval is broader per stage, but workflow shapes still constrain composition. The same alphabetical-order warning from 4b applies — rank in Step 6a, never trust file order.

**Also use the single-grep fallback when retrieving cross-cutting staples in Step 6b** — staples like planning, git workflow, and debugging tools are meant to be general-purpose, so narrowing them by tech context is counterproductive.

### 4d. Parse and collect

Each line of output is a JSON object with `{kind, id, plugin, desc, sourceUrl}`. Parse and collect them as candidate items for that stage. Cap at ~60 hits per stage — this is deliberately more than you'll eventually use, because the scoring step in Step 6a trims to the top ~15 based on relevance (not file order). If a stage returns fewer than ~5 hits, either (a) broaden Group A with synonyms you derive from the stage's `intent` field, or (b) note the gap and continue — you will flag it explicitly in the self-critique and presentation steps.

### 4e. Collect unique plugin IDs

Across all stage retrievals, collect the **unique set of plugin IDs** that appeared in any hit. You will typically end up with 20–40 unique plugins across 4–6 stages. This is your candidate plugin pool for Step 5.

## Step 5 — Plugin-level lookup

For the unique plugin IDs you collected in Step 4e, pull their full catalog entries using `jq`. **Split the candidate pool into two groups by source before looking up:**

- **Marketplace plugin IDs** — the format is `<pluginName>@<marketplaceId>` (e.g. `frontend-design@claude-plugins-official`). Look these up in `catalog.json`.
- **Local plugin IDs** — the format starts with `local:` (e.g. `local:uiux-toolkit`, `local:gsd`). Look these up in `local-catalog.json` (the file Step 1e wrote).

Run jq once per source with the same shape of command, using `--arg ids` to pass a comma-joined string into jq, which splits it and membership-tests each plugin's `id`.

### 5a. Marketplace lookup

```
jq --arg ids '<marketplace-plugin-id-1>,<marketplace-plugin-id-2>' \
   '[.plugins[] | select(.id as $id | ($ids | split(",")) | index($id))]' \
   ~/.claude-profiles/marketplace-cache/catalog.json
```

**Substitute the angle-bracketed placeholders with your actual comma-joined plugin ID list before running.** Do not run the command with `<marketplace-plugin-id-1>` literally — those are placeholders.

Concrete example — if your marketplace candidates were `frontend-design@claude-plugins-official`, `chrome-devtools-mcp@chrome-devtools-plugins`, and `feature-dev@claude-plugins-official`, you would run:

!`jq --arg ids 'frontend-design@claude-plugins-official,chrome-devtools-mcp@chrome-devtools-plugins,feature-dev@claude-plugins-official' '[.plugins[] | select(.id as $id | ($ids | split(",")) | index($id))]' ~/.claude-profiles/marketplace-cache/catalog.json`

### 5b. Local lookup

Same command shape against `local-catalog.json`:

```
jq --arg ids '<local-plugin-id-1>,<local-plugin-id-2>' \
   '[.plugins[] | select(.id as $id | ($ids | split(",")) | index($id))]' \
   ~/.claude-profiles/marketplace-cache/local-catalog.json
```

Concrete example — if your local candidates were `local:uiux-toolkit` and `local:gsd`, you would run:

!`jq --arg ids 'local:uiux-toolkit,local:gsd' '[.plugins[] | select(.id as $id | ($ids | split(",")) | index($id))]' ~/.claude-profiles/marketplace-cache/local-catalog.json`

Merge the results from 5a and 5b into a single candidate-pool list. For each plugin, you now have `displayName`, `description`, `featured` (always `false` for locals), `collections` (always `[]` for locals), `counts`, `topKeywords` (may be empty for locals), and `sourceUrl` (a `file://` path for locals). You have enough plugin-level context to rank candidates within each stage and make informed composition decisions.

Skip 5a entirely if no marketplace candidates surfaced. Skip 5b if no local candidates surfaced. It's normal for either to be empty depending on the user's tech stack and what they've installed locally.

## Step 6 — Composition and self-critique (Layer 3)

### 6a. Per-stage selection (explicit scoring, not file order)

For each stage, you have ~60 candidate items from Step 4b. **Do not pick winners based on the order they appeared in the grep output** — that's file order (alphabetical by marketplace ID), not relevance. Instead, compute an explicit score per *unique plugin* (aggregating the matched items across a plugin into a single plugin-level score), then pick the 1–2 highest-scoring plugins for the stage.

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
- **Ignoring local plugins.** If your final picks for a stage include zero local candidates when the user has several plausible local skills (you can see them in the `local-catalog.json` Step 1e generated), double-check that you actually ran the grep against `local-items.ndjson` alongside `items.ndjson` in Step 4b. Missing the local file is a common bug, and the symptom is an all-marketplace final profile even when the user has perfect local matches installed.

### 6b. Cross-cutting staples

Beyond the workflow shape's stages, some tools are valuable regardless of stage — planning skills, git workflow tools, general debugging helpers, note-taking. Add 1–3 cross-cutting staples to the profile. Retrieve them with a separate grep pass using generic staple keywords (`plan|planning|git|debug|note|todo|task`). Prefer featured plugins here especially — you are adding baseline utility, not domain-specific tooling.

### 6c. Draft the plugin shell (provisional)

Build a draft plugin shell with:

- **`plugins[]`** — the union of stage picks + staples, as an array of plugin IDs. Marketplace plugins use the `<name>@<marketplace>` format (e.g. `frontend-design@claude-plugins-official`); local plugins use `local:<name>` (e.g. `local:uiux-toolkit`); framework plugins use `framework:<name>`. Mix all three freely — the profile engine handles each correctly.
- **`excludedItems{}`** — populated ONLY for plugins where you want to keep a subset of items. See the exclusion-computation recipe below. Leave the key out entirely for plugins where you want every item enabled (the default).
- **`enabledItemsSummary`** (for your own mental bookkeeping, not a real field) — for each plugin, note which items are effectively enabled. This feeds into Step 7a's presentation, where you'll show the `(N of M enabled)` ratio for exclusion-heavy plugins.
- **provisional model choice** — `claude-opus-4-6` for deep-reasoning workflows (feature-development, refactoring, security-audit, research, prompt-engineering), `claude-sonnet-4-6` for balanced work, `claude-haiku-4-5-20251001` for high-loop-count lightweight work. The user will confirm or override in Step 7e.
- **provisional effort level** — `high` for research/refactoring/incident-investigation, `medium` for most feature work, `low` for lightweight loops. The user will confirm in Step 7e.

**Do not draft the `/workflow` body here.** The `/workflow` body is not a composition artifact — it's the output of an interactive co-design step (7d) that runs only if the user explicitly opts in (7c). Leave `workflow` unset in the draft. Do not draft `customClaudeMd` either — that gets collected in Step 7e with an explicit opt-in and a recommendation based on whether the project already has a `CLAUDE.md`.

### Computing `excludedItems` for mega-bundle plugins

When you apply the mega-bundle rule from Step 6a — "include a plugin with `counts > 15` but keep only the 1–3 items that matched retrieval" — you need to build the `excludedItems[<plugin-id>]` array with every item name EXCEPT the ones you're keeping. Here is the exact procedure:

1. **Enumerate all items in the plugin** by running a targeted grep against `items.ndjson` (or `local-items.ndjson` for local plugins). The `plugin` field in each NDJSON line is exactly the plugin ID you put in `plugins[]`:

   ```
   grep -hE '"plugin":"<plugin-id>"' ~/.claude-profiles/marketplace-cache/items.ndjson
   ```

   Replace `<plugin-id>` with the literal plugin ID, e.g. `antigravity-awesome-skills@antigravity-awesome-skills`.

2. **Extract the bare item name** from each returned line. The item name is the last `/`-separated segment of the `id` field. For example, if the line's `id` is `"antigravity-awesome-skills/antigravity-awesome-skills/pubmed"`, the bare item name is `pubmed`. This matches the convention `scanPluginItems()` in `core.ts` uses when building its `item.name` field, which is what `applyExclusions` compares against via `excludedNames.includes(item.name)`.

3. **Compute the exclude list** as (all bare item names from the grep) minus (the bare item names of items you're keeping from Step 6a's ranking).

4. **Set** `excludedItems["<plugin-id>"] = [<sorted array of names to exclude>]`. Use the same plugin ID as the key — format matters, `core.ts:1594` does a strict string match via `plugins.find((p) => p.name === pluginName)` and a wrong key silently no-ops.

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
# Draft profile for: Systematic UX review of the Claude Profiles Electron app

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

### 7d. Sequence the tool set into a `/workflow` body (only if 7c = yes)

**This is the first time workflow stages appear in user-facing text.** Step 7a showed the user a flat tool list by design; now that they've opted into having a `/workflow` command, the sequence question finally matters, and the workflow shape's stages are the right scaffolding for it. Frame the transition explicitly so the user understands what's happening:

> *"Great — let's turn your tool set into a sequence. The workflow shape I matched your work to (`<shape-id>`) has these stages: <list of stage names>. I'll propose one step per stage using the tools we just locked in, and you can confirm, tweak, or add extra steps as we go. The tool set doesn't change — we're just deciding what order Claude walks through them in when you type `/workflow`."*

Then work through the sequence stage by stage. **Do not draft the body unilaterally.**

1. **Propose the scaffolding.** Use the chosen workflow shape's stages as the skeleton. *"The shape has these stages: [list]."*

2. **For each stage, propose one concrete step in one sentence.** Ground it in the tools the user just locked in 7b, not in tools Claude might have considered earlier. Example: *"For the `implement` stage, I'd have Claude use `frontend-design`'s `frontend-design` skill to scaffold the component structure, then fill in the logic. Sound right, or do you do something different at this stage?"*

3. **Confirm the step, then ask about additions.** After each stage is locked, ask: *"Anything else that should happen at this stage? Also anything between `<stage N>` and `<stage N+1>` that's not in the shape but is part of how you actually work?"* The user might want Claude to post a Slack summary after shipping, or check a changelog before starting, or always run `git pull` first. These aren't in the shape — let the user add them.

4. **Once all stages are confirmed, assemble the `/workflow` body and show it back.** Format as a numbered list or bulleted list, whichever reads more naturally for this workflow. Ask: *"Here's the full /workflow body — anything to change before I lock it in?"*

5. **Save the final body as `P_WORKFLOW` for Step 8's write.** If at any point the user says *"actually skip the workflow"*, respect that and proceed to 7e with `P_WORKFLOW` unset.

**Remember:** the `/workflow` body is a sequence *over the existing tool set*. It does not add or remove tools — that was locked in 7b. If the user realises during 7d that they're missing a tool for a stage, pause, jump back to a mini-7b beat to add it, then resume sequencing. Don't silently smuggle new picks in through the workflow.

### 7e. Final settings (administrative)

After plugins and `/workflow` are locked, collect the remaining fields. Ask each as a distinct question, not a batched form:

1. **Profile name** — *"What should I call this profile? Short and no-spaces is easiest (e.g. `frontend-dev`, `bug-triage`). It mustn't collide with existing profile names: [list from Step 1d]."*
2. **Model** — present your provisional pick from Step 6c with a one-line justification: *"I was planning to use `claude-opus-4-6` because feature-development is deep-reasoning work and your project is non-trivial. Does that work, or do you want `claude-sonnet-4-6` (faster, cheaper) or `claude-haiku-4-5-20251001` (fastest, best for simple loops)?"*
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
> *Want me to install these now so the profile launches cleanly? I'll use the same CLI commands the Claude Profiles app uses when you click Install in the Browse tab. If you skip, the profile will still be written, but you'll need to install these from the Browse tab in the app before first launch."*

- **User says skip** → proceed to Step 8. The two-step-flow reminder in Step 9 will still mention the missing installs.
- **User says yes** → run the install block below.

### Install block

The install is handled by a helper script at `$CLAUDE_PLUGIN_ROOT/scripts/install-plugins.js`. It mirrors the Electron app's `installPlugin` and `addMarketplace` functions from `src/electron/core.ts`, and encodes two load-bearing details:

1. **It resolves the real `claude` binary by walking PATH and skipping `~/.claude-profiles/bin`.** The profiles bin directory contains alias scripts (including the `claude-default` alias, which is *designed* to intercept bare `claude` invocations) that hardcode their own `CLAUDE_CONFIG_DIR` inline on the command line. If you reach `claude` through PATH in this environment, the alias wins and the plugin installs into the wrong config dir. The helper always calls the real binary by absolute path.
2. **It sets `CLAUDE_CONFIG_DIR=$HOME/.claude`** on the subprocess env so installs land in the central `~/.claude/plugins/` location, which is where every profile sources plugins from. Without this override, installs would go to whatever profile-scoped `CLAUDE_CONFIG_DIR` the current session happens to have.

Build the `MISSING_PLUGINS` JSON array inline. For each missing plugin, include its `id`, its `marketplaceId` (short id from catalog.json, e.g. `claude-plugins-official`), and its `sourceUrl` from catalog.json (used to derive the `owner/repo` to pass to `plugin marketplace add`). Prefix the bash command with the variable assignment so the helper script sees it via `process.env.MISSING_PLUGINS`.

Example — **inline the JSON directly in the command** rather than trying to reference a shell variable from a previous step:

!`MISSING_PLUGINS='[{"id":"frontend-design@claude-plugins-official","marketplaceId":"claude-plugins-official","sourceUrl":"https://github.com/anthropics/claude-plugins"},{"id":"pw@claude-code-skills","marketplaceId":"claude-code-skills","sourceUrl":"https://github.com/someone/claude-code-skills"}]' node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/install-plugins.js" 2>&1`

Use single quotes around the JSON array so the embedded double-quotes don't collide with bash's own double-quote parsing. Substitute the actual plugin metadata from the profile draft (not the example IDs above) when you run the command.

The script output is a JSON object of the form `{"ok": true, "realClaude": "<path>", "results": [{"id": "...", "ok": true|false, "error": "..."}]}`. Parse it and handle each plugin:

- **Success** → confirm to the user (*"Installed `<plugin-id>` ✓"*)
- **Failure** → show the error, then ask whether to (a) retry that plugin, (b) skip it and note in the profile that the install is pending, or (c) abort the whole write so the user can investigate before creating a half-broken profile

Once all installs are handled (success, skipped, or the user accepted the partial state), proceed to Step 8.

## Step 8 — Write the profile

The write is handled by `$CLAUDE_PLUGIN_ROOT/scripts/write-profile.js`. The script validates `P_NAME` before touching `profiles.json` and refuses to write if it's missing, empty, or contains path separators — mirroring the same guarantees the Electron app's `validateProfileName` enforces on its IPC path. This is load-bearing: the prior inline version silently wrote `store.profiles[undefined] = partialProfile` whenever `P_NAME` was unset, which broke the Electron app's `loadProfiles()` and left it hanging at "loading plugins".

**Inline all `P_*` variables on the same command line as the script invocation** — don't try to `export` them in a previous step and then run the script, because each `!` command runs in its own shell. Example:

!`P_NAME='my-profile' P_PLUGINS='["frontend-design@claude-plugins-official"]' P_EXCLUDED='{}' P_DESC='Frontend work' P_MODEL='' P_EFFORT='' P_INSTRUCTIONS='' P_WORKFLOW='' P_TOOLS='' node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/write-profile.js" 2>&1`

Substitute the actual values from the profile draft. Required: `P_NAME`. Optional (leave empty string if not used): `P_PLUGINS` (JSON array of plugin IDs), `P_EXCLUDED` (JSON object `{"pluginId": ["item-name-1", "item-name-2", ...]}` — a **flat array of bare item names** per plugin ID; items to *exclude* from each plugin; leave as `'{}'` to enable everything in every plugin), `P_DESC`, `P_MODEL`, `P_EFFORT`, `P_INSTRUCTIONS`, `P_WORKFLOW`, `P_TOOLS` (markdown body of the `/tools` command if the user opted in at Step 7e; leave empty string to skip generating the command).

The script outputs a single-line JSON object:

- **Success** → `{"ok": true, "name": "<name>", "pfPath": "<path>"}` — proceed to Step 9.
- **Failure** → `{"ok": false, "error": "<reason>"}` — stop and tell the user what went wrong. Common causes: `P_NAME` not set (you forgot to include it on the command line), `P_PLUGINS` not valid JSON (check the quoting), or the home directory is not writable.

**Note on `excludedItems`:** the profile engine defaults to *including* all items from each enabled plugin. Populate `P_EXCLUDED` in two cases:

1. **The user explicitly opted out of specific items during Step 7b discussion.** Pass through whatever they asked for.
2. **You applied the mega-bundle rule in Step 6a.** For every plugin where `counts > 15` and only 1–3 items matched retrieval, you should have built the exclude list in Step 6c using the enumeration recipe there (`grep -hE '"plugin":"<id>"' items.ndjson`, extract last segment of each `id`, subtract the kept items). Pass that exclude list through here — one entry per mega-bundle plugin, each value a flat array of bare item names.

The write script validates the schema: each value must be a flat array of strings. The old nested `{skills:[], agents:[], commands:[]}` form is rejected — `applyExclusions` in the Electron app reads a flat list and filters skills, agents, and commands uniformly against the same set. If you accidentally construct the nested form, `write-profile.js` will fail with a descriptive error and the profile will not be written.

## Step 9 — Report back and flag the two-step flow

The skill has only written the profile entry to `profiles.json`. The profile is **not yet usable** until the user finishes setup in the Claude Profiles app. Tell the user clearly:

1. The profile entry has been saved to `profiles.json`.
2. **Open the Claude Profiles app.** If the app was already running while this skill wrote the profile, it's reading from an in-memory cache of `profiles.json` and won't know about the new entry yet — **click the refresh button next to the settings icon in the top-right of the sidebar** to force a re-read. Once the new profile shows up in the sidebar list, either save or launch it from the editor. That save/launch is what actually assembles the config directory, seeds credentials, and writes the `/workflow` command file (if they added one).
3. They may also want to set a **target directory** and any other fields the skill didn't cover (alias, tags, launch flags) from the profile editor. The write script doesn't expose those, so the app is the only place to set them.
4. If the profile includes any plugins that are not yet installed (i.e. not in the `installed` list from Step 1d), remind them to **install those from the app's Browse tab first**, otherwise the profile will launch broken. (If the user opted in at Step 7.5 and the installs succeeded, this is already handled.)

---

## Important notes

- **Plugin IDs use one of three formats depending on source:** `<name>@<marketplace>` for curated marketplace plugins (e.g. `frontend-design@claude-plugins-official`), `local:<name>` for user-installed local skills/agents/commands from `~/.claude/` (e.g. `local:uiux-toolkit`), and `framework:<name>` for synthetic framework wrappers (e.g. `framework:gsd`). Mix all three freely in the same profile — `plugins[]` in `profiles.json` accepts any of them and the Electron app's plugin loader routes each format correctly at session launch.
- **Local plugins are first-class citizens, not a fallback.** Every session must run Step 1e to enumerate local skills and include them in retrieval alongside the marketplace catalog. Missing the local scan produces all-marketplace profiles that silently skip tools the user already installed and relies on. The iteration-1 `ux-review` test run missed this exact case and had to verbally disclaim `local:uiux-toolkit` — don't repeat that.
- **Mega-bundle plugins (total counts > 15) are first-class picks via the exclusion lever.** Do NOT reject them on cognitive-load grounds. `excludedItems` is physical filesystem pruning — `applyExclusions()` in `src/electron/core.ts:1589` deletes excluded items from disk before session launch, so unused skills contribute zero context. A 999-skill plugin with 997 exclusions has the same runtime footprint as a 2-skill plugin. The cognitive-load rubric applies to *effective item count after exclusions*, not raw plugin size. See Step 6a for the rule and Step 6c for the computation recipe.
- **`excludedItems` is a flat array of bare item names per plugin ID.** `{"plugin@mkt": ["skill-a", "skill-b"]}`. The nested `{skills:[], agents:[], commands:[]}` form does not exist — `applyExclusions` filters all item kinds against the same flat set. `write-profile.js` validates the schema and refuses to write a profile with the wrong shape.
- **The skill writes `profiles.json` and, with user consent, installs missing plugins.** Config directory assembly, credential seeding, and `/workflow` command file generation still happen when the profile is saved or launched from the Claude Profiles app — not when this skill runs. But plugin installation is now handled inline in Step 7.5 using the same CLI commands the app uses internally.
- **Do not read the marketplace catalog in full.** Always filter via `grep` and `jq`. The full `items.ndjson` is ~2.6 MB; the full `catalog.json` is ~450 KB. Reading either whole will blow your context budget.
- **Workflow shapes are hints, not gates.** If a user's work genuinely doesn't match any shape, synthesize a custom one with 4–6 stages. Do not force a bad fit.
- **Never draft the `/workflow` body unilaterally.** It's always co-designed in Step 7d, and only if the user explicitly opts in at Step 7c. A thoughtful, collaborative `/workflow` beats an auto-drafted one every time — the orchestration depends entirely on how the specific user thinks about their work, and auto-drafting it is exactly the wrong kind of confidence.
- **Capture the profile description first, not last.** Step 0 is not ceremony — it's the anchor every downstream decision grounds against. A vague description produces a vague profile.
- **Respect existing project `CLAUDE.md`.** If Layer 0 flagged it, recommend keeping the profile's `customClaudeMd` empty unless the user explicitly wants profile-level additions on top.
- **Multi-shape blending is expected.** Real users often do multiple workflows (build + review, research + write). Two shapes is fine; three or more is a smell.
- **Bespoke, not generic.** Two users who both describe "frontend dev" should get meaningfully different profiles, because their tech stacks, project inference, specific tooling, and *how they actually work* all differ. Your job is to reflect the individual, not the archetype.
- **Gap flags are better than fake matches.** If a stage has no confident match, say so explicitly in Step 7a. A profile with an honest gap is better than one with a confident-sounding wrong pick.
- **The install step must bypass `claude-default`.** The `~/.claude-profiles/bin/claude-default` alias (and others) intentionally intercepts bare `claude` invocations and hardcodes its own `CLAUDE_CONFIG_DIR`. The Step 7.5 install block handles this by resolving the real binary via absolute path (skipping `~/.claude-profiles/bin`) and explicitly setting `CLAUDE_CONFIG_DIR=$HOME/.claude`. Do not replace that block with a naive `claude plugin install` — it will silently install to the wrong config dir.

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
