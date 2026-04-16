---
name: list-addons
description: Show what skills, commands, agents, and MCP servers this profile provides — an informative inventory, not a diff
---

This skill shows the **declared inventory** for the current profile — what the profile is configured to provide. It does NOT compare against the running session (that's what `/diff-addons` does).

## What to do

Run the helper script (no flags — the default output is the human-readable inventory):

!`node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/claude-profiles/plugins/profiles-manager}/scripts/list-addons.js" 2>&1`

Present the output to the user as-is. The script already formats it with:
- Profile name and plugin count
- Skills grouped by source plugin, with active/excluded counts
- Commands grouped by source plugin
- Agents grouped by source plugin
- Local items from the working directory's `.claude/` folder (if any)

If the user wants to verify what's actually *loaded* in this session vs what's declared, point them to `/diff-addons` which runs a full three-phase comparison.
