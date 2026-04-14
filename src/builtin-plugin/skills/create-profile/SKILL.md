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

For each stage, construct a command of the following shape, then run it via `!`. The command pipes Group A (stage keywords) through Group B (tech context), which is what gives the intersection its precision:

```
grep -iE '(<stage keyword 1>|<stage keyword 2>|...)' ~/.claude-profiles/marketplace-cache/items.ndjson \
  | grep -iE '(<tech keyword 1>|<tech keyword 2>|...)' \
  | head -30
```

**You must substitute the keyword groups with the actual words you built in Step 4a before running.** Do not run the command above with `<stage keyword 1>` literally — those angle brackets are placeholders, not shell tokens. Do not use a `$CACHE` variable anywhere; always write out `~/.claude-profiles/marketplace-cache/items.ndjson` literally.

Concrete example for a TypeScript/React/Electron project's `implement` stage — run something like this (with *your* actual keywords, not these):

!`grep -iE '(implement|write|code|wire|integrate|develop)' ~/.claude-profiles/marketplace-cache/items.ndjson | grep -iE '(typescript|react|electron|tsx|frontend)' | head -30`

Only items that match **both** the stage intent and the tech context survive, which eliminates the "any matching keyword wins" problem of a single OR-grep. In practice this takes top hits from ~1000-item low-signal pools down to ~30 high-relevance candidates per stage.

### 4c. Fallback for generic mode and cross-cutting staples

In **generic mode** (`mode: "generic"` in the Layer 0 bundle), or when Group B is empty because Layer 0 couldn't find any tech context, fall back to a single grep with only Group A:

```
grep -iE '(<stage keyword 1>|<stage keyword 2>|...)' ~/.claude-profiles/marketplace-cache/items.ndjson | head -30
```

Concrete example for a `research` stage in generic mode — run something like this with *your* actual keywords:

!`grep -iE '(research|investigate|compare|survey|evaluate|source|prior art)' ~/.claude-profiles/marketplace-cache/items.ndjson | head -30`

Retrieval is broader per stage, but workflow shapes still constrain composition.

**Also use the single-grep fallback when retrieving cross-cutting staples in Step 6b** — staples like planning, git workflow, and debugging tools are meant to be general-purpose, so narrowing them by tech context is counterproductive.

### 4d. Parse and collect

Each line of output is a JSON object with `{kind, id, plugin, desc, sourceUrl}`. Parse and collect them as candidate items for that stage. Cap at ~30 hits per stage. If a stage returns fewer than ~5 hits, either (a) broaden Group A with synonyms you derive from the stage's `intent` field, or (b) note the gap and continue — you will flag it explicitly in the self-critique and presentation steps.

### 4e. Collect unique plugin IDs

Across all stage retrievals, collect the **unique set of plugin IDs** that appeared in any hit. You will typically end up with 20–40 unique plugins across 4–6 stages. This is your candidate plugin pool for Step 5.

## Step 5 — Plugin-level lookup

For the unique plugin IDs you collected in Step 4e, pull their full catalog entries from `catalog.json` using `jq`. The command shape is:

```
jq --arg ids '<plugin-id-1>,<plugin-id-2>,<plugin-id-3>' '[.plugins[] | select(.id as $id | ($ids | split(",")) | index($id))]' ~/.claude-profiles/marketplace-cache/catalog.json
```

`--arg ids` passes a single comma-joined string into jq, which then splits it and membership-tests each plugin's id against the list.

**Substitute the angle-bracketed placeholders with your actual comma-joined plugin ID list before running.** Do not run the command with `<plugin-id-1>` literally — those are placeholders. Do not use `$CACHE` anywhere; write out `~/.claude-profiles/marketplace-cache/catalog.json` literally.

Concrete example — if your candidate pool happened to be `frontend-design@claude-plugins-official`, `chrome-devtools-mcp@chrome-devtools-plugins`, and `feature-dev@claude-plugins-official`, you would run:

!`jq --arg ids 'frontend-design@claude-plugins-official,chrome-devtools-mcp@chrome-devtools-plugins,feature-dev@claude-plugins-official' '[.plugins[] | select(.id as $id | ($ids | split(",")) | index($id))]' ~/.claude-profiles/marketplace-cache/catalog.json`

Rebuild the `--arg ids '...'` string with *your* actual plugin IDs before running — the example above is illustrative.

This gives you for each plugin: `displayName`, `description`, `featured`, `collections`, `counts` (how many skills/agents/commands it has), `topKeywords`, and `sourceUrl`. You now have enough plugin-level context to rank candidates within each stage and make informed composition decisions.

## Step 6 — Composition and self-critique (Layer 3)

### 6a. Per-stage selection

For each stage, pick 1 or 2 plugins that best fill it. Ranking rules, in priority order:

1. **Featured plugins outrank non-featured** unless a non-featured plugin is a clearly better match for the stage's intent.
2. **Strong keyword overlap outranks weak overlap.** A plugin whose description and topKeywords match multiple stage keywords is a stronger signal than one that matches a single keyword by coincidence.
3. **Plugins that contribute items to multiple stages earn priority** — they are high-leverage and reduce total plugin count.
4. **Prefer plugins with matching collections** (e.g. a "frontend" collection plugin for a React project) when the collection aligns with the user's project inference.
5. **Prefer plugins with non-trivial `counts.skills + counts.agents + counts.commands`** over one-off single-skill plugins, unless the single-skill plugin is a clearly better fit.

### 6b. Cross-cutting staples

Beyond the workflow shape's stages, some tools are valuable regardless of stage — planning skills, git workflow tools, general debugging helpers, note-taking. Add 1–3 cross-cutting staples to the profile. Retrieve them with a separate grep pass using generic staple keywords (`plan|planning|git|debug|note|todo|task`). Prefer featured plugins here especially — you are adding baseline utility, not domain-specific tooling.

### 6c. Draft the plugin shell (provisional)

Build a draft plugin shell with:

- **plugins[]** — the union of stage picks + staples, as an array of plugin IDs
- **enabledItems{}** — for each plugin, enumerate which specific skills/agents/commands to enable. Use the items that actually matched in Step 4, plus any obviously-load-bearing items from the plugin that weren't in the retrieval results. Use your judgement.
- **provisional model choice** — `claude-opus-4-6` for deep-reasoning workflows (feature-development, refactoring, security-audit, research, prompt-engineering), `claude-sonnet-4-6` for balanced work, `claude-haiku-4-5-20251001` for high-loop-count lightweight work. The user will confirm or override in Step 7e.
- **provisional effort level** — `high` for research/refactoring/incident-investigation, `medium` for most feature work, `low` for lightweight loops. The user will confirm in Step 7e.

**Do not draft the `/workflow` body here.** The `/workflow` body is not a composition artifact — it's the output of an interactive co-design step (7d) that runs only if the user explicitly opts in (7c). Leave `workflow` unset in the draft. Do not draft `customClaudeMd` either — that gets collected in Step 7e with an explicit opt-in and a recommendation based on whether the project already has a `CLAUDE.md`.

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

### 7a. Present plugins and skills by stage (compact format)

Lead with the locked profile description from Step 0 so the user always sees what they originally asked for. Then group the draft picks by workflow stage. For each pick, show a **compact 5–6 line block** with:

1. **Plugin ID** in `name@marketplace` format (note `(featured)` if `featured: true` from the catalog)
2. **One-line description** from `catalog.json` (truncated to ~80 chars)
3. **Enabled items** — the specific skills/agents/commands that will be active from this plugin (the ones you retrieved in Step 4 plus any obviously-load-bearing siblings, not the full plugin contents)
4. **How you'd use it** — one concrete usage example in plain language tied to the stage
5. **Why picked** — one line on the match strength (e.g. "featured + 8 stage-keyword hits" or "only candidate whose description mentions the `contain-before-resolve` pattern")

Example format:

```
# Draft profile for: <profile_description>

Workflow shape: <shape-id>   (or blended: <shape-a> + <shape-b>)

## Stage: load-context

`frontend-design@claude-plugins-official` (featured)
  What it is: Production-grade React/Tailwind component patterns and design rubric.
  Enabled items:
    - skill: frontend-design
    - agent: ui-audit
  How you'd use it: When scaffolding a new component, invoke the skill for layout
    and typography guidance. Run ui-audit before merging to catch a11y + visual drift.
  Why picked: Featured, matched 8 keywords on this stage.

## Stage: verify
  ...

## Cross-cutting staples
  ...
```

**Do not yet show:** model choice, effort level, customClaudeMd, `/workflow` body, or profile name. Those come in Step 7e. Step 7a is focused purely on *"here are the tools I'd give you"* — keep it readable and purely about composition.

### 7b. Discussion beat

After presenting, invite discussion explicitly:

> *"That's the draft. Before I ask about a /workflow command, tell me: any picks you want to swap out, any stages you want more coverage on, anything obviously missing? You can also ask me why I picked a specific plugin over alternatives — I'll explain my reasoning or propose a different candidate from the retrieval pool."*

Handle the user's response patiently:

- **"Looks good"** → proceed to 7c
- **"Why X over Y?"** → re-run that stage's retrieval if needed, explain the ranking rules that put X ahead, offer to swap if Y is a better fit for the user's actual work
- **"Swap X for Z"** → verify Z exists in `catalog.json`, confirm it's on-topic for the stage, swap it in, show the change
- **"Add something for <topic>"** → derive new keywords from the topic, run a supplemental pipe-intersection grep, propose 1–3 candidates, let the user pick
- **"Remove X"** → remove X, check whether its stage still has coverage, flag if it doesn't
- **"Tell me more about X"** → pull X's full catalog entry, summarize its skills/agents/commands at more depth

Stay in this loop until the user signals they're done. Do not proceed to 7c until the plugin composition is explicitly locked. Do not batch the next question onto the end of a swap — give the user a distinct conversational turn to say "anything else" before moving on.

### 7c. Ask whether a `/workflow` command is wanted

Now and only now, ask. Never assume — always explicit, and explain what it is so the user can make an informed choice:

> *"Optional next step: I can draft a `/workflow` command for this profile. It's a dormant slash command — type `/workflow` in a session and Claude walks through a specific orchestration of the tools we just picked (for example, for your feature-development work, it might be plan → scaffold → implement → verify → ship, firing specific tools at each step). Useful when you want predictable multi-step flows on demand rather than reinventing the sequence each time. Want one, or skip it?"*

- **User says skip** → proceed to 7e
- **User says yes** → proceed to 7d
- **User asks "what would it look like?"** → sketch a one-paragraph version from the workflow shape's stages, then ask the question again

### 7d. Co-design the `/workflow` body (only if 7c = yes)

**Do not draft the body unilaterally.** Work it out with the user stage by stage.

1. **Propose the scaffolding.** Use the chosen workflow shape's stages as the skeleton. *"The shape has these stages: [list]. I'll propose one step per stage; you confirm, tweak, or add extra steps as we go."*

2. **For each stage, propose one concrete step in one sentence.** Ground it in the actual plugins you picked, not abstract "do the thing" language. Example: *"For the `implement` stage, I'd have Claude use `frontend-design`'s `frontend-design` skill to scaffold the component structure, then fill in the logic. Sound right, or do you do something different at this stage?"*

3. **Confirm the step, then ask about additions.** After each stage is locked, ask: *"Anything else that should happen at this stage? Also anything between `<stage N>` and `<stage N+1>` that's not in the shape but is part of how you actually work?"* The user might want Claude to post a Slack summary after shipping, or check a changelog before starting, or always run `git pull` first. These aren't in the shape — let the user add them.

4. **Once all stages are confirmed, assemble the `/workflow` body and show it back.** Format as a numbered list or bulleted list, whichever reads more naturally for this workflow. Ask: *"Here's the full /workflow body — anything to change before I lock it in?"*

5. **Save the final body as `P_WORKFLOW` for Step 8's write.** If at any point the user says *"actually skip the workflow"*, respect that and proceed to 7e with `P_WORKFLOW` unset.

### 7e. Final settings (administrative)

After plugins and `/workflow` are locked, collect the remaining fields. Ask each as a distinct question, not a batched form:

1. **Profile name** — *"What should I call this profile? Short and no-spaces is easiest (e.g. `frontend-dev`, `bug-triage`). It mustn't collide with existing profile names: [list from Step 1d]."*
2. **Model** — present your provisional pick from Step 6c with a one-line justification: *"I was planning to use `claude-opus-4-6` because feature-development is deep-reasoning work and your project is non-trivial. Does that work, or do you want `claude-sonnet-4-6` (faster, cheaper) or `claude-haiku-4-5-20251001` (fastest, best for simple loops)?"*
3. **Effort level** — same pattern: *"For effort I'd suggest `high` because [reason]. `medium` or `low` also valid if you want lighter reasoning."*
4. **customClaudeMd** — opt-in, with a specific recommendation:
   - If `existingAIConfig.hasClaudeMd` is true: *"Your project already has a `CLAUDE.md`, so I'd leave the profile's custom instructions slot empty to avoid duplication. Keep it empty, or add something profile-specific the project CLAUDE.md doesn't cover?"*
   - Otherwise: *"The profile can carry its own always-on instructions appended to every session's context. Want me to draft something profile-specific based on the picks we made, or skip it?"*
5. **Optional fields** — target directory, alias, tags, launch flags. Mention once, don't interrogate: *"Anything else — target directory, alias, tags, launch flags? Skip if you don't care."*

### 7f. Final confirmation

Show the complete profile as a compact summary — description, workflow shape, plugin count, model, effort, customClaudeMd status, `/workflow` status, name — and ask:

> *"Here's the final profile. Anything to change before I check for missing plugin installs and write it?"*

Accept tweaks (jump back to the relevant sub-step if needed), then proceed to Step 7.5.

## Step 7.5 — Install missing plugins

Before writing the profile, check whether any of the final plugin picks are not yet installed on this machine. From the `installed` list captured in Step 1d, subtract the final plugin IDs from Step 7f. If the difference is empty, skip this step entirely and go to Step 8.

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

!`P_NAME='my-profile' P_PLUGINS='["frontend-design@claude-plugins-official"]' P_EXCLUDED='{}' P_DESC='Frontend work' P_MODEL='' P_EFFORT='' P_INSTRUCTIONS='' P_WORKFLOW='' node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/write-profile.js" 2>&1`

Substitute the actual values from the profile draft. Required: `P_NAME`. Optional (leave empty string if not used): `P_PLUGINS` (JSON array of plugin IDs), `P_EXCLUDED` (JSON object `{pluginId: {skills:[], agents:[], commands:[]}}` — items to *exclude* from each plugin; leave as `'{}'` to enable everything), `P_DESC`, `P_MODEL`, `P_EFFORT`, `P_INSTRUCTIONS`, `P_WORKFLOW`.

The script outputs a single-line JSON object:

- **Success** → `{"ok": true, "name": "<name>", "pfPath": "<path>"}` — proceed to Step 9.
- **Failure** → `{"ok": false, "error": "<reason>"}` — stop and tell the user what went wrong. Common causes: `P_NAME` not set (you forgot to include it on the command line), `P_PLUGINS` not valid JSON (check the quoting), or the home directory is not writable.

**Note on `excludedItems`:** the profile engine defaults to *including* all items from each enabled plugin. If the user wants only a subset, you express that as exclusions. In most cases you can leave `P_EXCLUDED` empty — only populate it when the user explicitly opted out of specific items during Step 7.

## Step 9 — Report back and flag the two-step flow

The skill has only written the profile entry to `profiles.json`. The profile is **not yet usable** until the user finishes setup in the Claude Profiles app. Tell the user clearly:

1. The profile entry has been saved to `profiles.json`.
2. **Open the Claude Profiles app.** If the app was already running while this skill wrote the profile, it's reading from an in-memory cache of `profiles.json` and won't know about the new entry yet — **click the refresh button next to the settings icon in the top-right of the sidebar** to force a re-read. Once the new profile shows up in the sidebar list, either save or launch it from the editor. That save/launch is what actually assembles the config directory, seeds credentials, and writes the `/workflow` command file (if they added one).
3. They may also want to set a **target directory** and any other fields the skill didn't cover (alias, tags, launch flags) from the profile editor. The write script doesn't expose those, so the app is the only place to set them.
4. If the profile includes any plugins that are not yet installed (i.e. not in the `installed` list from Step 1d), remind them to **install those from the app's Browse tab first**, otherwise the profile will launch broken. (If the user opted in at Step 7.5 and the installs succeeded, this is already handled.)

---

## Important notes

- **Plugin IDs use the format `name@marketplace`** (e.g. `frontend-design@claude-plugins-official`). The catalog and items files already use this format; pass it through unchanged.
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
