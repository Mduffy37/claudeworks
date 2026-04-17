---
name: profile-status
description: Show the current profile's configuration — plugins, aliases, model/context, slash commands, launch prompt, MCP overrides, hooks, launch flags, and tags
---

Run the following command to read the current profile's status:

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const cd=process.env.CLAUDE_CONFIG_DIR;
if(!cd){console.log('Not running under a ClaudeWorks profile (CLAUDE_CONFIG_DIR is not set).');process.exit(0)}
const pn=path.basename(path.dirname(cd));
const pfPath=path.join(os.homedir(),'.claudeworks','profiles.json');
if(!fs.existsSync(pfPath)){console.log('profiles.json not found at '+pfPath);process.exit(0)}
const store=JSON.parse(fs.readFileSync(pfPath,'utf-8'));
const pf=store.profiles&&store.profiles[pn];
if(!pf){console.log('Profile not found in store: '+pn);process.exit(0)}

function section(title){console.log('');console.log(title);}
function yesNo(v){return v?'Yes':'No';}
const hasText=v=>typeof v==='string'&&v.trim().length>0;

console.log('');
console.log('Profile: '+pn);
console.log('Description: '+(hasText(pf.description)?pf.description:'(none)'));
console.log('Default profile: '+yesNo(pf.isDefault));
if(pf.favourite)console.log('Favourite: Yes');

section('Session');
const ctx=pf.model==='opus'?pf.opusContext:pf.model==='sonnet'?pf.sonnetContext:undefined;
console.log('  Model: '+(pf.model||'(inherits global default)')+(ctx?' ['+ctx+' context]':''));
console.log('  Effort: '+(pf.effortLevel||'(inherits global default)'));
console.log('  Voice: '+(pf.voiceEnabled===true?'Enabled':pf.voiceEnabled===false?'Disabled':'(inherits global default)'));
console.log('  Auth: '+(pf.useDefaultAuth===false?'Separate keychain slot':'Default (shared OAuth)'));

const dirs=pf.directories||(pf.directory?[pf.directory]:[]);
if(dirs.length){section('Directories ('+dirs.length+')');for(const d of dirs)console.log('  '+d)}
if(pf.projects&&pf.projects.length){section('Imported projects ('+pf.projects.length+')');for(const p of pf.projects)console.log('  '+p)}

const aliases=pf.aliases||[];
if(aliases.length||pf.disableDefaultAlias){
  section('Aliases ('+aliases.length+')');
  for(const a of aliases){
    const dirNote=a.directory?' [cwd '+a.directory+']':'';
    let action;
    if(a.launchAction==='workflow')action=' -> /workflow';
    else if(a.launchAction==='prompt'&&hasText(a.launchPrompt))action=' -> prompt: '+JSON.stringify(a.launchPrompt);
    else if(pf.isDefault&&a.name==='claude')action=' (intercepts bare claude launch)';
    else action=' -> default launch';
    console.log('  '+a.name+action+dirNote);
  }
  if(pf.disableDefaultAlias)console.log('  (default claude interception disabled)');
}

if(hasText(pf.launchPrompt)){section('Launch prompt (fires on launch without alias)');console.log('  '+pf.launchPrompt);}

const cmds=[];
if(hasText(pf.workflow))cmds.push('/workflow');
for(const w of pf.workflows||[]){if(w&&hasText(w.name)&&hasText(w.body))cmds.push('/workflow-'+w.name+(w.directory?' [cwd '+w.directory+']':''))}
if(hasText(pf.tools))cmds.push('/tools');
if(hasText(pf.intro))cmds.push('/intro');
if(cmds.length){section('Profile-scoped slash commands ('+cmds.length+')');for(const c of cmds)console.log('  '+c)}

section('Plugins ('+pf.plugins.length+')');
if(pf.plugins.length===0)console.log('  (none)');
for(const p of pf.plugins){
  const excluded=(pf.excludedItems||{})[p]||[];
  console.log('  '+p+(excluded.length?' ('+excluded.length+' item'+(excluded.length===1?'':'s')+' excluded)':''));
}

if(hasText(pf.customClaudeMd))console.log('\\nCustom instructions: custom CLAUDE.md present ('+pf.customClaudeMd.length+' chars, appended to global)');

if(pf.env&&Object.keys(pf.env).length){
  section('Environment ('+Object.keys(pf.env).length+')');
  for(const[k,v]of Object.entries(pf.env))console.log('  '+k+'='+v);
}

const mcpDis=pf.disabledMcpServers||{};
const mcpScopes=Object.keys(mcpDis);
if(mcpScopes.length){
  const total=mcpScopes.reduce((a,k)=>a+(mcpDis[k]||[]).length,0);
  section('Disabled MCP servers ('+total+' across '+mcpScopes.length+' scope'+(mcpScopes.length===1?'':'s')+')');
  for(const k of mcpScopes){
    const label=k==='__user__'?'(user-scoped)':k;
    console.log('  '+label+': '+(mcpDis[k]||[]).join(', '));
  }
}

const hooksDis=pf.disabledHooks||{};
const hookEvents=Object.keys(hooksDis);
if(hookEvents.length){
  const total=hookEvents.reduce((a,k)=>a+(hooksDis[k]||[]).length,0);
  section('Disabled hooks ('+total+' across '+hookEvents.length+' event'+(hookEvents.length===1?'':'s')+')');
  for(const e of hookEvents)console.log('  '+e+': '+(hooksDis[e]||[]).length+' skipped');
}

const lf=pf.launchFlags||{};
const hasFlag=lf.dangerouslySkipPermissions||lf.verbose||hasText(pf.customFlags);
if(hasFlag){
  section('Launch flags');
  if(lf.dangerouslySkipPermissions)console.log('  --dangerously-skip-permissions');
  if(lf.verbose)console.log('  --verbose');
  if(hasText(pf.customFlags))console.log('  custom: '+pf.customFlags.trim());
}

console.log('');
console.log('Status line: '+(pf.statusLineConfig?'Per-profile override':'Global (~/.claude/statusline-config.json)'));
if(pf.tags&&pf.tags.length)console.log('Tags: '+pf.tags.join(', '));
if(pf.lastLaunched)console.log('Last launched: '+new Date(pf.lastLaunched).toLocaleString());
if(store.schemaVersion!=null)console.log('Store schema version: '+store.schemaVersion);
console.log('');
" 2>&1`

Display the output above as a formatted status report. Do not modify, interpret, or reorder the fields.
