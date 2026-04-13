---
name: suggest-plugins
description: Search the curated marketplace for plugins relevant to what you're working on and recommend additions to your profile
---

You are helping the user discover plugins from the curated Claude Profiles marketplace.

## Process

1. **Read the curated marketplace**:

!`gh api repos/Mduffy37/claude-profiles-marketplace/contents/marketplace.json --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || echo '{"plugins":[]}'`

2. **Read collections** for context:

!`gh api repos/Mduffy37/claude-profiles-marketplace/contents/collections.json --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || echo '{"collections":[]}'`

3. **Read what's already installed**:

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const cd=process.env.CLAUDE_CONFIG_DIR;
const pfPath=path.join(os.homedir(),'.claude-profiles','profiles.json');
const mf=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.claude','plugins','installed_plugins.json'),'utf-8'));
const installed=Object.keys(mf.plugins);
let profilePlugins=[];
if(cd){const pp=cd.split(path.sep),pn=pp[pp.lastIndexOf('config')-1];
const profiles=fs.existsSync(pfPath)?JSON.parse(fs.readFileSync(pfPath,'utf-8')).profiles:{};
if(profiles[pn])profilePlugins=profiles[pn].plugins;}
console.log(JSON.stringify({installed,profilePlugins}));
" 2>&1`

4. **Ask the user** what they're looking for or what kind of work they're doing. If they don't have a specific need, look at the current directory and suggest based on the project type.

5. **Present recommendations**:
   - Highlight curated plugins, surfacing featured ones first
   - Show which are already installed vs not
   - Show which are in the current profile vs just installed globally
   - Group by collection when it makes sense
   - Explain why each recommendation is relevant

6. If the user wants to add a plugin to their current profile, tell them to install it from the Claude Profiles app's Browse tab and add it to the profile.
