---
name: create-team
description: Create a new ClaudeWorks team from a description — selects profiles as members, picks a lead with orchestrator bias, drafts per-member roles and instructions, and identifies gaps with paste-ready `/create-profile` prompts the user can fulfill in a parallel terminal. Stays resident across user turns so gap resolution and final assembly happen in one session.
---

You are creating a new ClaudeWorks team. A team is a composition of profiles that launch together as a coordinated multi-agent session, with one profile as the lead.

## Design contract

1. **Team members reference existing profiles only.** The team itself never creates profiles. When the user's description needs a profile that doesn't exist, you hand them a paste-ready `/create-profile` prompt and wait for them to create it in a parallel session, then continue.
2. **Prefer orchestrator-style profiles as lead.** The lead profile drives merged config (model, effort, plugins, MCP servers) for the whole team — it should be the one best-suited to coordinating, synthesizing, and tracking parallel work.
3. **Draft roles and per-member instructions yourself.** You have the context from the team's purpose; the user can revise afterwards in the app.
4. **Offer team-level overrides but default to inheriting from lead.** Most teams should just inherit.
5. **Stay resident across turns.** You do not end the conversation until the team is either written or explicitly abandoned.

## Step 1 — Ask the purpose

Ask one short question: *"What is this team for?"* Accept a free-form description (e.g. "code review panel", "frontend feature development", "incident triage", "research squad for weekly papers"). Do not batch multiple questions at this step — purpose first, composition later.

## Step 2 — Read state

Always read both profiles and existing teams. The team design depends on what's available to compose from, and team names must be unique.

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const pfPath=path.join(os.homedir(),'.claudeworks','profiles.json');
const tmPath=path.join(os.homedir(),'.claudeworks','teams.json');
const store=fs.existsSync(pfPath)?JSON.parse(fs.readFileSync(pfPath,'utf-8')):{profiles:{}};
const teams=fs.existsSync(tmPath)?JSON.parse(fs.readFileSync(tmPath,'utf-8')):{teams:{}};
const list=Object.values(store.profiles||{}).map(p=>({
  name:p.name,
  description:p.description||'',
  plugins:(p.plugins||[]).length,
  pluginIds:(p.plugins||[]).slice(0,6),
  model:p.model||'(global default)',
  effort:p.effortLevel||'(global default)',
  tags:p.tags||[],
  hasWorkflow:!!(p.workflow&&p.workflow.trim()),
  lastLaunched:p.lastLaunched||0,
  isDefault:!!p.isDefault,
}));
console.log(JSON.stringify({profiles:list,existingTeams:Object.keys(teams.teams||{})},null,2));
" 2>&1`

Parse the output. If there are zero profiles, tell the user: *"You have no profiles yet. A team needs at least one profile to lead it. Run `/create-profile` first (a generic lead profile is a good starting point — see Step 3b below), then come back and I'll help compose the team."* Offer the generic-lead prompt from Step 3b verbatim and stop.

## Step 3 — Propose composition

Break the team into **roles** the purpose implies. Examples:

- *"code review panel"* → senior reviewer (lead) + security reviewer + performance reviewer
- *"frontend feature development"* → orchestrator (lead) + UI implementer + UX/accessibility reviewer
- *"incident triage"* → coordinator (lead) + on-call engineer + postmortem writer

A team with fewer than 2 members is rarely worth creating — if the purpose only needs one profile, tell the user that and suggest just launching that profile directly.

### 3a — Lead selection

The lead profile drives the team's merged config. Prefer profiles that look like orchestrators:

- Description mentions: "orchestrat", "coordinat", "manag", "overall", "synth", "review", "lead"
- Plugins include broad project-management / feature-dev / multi-agent tooling
- Uses Opus (implies deep reasoning)
- Has a `/workflow` defined (implies multi-step orchestration capability)
- Tagged as "lead" / "orchestrator" / "project-management"

Score each candidate informally. Pick the highest-scoring existing profile as your *proposed lead*. Present with rationale: *"I'd suggest `<profile>` as lead because <reason>. Swap if you prefer."*

### 3b — Generic team-lead when none exist

If no existing profile scores meaningfully as an orchestrator (e.g. all profiles are specialists with narrow purpose), propose creating a generic team-lead. Show the user this paste-ready `/create-profile` prompt verbatim:

> **Paste into a new `/create-profile` session:**
>
> *Create a profile called `team-lead` designed for multi-agent team orchestration. Purpose: high-level project understanding, coordinating specialist team members, tracking parallel workstreams, synthesizing across teammates into decisions, and keeping the user informed of overall progress. Plugins should lean broad-but-shallow — feature-dev (for structural project understanding), profiles-manager (team-awareness), any project-management skills you have. Avoid deep-specialist plugins. Model: Opus with 1M context. Effort: high. Add a custom CLAUDE.md emphasizing orchestration: "You are the team lead for a multi-agent session. Your job is to synthesize across teammates, track who's working on what, and keep the user informed of overall progress. Delegate specialist work; focus on coordination." Consider a `/workflow` of: intake → decompose → delegate → integrate → report.*

Tell the user: *"This doesn't currently exist. Open a new terminal, run `/create-profile` with the prompt above, then come back here and say 'continue'. I'll pick up where we left off."* Then wait — do not proceed to Step 4 until the user reports back.

### 3c — Member selection

For each remaining role (everything except lead), pick the best-matching existing profile by:

- Description / tag overlap with the role's intent
- Plugin coverage (a "security reviewer" role matches a profile with security plugins)
- Recency (`lastLaunched` — recently-used profiles are likely more polished)

Propose the full composition as a table:

```
Lead:    <profile>  — <rationale>
Member:  <profile>  — role: <role>, <rationale>
Member:  <profile>  — role: <role>, <rationale>
Gap:     <role>     — no matching profile exists (Step 4 will handle)
```

Let the user adjust — swap members, remove, reorder, reassign lead. Iterate until they confirm.

## Step 4 — Gap handling

Any role that didn't match an existing profile is a **gap**. For each gap, emit a paste-ready prompt the user can hand to `/create-profile`. Offer two routes:

### 4a — Resolve gaps first (preferred)

Print one block per gap, numbered:

> **Gap 1: `<role>`**
>
> Paste into a new `/create-profile` session:
>
> *Create a profile for <role>. Purpose: <1-2 sentences derived from the team's overall purpose and this role's slice of it>. Model suggestion: <opus/sonnet/haiku>. Effort suggestion: <low/medium/high>. <Optional: Plugin direction if obvious from the role — e.g. "should lean on security-review and owasp-top-10 plugins if available in your marketplace".> <Optional: Workflow suggestion if the role has a clear orchestration shape.>*

Tell the user: *"Open a new terminal window (or tab) in any directory where Claude Code is installed, run `/create-profile` once per gap above, then come back here and say `continue` (or `done`). I'll re-check your profiles and finish the team assembly. If you'd rather skip one or more gaps and create the team with what you have now, say `override` instead."*

Then wait.

**When the user reports back:** re-run the Step 2 read block. For each gap profile name you expected, verify it now exists. If all expected profiles are present, proceed to Step 5. If some are still missing, tell the user which ones aren't there yet and re-prompt.

### 4b — Override (create with what's available)

If the user says `override` or otherwise indicates they want the team now without filling gaps, skip unmet roles and continue with the reduced composition. Note the skipped roles in the team's `description` field so the user remembers what's missing later:

> *"Team description: <original description>. (Gaps deferred: <role-a>, <role-b>.)"*

## Step 5 — Draft role + instructions per member

For each member (lead and non-lead), draft two fields:

- **`role`**: a short string (2-5 words) naming the member's function. e.g. "Security reviewer", "UI implementer", "Research synthesizer", "Team lead".
- **`instructions`**: a 2-4 sentence per-member system-prompt overlay that the spawned agent sees. Should cover: what this member's scope is, how they coordinate with the lead, what signals to escalate, and what to NOT do (e.g. "do not make structural architecture decisions without lead sign-off").

Present the drafts and let the user revise inline. Draft quality matters — these instructions are what make the team feel team-like vs. three disconnected profiles.

## Step 6 — Team-level overrides (optional)

Ask once: *"The team will inherit model, effort, context, and custom flags from the lead profile `<lead>`. Want to override any of these at the team level? (Usually 'no' — only say yes if the team needs behavior distinct from the lead profile's usual use.)"*

If yes, collect overrides one at a time:
- Model: opus / sonnet / haiku (or keep lead's)
- Opus context (if model is opus): 200k / 1m
- Sonnet context (if model is sonnet): 200k / 1m
- Effort: low / medium / high / xhigh / max (or keep lead's)
- Custom flags: raw additional CLI flags (or none)

If no, skip directly to Step 7.

## Step 7 — Final confirmation

Show the complete team:

```
Team: <name>
Description: <desc>

Members (N):
  [lead] <profile>  role: <role>
    Instructions: <instructions>
  <profile>  role: <role>
    Instructions: <instructions>
  ...

Overrides: (none — inherits from lead)  OR  model: opus [1m], effort: high, ...
```

Ask: *"Ready to write this team? (yes / let me change something)"*. Loop through edits until confirmed.

## Step 8 — Write

Run `write-team.js` via the skill's Bash tool. Construct each env var carefully:

```
T_NAME='<team-name>' \
T_DESC='<description>' \
T_MEMBERS='[{"profile":"...","role":"...","instructions":"...","isLead":true/false}, ...]' \
T_MODEL='<opus|sonnet|haiku or empty>' \
T_OPUS_CTX='<200k|1m or empty>' \
T_SONNET_CTX='<200k|1m or empty>' \
T_EFFORT='<low|medium|high|xhigh|max or empty>' \
T_CUSTOM_FLAGS='<flags or empty>' \
T_TAGS='["tag1","tag2"]' \
node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/scripts/write-team.js"
```

Use `JSON.stringify` mentally when building the T_MEMBERS array — newlines in `instructions` strings must be escaped as `\n`, quotes as `\"`. Single-quote the entire JSON so the shell preserves it.

Parse the response:
- `{"ok": true, ...}` — team written. Tell the user: *"Team `<name>` saved. It'll appear in the ClaudeWorks app sidebar. Launch it with the team's Launch button when you're ready."*
- `{"ok": false, "error": "..."}` — surface the error verbatim. Common causes: missing profile reference (a gap wasn't actually resolved), invalid lead count, bad scalar value. Do not retry silently — explain what to fix.

## Notes

- **Never write to teams.json directly from this skill** — route through `write-team.js` so atomic-write + validation + schema-stamp invariants hold.
- **Name collisions**: if the team name already exists in `existingTeams`, ask the user for a different name. Overwriting a team silently would surprise someone.
- **Per-member `colour`** is a schema field tracked in FEATURES.md as "waiting on upstream". Do not offer to set it.
- **If user abandons mid-flow** (says "never mind"), do not write anything. A partially-designed team has no value and leaves teams.json unchanged.
- **Parent mode not yet supported.** `create-profile` does not currently chain into this skill, and this skill does not produce a handoff context block. If a parent-mode context arrives in the future, detect it at Step 0 and jump to Step 3 with the provided composition — but v1 is standalone-only.
