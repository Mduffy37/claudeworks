---
name: create-profile
description: Create a new Claude Code profile from a description — selects plugins from installed add-ons or searches the curated marketplace for new ones
---

You are creating a new Claude Code profile. A profile is a named preset that controls which plugins, skills, agents, MCP servers, and settings load per Claude Code session.

## Process

1. **Ask the user** what the profile is for. Get a short description (e.g. "frontend development", "code review", "security research").

2. **Ask about search scope.** Should recommendations come from installed plugins only, or should the curated `claude-profiles-marketplace` also be searched for plugins that aren't installed yet? Default to installed-only if the user has no preference — it's faster and avoids recommending things they'd have to install first.

3. **Read the installed plugins** by running:

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const pfPath=path.join(os.homedir(),'.claude-profiles','profiles.json');
const profiles=fs.existsSync(pfPath)?JSON.parse(fs.readFileSync(pfPath,'utf-8')).profiles:{};
const mf=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.claude','plugins','installed_plugins.json'),'utf-8'));
const installed=Object.keys(mf.plugins).map(n=>({name:n,short:n.split('@')[0]}));
console.log(JSON.stringify({installed,profileNames:Object.keys(profiles)}));
" 2>&1`

4. **Read the curated marketplace** — **only if the user opted in at step 2**. Skip this step otherwise.

!`gh api repos/Mduffy37/claude-profiles-marketplace/contents/marketplace.json --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || echo '{"plugins":[]}'`

5. **Recommend plugins** based on the user's description:
   - Always check installed plugins that match
   - If the curated marketplace was read, also suggest curated plugins that aren't installed yet — and clearly flag them as "not yet installed" so the user knows they'll need to install them from the app's Browse tab before the profile can use them
   - Present your recommendations and let the user choose

6. **Ask for a profile name** (short, no spaces preferred).

7. **Ask about settings** — model preference (opus/sonnet/haiku), effort level, and authoring slots:
   - **Always-on instructions** (optional): appended to CLAUDE.md — Claude reads this every turn of every session.
   - **Workflow command** (optional): body of a `/workflow` command the user can invoke explicitly to run a predefined orchestration of the profile's tools. Unlike always-on instructions, this is dormant until typed.

   These are separate slots with different delivery mechanisms. Ask about them individually and skip either one if the user doesn't want it. If the user is unclear on the difference, explain: always-on is context Claude always has, workflow is a command Claude only runs when you type `/workflow`.

8. **Create the profile** by writing to profiles.json:

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const pfPath=path.join(os.homedir(),'.claude-profiles','profiles.json');
let store=fs.existsSync(pfPath)?JSON.parse(fs.readFileSync(pfPath,'utf-8')):{profiles:{}};
const profile={
  name: process.env.P_NAME,
  plugins: JSON.parse(process.env.P_PLUGINS || '[]'),
  excludedItems: {},
  description: process.env.P_DESC || '',
  model: process.env.P_MODEL || undefined,
  effortLevel: process.env.P_EFFORT || undefined,
  customClaudeMd: process.env.P_INSTRUCTIONS || '',
  workflow: process.env.P_WORKFLOW || undefined,
  useDefaultAuth: true,
};
store.profiles[profile.name]=profile;
fs.writeFileSync(pfPath,JSON.stringify(store,null,2));
console.log('Profile created: '+profile.name);
" 2>&1`

Set the environment variables P_NAME, P_PLUGINS (JSON array of plugin IDs), P_DESC, P_MODEL, P_EFFORT, P_INSTRUCTIONS, and P_WORKFLOW based on the user's choices before running. Leave P_WORKFLOW unset if the user didn't provide a workflow.

9. **Report back and flag the two-step flow.** The skill has only written the profile entry to `profiles.json` — the profile is not yet usable. Tell the user clearly:
   - The profile entry has been saved.
   - To finish setup they need to **open the Claude Profiles app** and either save or launch the profile there. That is what actually assembles the config directory, seeds credentials, and writes the `/workflow` command file (if they added one).
   - They may also want to set a **target directory** and any other fields the skill didn't cover (alias, tags, launch flags, etc.) from the profile editor.
   - If they included any curated-but-not-installed plugins, remind them to **install those from the app's Browse tab** before launching, otherwise the profile will be broken.

## Important
- Plugin names use the format `name@marketplace` (e.g. `superpowers@claude-plugins-official`)
- The skill only writes to `profiles.json`. Config dir assembly, credential seeding, and `/workflow` command file generation all happen when the profile is saved or launched from the Claude Profiles app — not when this skill runs.
- If the user wants a plugin from the curated marketplace that isn't installed, tell them to install it from the app's Browse tab first, then add it to the profile.
