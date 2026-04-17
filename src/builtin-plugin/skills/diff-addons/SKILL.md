---
name: diff-addons
description: Verify profile isolation by diffing the declared inventory (script) against what's actually loaded in this Claude session (system-reminder)
---

This skill is a **profile isolation validator**. It runs in three phases and produces a diff report. Follow the phases in order, do not skip.

## Phase 1 — Declared inventory (from the filesystem)

Run the helper and parse its JSON output. This is what the profile *declares* should be loaded:

!`node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claudeworks/plugins/profiles-manager}/scripts/list-addons.js" --json 2>&1`

Parse the JSON into three sets: `declared.skills`, `declared.commands`, `declared.agents`. Each is a sorted array of `plugin:name` strings. Remember the `profile`, `pluginCount`, `counts.excluded`, and `excludedSkills`/`excludedCommands`/`excludedAgents` fields — you'll need them for the final report.

## Phase 2 — Actual inventory (from your session context)

Now enumerate what's **actually available to you in this running session**. The authoritative source is the `<system-reminder>` block near the start of the conversation that lists available skills. That block is ground truth — the Claude Code runtime injected it after profile assembly completed, so it reflects what was actually loaded.

**Strict rules for Phase 2 — read, do not recall:**

- Read directly from the system-reminder text in your context. Do not rely on memory of what a "typical" profile has.
- Convert every listed skill to the same `plugin:name` format used in Phase 1. Items in the system reminder that already have a `plugin:name` prefix stay as-is. Items without a plugin prefix (e.g. `update-config`, `keybindings-help`, `simplify`, `loop`) are **builtin or globally-installed** — prefix them with the sentinel `(global):` so they diff cleanly.
- Do the same for commands (user-invocable slash commands grouped under "user-invocable skills" or similar) and for agents (under the Agent tool's `subagent_type` list).
- If a category (skills, commands, agents) is not visible in your context, say so explicitly in the report instead of guessing.

Build three sets: `session.skills`, `session.commands`, `session.agents`.

## Phase 3 — Diff and report

Compute three deltas per category:

- **Matched** = `declared ∩ session` — items in both. Report the count only, never the list.
- **Missing from session** = `declared ∖ session` — declared in the profile but absent from your context. These are **load failures** — profile assembly wrote the files but Claude Code didn't pick them up. Every entry here is a bug worth investigating.
- **Unexpected in session** = `session ∖ declared` — present in your context but not in the profile's declaration. These are **isolation leaks** — items reaching your session from some source the profile didn't ask for (usually `~/.claude/` bleeding through because the runtime reads it regardless of `CLAUDE_CONFIG_DIR`). Every entry here is a profile-separation bug. Items prefixed `(global):` are always unexpected from the profile's perspective — group them under their own subheading so a user can see "global builtins leaking in" separately from "non-builtin leaks," because the latter is a more urgent signal.

## Output format

Produce a terse markdown report. Example shape — fill with your real diff:

```
# Profile isolation check — <profile-name>

Declared: <N> skills, <N> commands, <N> agents (<N> excluded)
Session:  <N> skills, <N> commands, <N> agents

## ✓ Matched
Skills:   <N> / <N>
Commands: <N> / <N>
Agents:   <N> / <N>

## ⚠ Missing from session (declared but not loaded)
- plugin:name
- plugin:name
(none → "All declared items are loaded.")

## ⚠ Unexpected in session (loaded but not declared)
### Non-builtin leaks (investigate)
- plugin:name
### Global builtins
<N> global skills, <N> global agents (expected — not an isolation issue)
(none → "No unexpected items.")
```

**Global builtins are expected noise** — Claude Code always injects its own skills and agents regardless of profile. Do NOT enumerate them individually. Just show a one-line count. Only enumerate non-builtin leaks (those are the actionable items).

**Verdict line at the end**: if Missing is empty AND the "Non-builtin leaks" subsection is empty, print `✓ Profile isolation verified.`. If either has entries, print `✗ Profile isolation issue: <N> missing, <N> unexpected (non-builtin).` and nothing else on that line.

Do not enumerate the profile's excluded items (the helper's JSON includes them for your reference only — they are noise at scale for mega-bundle plugins like antigravity-awesome-skills and must not appear in the report body).
