---
name: create-workflow
description: Draft or revise a profile's `/workflow` slash command — a dormant orchestration script that sequences the profile's tools into a predictable multi-step flow. Use when the user wants to add, redesign, or replace the `/workflow` command on an existing profile, or when invoked from `create-profile` during new-profile assembly.
---

You are creating or revising the `/workflow` command for a ClaudeWorks profile. `/workflow` is a dormant slash command stored in the profile's `workflow` field in `~/.claudeworks/profiles.json` — when the user types `/workflow` inside a session running under that profile, Claude Code walks through a specific orchestration of the profile's tools (plan → scaffold → implement → verify → ship, or whatever sequence you co-design with the user).

**You always run interactively.** You never draft the body unilaterally — you propose one stage at a time and let the user confirm, tweak, or add. This is true whether the user invoked the skill themselves (e.g. *"add a `/workflow` to my `frontend-dev` profile"*) or `create-profile` chained it during new-profile assembly.

The default path is direct invocation: the skill reads the user's current profile (from `CLAUDE_CONFIG_DIR`), walks them through shape + sequencing, and patches `profiles.json` in place. There is one special case — **parent mode** — when `create-profile` hands over a context block so new-profile assembly can include the workflow in a single write. The rest of this SKILL.md spells out how to handle that handoff; everything else is the default.

- **Parent mode** — `create-profile` hands over a context block with the profile description, the picked plugins, the chosen workflow shape, and the stage list. You skip profile selection and shape picking and go straight to sequencing. When done, you emit the final body between marker lines so the parent skill can capture it as `P_WORKFLOW` and fold it into its own `write-profile.js` call.

## Step 0 — Detect invocation mode

Look for a block in the incoming prompt of the following shape (this is what `create-profile` emits when it hands off):

```
CREATE_WORKFLOW_CONTEXT
{
  "profileDescription": "...",
  "profileName": "...",
  "pickedPlugins": [{"id":"...","displayName":"...","enabledItems":{"skills":[...],"commands":[...],"agents":[...]}}, ...],
  "shapeId": "feature-development",
  "stages": [{"id":"plan","name":"Plan","intent":"...","keywords":[...]}, ...]
}
END_CREATE_WORKFLOW_CONTEXT
```

- **If the block is present**, parse it and jump straight to **Step 3** (sequencing). Use `profileDescription`, `pickedPlugins`, and `stages` from the block — do not ask the user to restate any of these.
- **If the block is absent**, proceed to Step 1.

Do not mix modes — either the parent hands over context, or the user drives the whole flow. Never fall through "half-handed-over" because the block was malformed; if parsing fails, tell the user the handoff broke and ask them to re-run `create-profile`, rather than silently restarting the direct flow inside a half-completed profile creation.

## Step 1 — Pick the target profile

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const pfPath=path.join(os.homedir(),'.claudeworks','profiles.json');
if(!fs.existsSync(pfPath)){console.log(JSON.stringify({profiles:[]}));process.exit(0);}
const pf=JSON.parse(fs.readFileSync(pfPath,'utf-8')).profiles||{};
const out=Object.entries(pf).map(([name,p])=>({name,description:p.description||'',pluginCount:(p.plugins||[]).length,hasWorkflow:!!(p.workflow&&p.workflow.trim())}));
const cd=process.env.CLAUDE_CONFIG_DIR;let active=null;
if(cd){const parts=cd.split(path.sep);const ci=parts.lastIndexOf('config');if(ci>0)active=parts[ci-1];}
console.log(JSON.stringify({profiles:out,active}));
" 2>&1`

Parse the output:

- `profiles` — every profile in `profiles.json` with its description, plugin count, and whether it already has a `workflow` set.
- `active` — the profile the user is currently running under (derived from `CLAUDE_CONFIG_DIR`), or `null` if none.

Pick the target profile in this order — **do not ask the user to pick unless step 3 applies**:

1. **User named a specific profile in their opening message** (e.g. *"add a workflow to my `frontend-dev` profile"*). Validate it against the list and use it. If the name doesn't exist, show the list and ask them to pick.
2. **`active` is non-null** — use it silently. The user invoked this skill from inside a running profile session, so that profile is the obvious target. Do not announce it, do not ask "which profile?", just proceed. Show the profile's name in passing once you get to the first substantive prompt (e.g. *"Adding a `/workflow` to `<name>`. Loading plugins..."*).
3. **`active` is null AND no profile was named** — genuinely ambiguous; the user ran the skill from a non-profile shell. Show the list and ask *"Which profile should I add a `/workflow` command to?"*. Present each as `<name> — <description> (N plugins)<, already has /workflow>`.

If the chosen profile already has a `workflow` set, warn before proceeding:

> *"`<profile>` already has a `/workflow` command. I'll show it to you before we start, and you can tell me whether to revise it in place or start over from scratch."*

Then read and display the existing body. **Do not use an `!` block for this** — `!` blocks execute at skill-load time, before the target profile name is known, so a load-time run would read `pf[undefined]` and always report "(no existing workflow)". Instead, construct the command in your own turn after the user names the profile and run it via the Bash tool. The command shape (substitute `ux-review` with the real profile name):

```
P_NAME='ux-review' node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const name=process.env.P_NAME;
const pf=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.claudeworks','profiles.json'),'utf-8')).profiles||{};
const w=pf[name]&&pf[name].workflow;
if(w)process.stdout.write(w);else console.log('(no existing workflow)');
"
```

## Step 2 — Load plugins and pick a workflow shape

Read the profile's plugin list via the Bash tool — again not an `!` block, since the target name isn't known at load time. Construct and run (substitute the real profile name for `ux-review`):

```
P_NAME='ux-review' node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const name=process.env.P_NAME;
const pf=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.claudeworks','profiles.json'),'utf-8')).profiles||{};
const p=pf[name]||{};
console.log(JSON.stringify({description:p.description||'',plugins:p.plugins||[],excludedItems:p.excludedItems||{}}));
"
```

The workflow-shapes catalog is static and safe to read at load time, so it *is* an `!` block:

!`cat "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/data/workflow-shapes.json"`

**Pick a shape.** Ask the user which workflow shape best matches how they use this profile. Offer 2–3 candidates from `workflow-shapes.json` based on the profile's description and plugin list (look at each shape's `signals` and `stages` — skills/agents with names matching a shape's keywords are strong hints). Frame it as:

> *"Based on your profile's description (`<description>`) and plugins, the `feature-development` and `bug-fixing` shapes both look like reasonable scaffolds. Which fits your usual work better? I can also blend two shapes or build a custom set of stages if neither fits."*

- **User picks one shape** → use its `stages` list as the sequencing scaffold.
- **User asks for a blend** → union two shapes' stages and dedupe overlapping ones (e.g. `verify` appears in both).
- **User wants custom** → ask for 4–6 stage names with one-line intents, and build the scaffold from their answers.

Save the final stage list as `stages` for Step 3. Also save the profile's description as `profileDescription` and its plugins as `pickedPlugins` (since Step 3's logic is shared with parent mode).

## Step 3 — Sequence stages into a `/workflow` body (interactive, both modes)

Shared core of both invocation modes. By now you have `profileDescription`, `pickedPlugins`, and `stages`.

**Output discipline — this skill runs long and the user's context window is precious.** Every assistant turn in this step is capped at ~150 words. If you can't fit a stage proposal in 150 words, the proposal is over-scoped — narrow it before sending. Specifically:

- **Never quote an entire revised stage verbatim** in amendment mode. Show only the *diff* in 3–5 lines: *"Stage 4 EVALUATE — add a 4th pass using `product-skills/product-discovery` to capture feature gaps into `.ux-review/<ts>/<state-id>/gaps.json`. Unchanged: a11y, WCAG, visual passes."* The user has already seen the existing body; they only need what changes.
- **Skip meta-commentary.** Do not append "two deliberate choices" / "worth calling out" paragraphs explaining *why* a proposal is shaped the way it is. If the user asks why, answer then — don't pre-empt.
- **Skip transition anchors.** No *"Stage 4 locked. Moving to the next stage."* lines. One-word acknowledgement (*"Next:"*) or nothing.
- **No upfront proposal table** summarising what's going to change before you start. Jump straight to the first stage's diff.
- **No final full-body re-print before the write.** Each stage was approved individually; reassembling and showing the entire body again is redundant. Replace with a one-line confirmation: *"All stages locked. Ready to write — say `ship it` to confirm or name a stage to revisit."*

**Replacement vs amendment.** Before proposing anything, decide the mode:

- **Amendment mode** — the profile already has a workflow set AND the user's intent words are *"amend", "revise", "update", "add to", "tweak", "adjust"*. Walk only the stages the user named; leave everything else verbatim. Do not re-propose unchanged stages.
- **Replacement mode** — no existing workflow, or the user's intent words are *"replace", "redo", "start over", "new workflow from scratch"*. Walk every stage fresh.

In either mode, work one stage at a time. Never draft the body unilaterally.

**Per-stage loop:**

1. **Propose one concrete step per stage in ≤150 words**, grounded in the actual plugins the profile has. Reference specific plugin/item names. Example: *"implement stage: Claude uses `frontend-design/frontend-design` to scaffold components, then fills in logic. Sound right, or different?"*
2. **On confirmation**, ask *"Anything else at this stage or between here and the next?"* — keep this question short. Do not pre-list example additions.
3. **Move to the next stage** (in amendment mode, skip any the user didn't name). Acknowledge with at most one word.

**Tool-set boundary.** The `/workflow` body is a sequence over the existing tool set; it does not add or remove tools. If the user realises during sequencing that they're missing a plugin, pause: in direct invocation point them at the profile editor or `/suggest-plugins`; in parent mode tell them to cancel and restart `create-profile`.

When the user confirms every proposed stage, send the one-line confirmation from above and proceed to Step 4. Do not print the full body.

## Step 3b — Named variants (direct invocation only)

Most profiles need only a single `/workflow`. Some benefit from **named variants**: `/workflow-debug`, `/workflow-deploy`, `/workflow-review` — each a separate orchestration for a different situation. They live alongside the default `/workflow` in the same profile, not instead of it.

**Parent mode: do not offer variants.** The `create-profile` handoff carries a single body; there's no slot for a variant array in the new-profile flow. If the user asks for variants during parent mode, tell them: *"I'll ship this profile with the default `/workflow` now. Once the profile is created, re-run `create-workflow` in direct invocation and I can add named variants."* Then continue parent-mode Step 4 as normal.

**Direct invocation: offer variants selectively.** Ask *"any other one-shot flows you'd want as a variant?"* at the end of Step 3 only when at least one holds:

- The profile covers multiple distinct activities the user switches between (e.g. feature-development + incident-response + docs-polish).
- The user explicitly asked for more than one command up front ("I want a `/plan` and a `/ship` command").
- Step 2 surfaced a workflow shape whose `signals` mention multiple distinct triggers (rare — check `workflow-shapes.json`).

If none of these hold, **do not** offer variants. A single `/workflow` is the strongly-preferred default — variants multiply the surface area of the profile and the user's mental load, and most profiles don't earn them.

**How to collect.** Loop Step 3 once per variant:

1. Ask: *"Name for this variant? It'll be invoked as `/workflow-<name>`."* — slug-format, e.g. `debug`, `ship`, `review`. Reject names containing spaces or slashes.
2. Sequence stages interactively exactly as you did for the default body.
3. Collect each variant as `{ name: "<slug>", body: "<markdown body>" }` and keep them in an array.
4. After each variant, ask *"Another variant, or done?"* until the user says done.

The default `/workflow` body remains in the `workflow` field. Variants go into the `workflows` array — both can coexist in the same profile. See Step 4 direct-invocation section below for the write path.

## Step 4 — Write back

Your behavior here depends on invocation mode.

### Parent mode — stash the body and continue as create-profile Step 7e

You are still in the same model session as `create-profile`; the "handoff" is a mode switch inside one session, not a process boundary. **Never print the body or any marker lines to the user** — that's internal plumbing and the old `WORKFLOW_BODY_BEGIN/END` markers leaked into chats in past runs. The parent skill will read the body from a temp file.

Use the Write tool to stash the final body at this fixed path:

```
<$TMPDIR>/claudeworks-pending-workflow.md
```

Resolve `$TMPDIR` yourself via Bash before calling Write (on macOS sessions it's typically `/var/folders/...`; fall back to `/tmp` if unset). The file content is the `/workflow` body verbatim — preserving blank lines, no frontmatter, no markers, no surrounding commentary.

If the user opted out of the workflow mid-way, write an **empty file** at the same path. `create-profile` Step 7d detects an empty file and leaves `P_WORKFLOW` unset, so no `/workflow` command is created.

After the Write tool call, say **one** short line to the user — e.g. *"Workflow drafted — continuing with the final profile settings."* — and **immediately, in the same assistant turn**, proceed to `create-profile` Step 7e by asking the user for the profile name. Do not stop, do not wait for a user nudge, do not print the body or its path. The whole point of this contract is a streamlined handoff.

### Direct invocation — patch profiles.json via patch-profile.js

Write the final body to the target profile's `workflow` field via the `patch-profile.js` helper, which handles atomic writes, name validation, and schema invariants in one place (the same writer `suggest-plugins` uses for plugin mutations). Do not inline your own `node -e` snippet — route through the helper for consistency.

**Do not embed the write command as an `!` block in this SKILL.md.** `!` blocks execute at skill-load time, before the user has confirmed the final body, so the placeholders couldn't carry conversation state and a load-time run would clobber the profile with garbage. Instead, construct the command in your own turn *after* the user confirms the body in Step 3, and run it via the Bash tool. The body almost always contains newlines and often contains quotes, so use a heredoc-fed variable so it survives shell parsing — substitute the real target profile name for `ux-review` and the real body for the placeholder lines:

```
BODY=$(cat <<'BODY_EOF'
1. Plan the feature with feature-dev/feature-dev.
2. Scaffold components via frontend-design/frontend-design.
3. Implement the logic, iterating against localhost.
4. Verify with chrome-devtools-mcp and uiux-toolkit/uiux-toolkit.
5. Commit + open PR.
BODY_EOF
)
P_NAME='ux-review' \
P_OP=set-field \
P_FIELD=workflow \
P_VALUE="$BODY" \
node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/scripts/patch-profile.js"
```

The `BODY_EOF` marker is single-quoted (`<<'BODY_EOF'`) so the heredoc preserves `$`, backticks, and backslashes inside the body verbatim — workflow bodies sometimes reference shell-special characters and single-quoted heredocs are the only shape that keeps them intact. Parse the response — `{"ok": true, ...}` on success, `{"ok": false, "error": "..."}` on failure. On failure, surface the error verbatim and stop; do not retry silently.

Then tell the user:

> *"Saved. The `/workflow` command will be active the next time you launch `<profile>` from the ClaudeWorks app. If you're currently running under this profile, you'll need to relaunch it to pick up the change."*

The ClaudeWorks app's profile-assembly step writes the `workflow` field to `<config-dir>/commands/workflow.md` on each launch, which is why the relaunch is needed.

#### Variants write path (direct invocation only)

If you also collected named variants in Step 3b, write them in a second `patch-profile.js` call with `P_FIELD=workflows`. The value is a JSON array — each variant becomes `/workflow-<name>`. Pass the JSON as a single-line value (the bodies embed inside the JSON, so newlines become `\n`):

```
P_NAME='ux-review' \
P_OP=set-field \
P_FIELD=workflows \
P_VALUE='[{"name":"debug","body":"1. Reproduce...\n2. Isolate...\n"},{"name":"ship","body":"1. Build...\n2. Tag...\n"}]' \
node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/scripts/patch-profile.js"
```

Use Node to construct the JSON safely rather than hand-escaping — `JSON.stringify(variantArray)` handles newlines, quotes, and control characters correctly. Pass `P_VALUE='[]'` to clear existing variants. The variants render as separate `/workflow-<name>` commands on the next profile launch; they do not replace the default `/workflow` body.

## Notes

- **Always interactive, always stage-by-stage.** A one-shot body dump is a failure mode. The point of this skill is for the user to co-design the sequence.
- **Never invent plugins.** Only reference plugins that are actually in `pickedPlugins` (parent mode) or the profile's `plugins` list (direct invocation).
- **Respect `excludedItems`.** If the profile has items excluded from a plugin (mega-bundle filtering), don't reference the excluded items in the workflow body — they won't be active at runtime.
- **Do not write a `/tools` command here.** That's a separate concern handled by `create-profile` Step 7e. This skill is scoped to `/workflow` only.
- **If the user says "actually skip the workflow"** at any point, respect it:
  - In parent mode, write an **empty file** at `<$TMPDIR>/claudeworks-pending-workflow.md` and tell them the parent will treat this as "no workflow". The parent's write-profile.js call leaves `P_WORKFLOW` unset and no `/workflow` is created. Do NOT print marker lines — those are gone.
  - In direct invocation, do not touch `profiles.json`. Tell them nothing changed.
