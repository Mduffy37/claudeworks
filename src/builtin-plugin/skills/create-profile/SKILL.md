---
name: create-profile
description: Create a new Claude Code profile from a description — selects plugins from installed add-ons or searches the curated marketplace for new ones
---

You are creating a new Claude Code profile. A profile is a named preset that controls which plugins, skills, agents, MCP servers, and settings load per Claude Code session.

## Process

1. **Ask the user** what the profile is for. Get a short description (e.g. "frontend development", "code review", "security research").

2. **Read the available plugins** by running:

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const pfPath=path.join(os.homedir(),'.claude-profiles','profiles.json');
const profiles=fs.existsSync(pfPath)?JSON.parse(fs.readFileSync(pfPath,'utf-8')).profiles:{};
const mf=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.claude','plugins','installed_plugins.json'),'utf-8'));
const installed=Object.keys(mf.plugins).map(n=>({name:n,short:n.split('@')[0]}));
console.log(JSON.stringify({installed,profileNames:Object.keys(profiles)}));
" 2>&1`

3. **Read the curated marketplace** for plugin suggestions:

!`gh api repos/Mduffy37/claude-profiles-marketplace/contents/marketplace.json --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || echo '{"plugins":[]}'`

4. **Recommend plugins** based on the user's description:
   - First check installed plugins that match
   - Then suggest curated marketplace plugins that aren't installed yet
   - Present your recommendations and let the user choose

5. **Ask for a profile name** (short, no spaces preferred).

6. **Ask about settings** — model preference (opus/sonnet/haiku), effort level, any custom CLAUDE.md instructions.

7. **Create the profile** by writing to profiles.json:

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
  useDefaultAuth: true,
};
store.profiles[profile.name]=profile;
fs.writeFileSync(pfPath,JSON.stringify(store,null,2));
console.log('Profile created: '+profile.name);
" 2>&1`

Set the environment variables P_NAME, P_PLUGINS (JSON array of plugin IDs), P_DESC, P_MODEL, P_EFFORT, and P_INSTRUCTIONS based on the user's choices before running.

8. **Report** the created profile configuration back to the user.

## Important
- Plugin names use the format `name@marketplace` (e.g. `superpowers@claude-plugins-official`)
- The profile won't be assembled until it's launched from the Claude Profiles app
- If the user wants a plugin from the curated marketplace that isn't installed, tell them to install it from the app's Browse tab first, then add it to the profile
