---
name: create-team
description: Create a new team composition from a description — selects profiles as members, assigns roles, and sets a lead
---

You are creating a new Claude Code team. A team is a composition of profiles that launch together as coordinated multi-agent sessions, with one profile as the lead.

## Process

1. **Ask the user** what the team is for. Get a description of the team's purpose (e.g. "code review panel", "research squad", "full-stack development").

2. **Read existing profiles** to see what's available:

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const pfPath=path.join(os.homedir(),'.claude-profiles','profiles.json');
const tmPath=path.join(os.homedir(),'.claude-profiles','teams.json');
const profiles=fs.existsSync(pfPath)?JSON.parse(fs.readFileSync(pfPath,'utf-8')).profiles:{};
const teams=fs.existsSync(tmPath)?JSON.parse(fs.readFileSync(tmPath,'utf-8')).teams:{};
const list=Object.values(profiles).map(p=>({name:p.name,description:p.description,plugins:p.plugins.length}));
console.log(JSON.stringify({profiles:list,existingTeams:Object.keys(teams)}));
" 2>&1`

3. **Recommend a team composition** based on available profiles:
   - Suggest which profiles to include and why
   - Recommend which should be the lead
   - Suggest roles and instructions for each member
   - Let the user adjust

4. **Ask for a team name**.

5. **Create the team** by writing to teams.json:

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const tmPath=path.join(os.homedir(),'.claude-profiles','teams.json');
let store=fs.existsSync(tmPath)?JSON.parse(fs.readFileSync(tmPath,'utf-8')):{teams:{}};
const team={
  name: process.env.T_NAME,
  description: process.env.T_DESC || '',
  members: JSON.parse(process.env.T_MEMBERS || '[]'),
};
store.teams[team.name]=team;
fs.writeFileSync(tmPath,JSON.stringify(store,null,2));
console.log('Team created: '+team.name+' ('+team.members.length+' members)');
" 2>&1`

Set T_NAME, T_DESC, and T_MEMBERS (JSON array of `{profile, role, instructions, isLead}` objects) based on user choices.

6. **Report** the created team back to the user.

## Important
- Each member's `profile` field must match an existing profile name exactly
- Exactly one member should have `isLead: true`
- The team won't be assembled until launched from the Claude Profiles app
- If the user needs a profile that doesn't exist, suggest using the `create-profile` skill first
