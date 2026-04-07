---
allowed-tools: Bash(node:*)
description: Verify this profile's assembly is correct
---

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const cd=process.env.CLAUDE_CONFIG_DIR;
if(!cd){console.log('Not running under a profile');process.exit(0)}
const pp=cd.split(path.sep),pn=pp[pp.lastIndexOf('config')-1];
const pf=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.claude-profiles','profiles.json'),'utf-8')).profiles[pn];
if(!pf){console.log('Profile not found');process.exit(0)}
const mf=JSON.parse(fs.readFileSync(path.join(cd,'plugins','installed_plugins.json'),'utf-8'));
const st=JSON.parse(fs.readFileSync(path.join(cd,'settings.json'),'utf-8'));
const ex=pf.excludedItems||{};
const issues=[];

// Check enabledPlugins matches profile
for(const p of pf.plugins){if(!st.enabledPlugins||!st.enabledPlugins[p])issues.push('settings.json missing enabledPlugins entry: '+p)}
for(const p of Object.keys(st.enabledPlugins||{})){if(!pf.plugins.includes(p)&&p!=='profile-debug@claude-profiles')issues.push('settings.json has extra enabledPlugins entry: '+p)}

// Check each plugin
const items={skills:[],commands:[],agents:[]};
for(const[plugName,installs]of Object.entries(mf.plugins)){
const short=plugName.split('@')[0];const pe=ex[plugName]||[];
for(const inst of installs){const b=inst.installPath;
if(!fs.existsSync(b)){issues.push('installPath missing: '+b+' ('+plugName+')');continue}

// Skills
const sd=path.join(b,'skills');
if(fs.existsSync(sd))for(const d of fs.readdirSync(sd)){const sm=path.join(sd,d,'SKILL.md');if(!fs.existsSync(sm))continue;
const c=fs.readFileSync(sm,'utf-8'),m=c.match(/^name:\\s*(.+)$/m);const n=m?m[1].trim():d;
if(pe.includes(n)){if(fs.existsSync(sm))items.skills.push({name:short+':'+n,status:'excluded-ok'})}
else{items.skills.push({name:short+':'+n,status:'ok'})}}

// Commands
const cd2=path.join(b,'commands');
if(fs.existsSync(cd2))for(const f of fs.readdirSync(cd2)){if(!f.endsWith('.md'))continue;const n=f.replace('.md','');
if(pe.includes(n)){items.commands.push({name:short+':'+n,status:'excluded-ok'})}
else{items.commands.push({name:short+':'+n,status:'ok'})}}

// Agents
const ad=path.join(b,'agents');
if(fs.existsSync(ad))for(const f of fs.readdirSync(ad)){if(!f.endsWith('.md')||f==='README.md')continue;const n=f.replace('.md','');
if(pe.includes(n)){items.agents.push({name:short+':'+n,status:'excluded-ok'})}
else{items.agents.push({name:short+':'+n,status:'ok'})}}

// Root-level agents (voltagent)
if(!fs.existsSync(sd)&&!fs.existsSync(ad)&&!fs.existsSync(cd2))
for(const f of fs.readdirSync(b)){if(!f.endsWith('.md')||f==='README.md')continue;const n=f.replace('.md','');
if(pe.includes(n)){items.agents.push({name:short+':'+n,status:'excluded-ok'})}
else{items.agents.push({name:short+':'+n,status:'ok'})}}
}}

// Check for excluded items whose files should be removed (if plugin was copied not symlinked)
// This is a deeper check — excluded items in copied dirs should have their .md deleted
for(const[plugName,excludedNames]of Object.entries(ex)){if(!excludedNames.length)continue;
for(const inst of (mf.plugins[plugName]||[])){const b=inst.installPath;if(!fs.existsSync(b))continue;
for(const eName of excludedNames){
let found=false;
const sd=path.join(b,'skills');if(fs.existsSync(sd))for(const d of fs.readdirSync(sd)){const sm=path.join(sd,d,'SKILL.md');if(fs.existsSync(sm)){const c=fs.readFileSync(sm,'utf-8'),m=c.match(/^name:\\s*(.+)$/m);if((m?m[1].trim():d)===eName)found=true}}
if(fs.existsSync(path.join(b,'commands',eName+'.md')))found=true;
if(fs.existsSync(path.join(b,'agents',eName+'.md')))found=true;
if(fs.existsSync(path.join(b,eName+'.md')))found=true;
if(found)issues.push('excluded item still on disk: '+plugName.split('@')[0]+':'+eName)}}}

// Local items
const wd=pf.directory||process.cwd();const lc=path.join(wd,'.claude');const local=[];
if(fs.existsSync(lc)){
const ls=path.join(lc,'skills');if(fs.existsSync(ls))for(const d of fs.readdirSync(ls)){const sm=path.join(ls,d,'SKILL.md');if(fs.existsSync(sm)){const c=fs.readFileSync(sm,'utf-8'),m=c.match(/^name:\\s*(.+)$/m);local.push((m?m[1].trim():d)+' (skill)')}}
const lm=path.join(lc,'commands');if(fs.existsSync(lm))for(const f of fs.readdirSync(lm)){if(f.endsWith('.md'))local.push(f.replace('.md','')+' (cmd)');if(!f.endsWith('.md')&&fs.statSync(path.join(lm,f)).isDirectory())for(const sf of fs.readdirSync(path.join(lm,f))){if(sf.endsWith('.md'))local.push(f+':'+sf.replace('.md','')+' (cmd)')}}
const la=path.join(lc,'agents');if(fs.existsSync(la))for(const f of fs.readdirSync(la)){if(f.endsWith('.md')&&f!=='README.md')local.push(f.replace('.md','')+' (agent)')}}

// Auto-skills from config dir
const autoSkills=[];
for(const sub of ['commands','skills','agents']){const d=path.join(cd,sub);if(!fs.existsSync(d))continue;
for(const f of fs.readdirSync(d)){const fp=path.join(d,f);if(fs.statSync(fp).isDirectory()){for(const sf of fs.readdirSync(fp)){if(sf.endsWith('.md'))autoSkills.push(f+':'+sf.replace('.md','')+' ('+sub.slice(0,-1)+')')}}
else if(f.endsWith('.md'))autoSkills.push(f.replace('.md','')+' ('+sub.slice(0,-1)+')')}}

// Output
const ok=items.skills.filter(i=>i.status==='ok');
const okCmds=items.commands.filter(i=>i.status==='ok');
const okAgents=items.agents.filter(i=>i.status==='ok');
const totalOk=ok.length+okCmds.length+okAgents.length;
const pass=issues.length===0;

console.log('');
console.log('Profile: '+pn+' | '+(pass?'PASS':'FAIL'));
console.log('Plugins: '+pf.plugins.length+' | Items: '+totalOk+' active');
console.log('');
if(ok.length){console.log('Skills ('+ok.length+'):');for(const s of ok)console.log('  + '+s.name)}
if(okCmds.length){console.log('Commands ('+okCmds.length+'):');for(const c of okCmds)console.log('  + /'+c.name)}
if(okAgents.length){console.log('Agents ('+okAgents.length+'):');for(const a of okAgents)console.log('  + '+a.name)}
if(issues.length){console.log('');console.log('ISSUES ('+issues.length+'):');for(const i of issues)console.log('  ! '+i)}
if(local.length){console.log('');console.log('Local ('+local.length+', from '+wd+'/.claude/):');for(const l of local)console.log('  ~ '+l)}
if(autoSkills.length){console.log('');console.log('Auto ('+autoSkills.length+', from profile system):');for(const a of autoSkills)console.log('  ~ '+a)}
console.log('');
" 2>&1`

Display the output above exactly as-is.
