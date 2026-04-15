---
name: suggest-plugins
description: Interactive discovery-and-edit session for a Claude Profiles profile — search the curated marketplace and local plugins, install missing picks with the user's confirmation, add them to the active profile, and use smart exclusions so only the items that match the user's query get enabled on mega-bundle plugins. Stays resident across multiple user turns until the user signals they're done.
---

You are running an **interactive discovery session** over the curated Claude Profiles marketplace and the user's local `~/.claude/{skills,agents,commands}/` plugins. Unlike a one-shot recommender, this skill stays resident across multiple user turns: the user searches, you present, the user refines, you re-search, the user picks, you install + add + exclude, the user searches again, and so on until they say they're done. Treat conversational follow-ups as *expected*, not as pivots.

The skill can perform three kinds of mutation on the user's profile, each gated by an explicit confirmation turn:

1. **Install** a not-yet-installed plugin from its `sourceUrl` via `install-plugins.js`.
2. **Add** an (already-installed or just-installed) plugin to the active profile via `patch-profile.js add-plugins`.
3. **Exclude** items on a mega-bundle plugin via `patch-profile.js set-excluded`, so only the items that matched the user's query are enabled.

Retrieval mechanics are shared with `create-profile` via `retrieve-plugins.js`. You do not grep or jq the marketplace yourself.

## Session state (maintained across user turns)

Track these mentally across the entire session. Re-anchor every turn by printing a one-line header at the top of each response:

```
[suggest-plugins | <profile> | added: <N> | shown: <M>]
```

- **`targetProfile`** — the profile you are editing. Locked on Step 0; does not change mid-session. If the user says *"actually edit `frontend-dev` instead"*, end the current session with a summary, then ask them to re-invoke `/suggest-plugins` from a session running under `frontend-dev` (or pick `frontend-dev` explicitly on a fresh invocation).
- **`shownPicks`** — every pick you have presented, numbered continuously across turns. When the user says *"add #7"* on turn 4, `#7` is the 7th pick you've shown overall, not the 7th pick from the most recent search.
- **`addedThisSession`** — picks that have been written to `profiles.json` during this session. Used for the closing summary and to avoid re-offering picks the user already added.

The anchor line is not cosmetic — it is a state-persistence hack. Claude's context compresses as conversations grow, and the skill body (loaded once at invocation) is the first thing that becomes stale memory. Re-printing the anchor every turn keeps the essential state in the most-recent messages, which are the ones least likely to be compacted.

## Step 0 — Session start (one-time initialization)

Run these `!` blocks at skill-load time so the downstream turns have fresh data to work from. They are safe to execute unconditionally — none of them mutate state, and the outputs prime the model with the static context it needs.

!`node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/fetch-marketplace-cache.js" 2>&1`

!`node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/list-local-plugins.js" 2>&1`

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const cd=process.env.CLAUDE_CONFIG_DIR;
const mfPath=path.join(os.homedir(),'.claude','plugins','installed_plugins.json');
const mf=fs.existsSync(mfPath)?JSON.parse(fs.readFileSync(mfPath,'utf-8')):{plugins:{}};
const installed=Object.keys(mf.plugins||{});
let activeProfileName=null,activeProfilePlugins=[],activeProfileExcluded={},activeProfileWorkflow='';
if(cd){const parts=cd.split(path.sep);const ci=parts.lastIndexOf('config');if(ci>0)activeProfileName=parts[ci-1];}
const pfPath=path.join(os.homedir(),'.claude-profiles','profiles.json');
if(activeProfileName&&fs.existsSync(pfPath)){
  try{const pf=JSON.parse(fs.readFileSync(pfPath,'utf-8')).profiles||{};
    if(pf[activeProfileName]){
      activeProfilePlugins=pf[activeProfileName].plugins||[];
      activeProfileExcluded=pf[activeProfileName].excludedItems||{};
      activeProfileWorkflow=pf[activeProfileName].workflow||'';
    }}catch{}
}
console.log(JSON.stringify({installed,activeProfileName,activeProfilePlugins,activeProfileExcluded,hasWorkflow:!!(activeProfileWorkflow&&activeProfileWorkflow.trim())}));
" 2>&1`

Parse the output:

- **`installed`** — plugin IDs already in `installed_plugins.json`. These can be added to a profile without an install step.
- **`activeProfileName`** — the profile the user is currently running under (derived from `CLAUDE_CONFIG_DIR`). Lock this as `targetProfile` for the session unless `null`.
- **`activeProfilePlugins`** / **`activeProfileExcluded`** — what the target profile already contains, so you don't re-offer plugins already present and so you know current exclusion state before patching it.
- **`hasWorkflow`** — whether the profile already has a `/workflow` command set. Used for the closing nudge toward `/create-workflow`.

If `activeProfileName` is `null`, ask *"You're not running under a profile right now. Which profile should I edit? (Run `/suggest-plugins` again from inside a launched profile session, or tell me which profile name to target.)"* Validate the answer against `profiles.json` and lock `targetProfile` before proceeding.

Print the initial anchor line, a one-sentence greeting, and the first prompt: *"What are you looking for? Tell me broadly (e.g. `better debugging tools`) or narrowly (e.g. `something for capturing user research insights`). I'll grep the marketplace and your local plugins, and you can add any picks straight to `<targetProfile>` — including installs from GitHub if you confirm them."*

## Step 1 — Discovery turn

Runs every time the user asks for a new search. The user's message is the query; never demand they restate it.

**Build keyword list.** Turn the user's intent into 5–10 keywords with synonyms. If the query is project-adjacent (*"for this repo", "for the stack I'm in"*) and `$PWD` looks like a code project, run `infer-project.js` first and fold its `languages` + `frameworks` into `techKeywords`. Otherwise leave `techKeywords` empty.

!`node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/infer-project.js" "$PWD" 2>&1`

**Call `retrieve-plugins.js`.** This script reads a **single JSON object from stdin**. It accepts no environment variables, no CLI flags, no argv — pipe the payload via heredoc or `echo`. Nothing else works. Construct the payload in your own Bash turn and run:

```
echo '{"stages":[{"id":"<intent-slug>","keywords":["kw1","kw2","..."]}],"techKeywords":["tech1"],"cap":40}' \
  | node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/retrieve-plugins.js"
```

The response is a JSON object with `stages[]`, `plugins[]`, and `diagnostics`. If the full output is large (often the case — `plugins[]` alone can be 40 entries), **extract only what you need in the same Bash call** before presenting:

```
echo '{"stages":[...],"techKeywords":[],"cap":40}' \
  | node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/retrieve-plugins.js" \
  | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf-8'));console.log(JSON.stringify({plugins:r.plugins,hits:r.stages[0].hits.slice(0,20),diag:r.diagnostics}));"
```

This avoids the temp-file + Read + re-parse round trips that make the skill slow and clutter the context window. Keep the top 20 hits and all plugins.

**Rerank for addability.** The script's order is relevance-only. Before presenting, apply this tiebreaker:

1. Featured marketplace plugins get +1 to their relevance position.
2. Plugins already in `activeProfilePlugins` are excluded from the main list entirely and land in an "already in your profile" footer.
3. **Plugins the user can act on in this session** (already in `installed`, OR `source: "local"`) are sorted above not-installed plugins when scores are close. The point of this skill is writing back; the picks at the top of the list should be the ones the user can actually add *right now* without a detour through the install beat. Not-installed picks are still valuable (they'll trigger the install beat on confirmation), but they shouldn't dominate the top.

**Present picks in two groups**, numbered continuously from `shownPicks.length + 1`. A visible split is the simplest way to let the user act on "which can I add now?" without mental filtering:

```
## Ready to add now (<K>)

### N. <displayName> — `<plugin id>`
<one-line description>
**Why it matches:** <1 sentence grounding in a specific hit from stages[0].hits>
**Status:** [installed] / [local]  ·  **Contents:** <counts.skills>s / <counts.agents>a / <counts.commands>c

## Need to install first (<K>)

### N. <displayName> — `<plugin id>`
<one-line description>
**Why it matches:** ...
**Status:** not installed  ·  **Contents:** ...s / ...a / ...c
```

Cap each group at ~5 picks (so the overall list stays at ~10 max). If there are fewer than 3 picks across both groups, broaden the keywords and re-run rather than presenting an almost-empty list.

After the main presentation, print the "already in `<profile>`" footer listing any plugins from `activeProfilePlugins` that matched — so the user sees the retrieval didn't miss them; they were intentionally deprioritized.

Update `shownPicks` to include every pick presented this turn, preserving the numbering. Close with the loop-tail nudge.

## Loop-tail nudge (print at the end of every turn except session close)

> *"Add picks by number (e.g. `add 2, 4`), ask for details on one (`tell me more about 3`), run a new search (e.g. `find me something for <X>`), or say `done` to close the session and move on."*

Keep it short. The user should feel like they're in a loop, not at the end of a flow.

## Step 2 — Route the user's next turn

On each follow-up turn, classify the user's message and dispatch:

- **Add by number(s)** (*"add 2 and 4", "add #3", "yes to 1"*) → **Step 3** (write beat).
- **Detail request** (*"tell me more about 3", "what's in 5?"*) → **Step 4** (detail beat).
- **New search** (*"find something for X", "any plugins that do Y?", "what about Z?"*) → **Step 1** (discovery turn) with the new query. Do not discard `shownPicks`; append to it.
- **Done signal** (*"done", "that's all", "thanks", "I'm good", "stop"*) → **Step 5** (session close).
- **Mid-session profile change** (*"actually edit `frontend-dev` instead"*) → run Step 5 for the current profile, print a short "to edit `frontend-dev`, re-run `/suggest-plugins` from a session running under it" note, and stop.
- **Other skill invocation** (user types `/create-workflow` or another slash command) → run Step 5 first, then hand off cleanly. Do not try to stay resident through a cross-skill jump.
- **Ambiguous** → ask a one-line clarifier. Do not guess.

## Step 3 — Write beat (install + add + optional exclude)

For each confirmed pick, in order:

**3a. Resolve from `shownPicks`.** Pull the plugin's full digest (including `sourceUrl`, `counts`, `source`) and the hits it matched on. If the user named a number that isn't in `shownPicks`, tell them *"pick #N isn't in this session — did you mean #M?"* and stop.

**3b. Install if needed.** If the pick is already in `installed` or `source: "local"`, skip. Otherwise:

> *"`<displayName>` isn't installed yet. It's hosted at `<sourceUrl>`. Install now and add it to `<targetProfile>`? (y/n)"*

- **User says yes** → run `install-plugins.js` with `MISSING_PLUGINS='[{"id":"<id>","marketplaceId":"<marketplace>","sourceUrl":"<url>"}]'`. The script uses the same binary-resolution logic as the Claude Profiles app, so the install lands in the central `~/.claude/plugins/` location and then shows up in the next `installed_plugins.json` read. Parse the response — if it failed, surface the error verbatim and skip this pick (do not proceed to add/exclude). Don't retry silently.
- **User says no** → skip this pick entirely, move to the next.

**3c. List the plugin's real items.** After a successful install (or for an already-installed plugin), call `list-plugin-items.js` to get the on-disk item names. This script walks the real `installPath` and matches exactly what `applyExclusions` in `core.ts` sees at profile assembly — critical for mega-bundles where `items.ndjson` is silently truncated by the GitHub Contents API's 1000-entry cap.

The script takes the plugin ID as a **positional argv, not an env var**:

```
node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/list-plugin-items.js" '<plugin id>'
```

Output shape: `{"ok": true, "pluginId": "...", "installPath": "...", "items": ["name1","name2",...]}` on success, `{"ok": false, "error": "..."}` on failure. The `items` array is flat (no skills/agents/commands split) — that's fine because it matches exactly what `excludedItems[pluginId]` must contain. Total item count is `items.length`.

**3d. Decide wholesale vs smart-exclusion.** Sum `counts.skills + counts.agents + counts.commands` (or the `list-plugin-items.js` total — prefer the live count).

- **Total ≤ 6 items** → wholesale add. Go to 3e.
- **Total > 6 items** → smart-exclusion beat.

**Smart-exclusion beat.** The retrieval already knows which specific items matched the user's query. Compute:

```
matched = response.stages[*].hits
          .filter(h => h.plugin === '<pluginId>')
          .map(h => h.id.split('/').pop())  // bare item name
          .filter(n => allItems.includes(n)) // drop stale hits
```

Then ask:

> *"`<displayName>` has `<total>` items. Your query matched `<matched[0]>`, `<matched[1]>`, `<matched[2]>`. Enable just those (excluding the other `<total - matched.length>`), or pull the whole plugin in?"*

- **User says "just those"** → compute `excludedItems = allItems − matched`. Go to 3e, then call `patch-profile.js set-excluded` afterwards with `P_PLUGIN='<id>' P_VALUE='<JSON array of excluded names>'`.
- **User says "just those plus X, Y"** → add `X, Y` to `matched` and recompute the exclusion. Same flow.
- **User says "all"** / **"whole thing"** → skip the exclusion write.
- **User asks to see the full list first** → print grouped by kind (`### Skills`, `### Agents`, `### Commands`) with the matched items asterisked, then re-ask.

**3e. Add the plugin to the profile.** Construct and run via Bash:

```
P_NAME='<targetProfile>' \
P_OP=add-plugins \
P_VALUE='["<plugin id>"]' \
node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/patch-profile.js"
```

Parse the response. If the plugin was already in the profile (appears in the user's request but not in `added`), note it as a no-op.

**3f. Apply exclusions if smart-exclusion chose a subset.** Run after the add has succeeded:

```
P_NAME='<targetProfile>' \
P_OP=set-excluded \
P_PLUGIN='<plugin id>' \
P_VALUE='["excluded-item-1","excluded-item-2","..."]' \
node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/patch-profile.js"
```

**3g. Record, refresh, and confirm.** Append the pick to `addedThisSession` (with a note on whether exclusions were applied) and **add the plugin's ID to your in-memory `installed` set** so subsequent Step 1 searches in the same session don't re-offer it as "not installed". If you don't do this, a search later in the session that matches the plugin you just added will show it as needing another install — wrong and confusing.

Print a per-pick confirmation:

> *"Added `<displayName>` to `<targetProfile>` (enabled `<K>` of `<total>` items)."*

Then return to the loop tail (*"Anything else?"*). Do not auto-close — keep the session open even after successful writes.

## Step 4 — Detail beat

User asked for more info on a previously-shown pick. Look it up in `shownPicks`. Print:

- Full `description` (not truncated)
- `topKeywords`
- `collections` (if any)
- `counts` per kind
- `sourceUrl`
- The specific hits from `stages[*].hits` that mentioned this plugin, so the user sees *which* items matched their query

Then return to the loop tail. Do not auto-add or re-rank.

## Step 5 — Session close

Triggered by an explicit "done" signal or by a mid-session profile change / cross-skill handoff. Print a session recap:

```
## Session summary for `<targetProfile>`

**Added this session (<N>):**
- `<plugin-1>` (wholesale)
- `<plugin-2>` (enabled 4 of 22 items — excluded 18)
- `<plugin-3>` (wholesale, required install)

**Picks you explored but didn't add:** <optional short list from shownPicks minus addedThisSession>

Relaunch `<targetProfile>` from the Claude Profiles app to pick up the new plugins in a live session.
```

If `hasWorkflow` is true and `addedThisSession.length > 0`, add:

> *"Your profile already has a `/workflow` command. Want to fold the new picks into it? Run `/create-workflow` — it'll detect `<targetProfile>` automatically and re-sequence the stages over the now-expanded plugin list."*

If `addedThisSession.length === 0`, keep the recap to one line (*"No changes made to `<targetProfile>` — come back any time."*) and close. Don't over-explain.

Stop. Do not print the loop tail after the session summary.

## Notes and invariants

- **Every mutation requires explicit user confirmation** — the skill may `patch-profile.js` or `install-plugins.js` only after a user turn that named a specific number / plugin / "yes" to a prompt. Never infer intent from a discovery turn alone.
- **Do not retry failures silently.** If `install-plugins.js` or `patch-profile.js` returns `{"ok": false, "error": ...}`, surface the error verbatim, skip the affected pick, and continue to the next pick in the user's request. Don't ask for permission to retry — that's noise.
- **The mega-bundle threshold is 6 items total.** A plugin with 3 skills and 2 agents is wholesale (5 total). A plugin with 3 skills, 3 agents, and 1 command is the beat's trigger (7 total). Tune this constant if real use shows 6 is too aggressive or too lax.
- **Smart-exclusion defaults to the retrieval hit set.** Do not invent additional items beyond what the user's query matched on. If the user wants more, they'll name them — and they'll see the full list if they ask.
- **`list-plugin-items.js` is canonical for exclusion lists, not `items.ndjson`.** The marketplace NDJSON is built from GitHub's Contents API, which caps directory listings at 1000 entries — mega-bundle plugins with more items have their `items.ndjson` rows silently truncated. Always enumerate from the real installed plugin directory when computing exclusions; anything else produces exclusion lists that miss items and leaves unintended items active after `applyExclusions` runs.
- **The session ends when the user says it does — or when they run another slash command.** Do not stay resident through a cross-skill jump. Print the summary, release control, and let the other skill take over.
- **Every turn begins with the anchor line.** `[suggest-plugins | <profile> | added: <N> | shown: <M>]`. One line, no fanfare, top of the response. It's the cheapest way to keep the session state legible as the context window gets noisier.
