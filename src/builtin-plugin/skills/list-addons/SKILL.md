---
name: list-addons
description: List all plugins, skills, agents, and commands available in the current profile with their status (active, excluded, local)
---

Run the following command to inspect the current profile's add-ons:

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const cd=process.env.CLAUDE_CONFIG_DIR;
if(!cd){console.log('Not running under a profile (no CLAUDE_CONFIG_DIR)');process.exit(0)}
const pp=cd.split(path.sep),pn=pp[pp.lastIndexOf('config')-1];
const pfPath=path.join(os.homedir(),'.claude-profiles','profiles.json');
if(!fs.existsSync(pfPath)){console.log('profiles.json not found');process.exit(0)}
const pf=JSON.parse(fs.readFileSync(pfPath,'utf-8')).profiles[pn];
if(!pf){console.log('Profile not found: '+pn);process.exit(0)}
const mf=JSON.parse(fs.readFileSync(path.join(cd,'plugins','installed_plugins.json'),'utf-8'));
const ex=pf.excludedItems||{};
const skills=[],commands=[],agents=[];

for(const[plugName,installs]of Object.entries(mf.plugins)){
  const short=plugName.split('@')[0];const pe=ex[plugName]||[];
  for(const inst of installs){const b=inst.installPath;
    if(!fs.existsSync(b))continue;

    const sd=path.join(b,'skills');
    if(fs.existsSync(sd))for(const d of fs.readdirSync(sd)){const sm=path.join(sd,d,'SKILL.md');if(!fs.existsSync(sm))continue;
      const c=fs.readFileSync(sm,'utf-8'),m=c.match(/^name:\\s*(.+)$/m);const n=m?m[1].trim():d;
      const desc=(c.match(/^description:\\s*(.+)$/m)||[])[1]||'';
      skills.push({name:short+':'+n,excluded:pe.includes(n),desc:desc.slice(0,80)})}

    const cd2=path.join(b,'commands');
    if(fs.existsSync(cd2))for(const f of fs.readdirSync(cd2)){if(!f.endsWith('.md'))continue;const n=f.replace('.md','');
      commands.push({name:short+':'+n,excluded:pe.includes(n)})}

    const ad=path.join(b,'agents');
    if(fs.existsSync(ad))for(const f of fs.readdirSync(ad)){if(!f.endsWith('.md')||f==='README.md')continue;const n=f.replace('.md','');
      agents.push({name:short+':'+n,excluded:pe.includes(n)})}
  }
}

// Local items from working directory
const wd=pf.directory||process.cwd();const lc=path.join(wd,'.claude');const local=[];
if(fs.existsSync(lc)){
  const ls=path.join(lc,'skills');if(fs.existsSync(ls))for(const d of fs.readdirSync(ls)){const sm=path.join(ls,d,'SKILL.md');if(fs.existsSync(sm))local.push(d+' (skill)')}
  const lm=path.join(lc,'commands');if(fs.existsSync(lm))for(const f of fs.readdirSync(lm)){if(f.endsWith('.md'))local.push(f.replace('.md','')+' (command)')}
  const la=path.join(lc,'agents');if(fs.existsSync(la))for(const f of fs.readdirSync(la)){if(f.endsWith('.md')&&f!=='README.md')local.push(f.replace('.md','')+' (agent)')}
}

console.log('');
console.log('Profile: '+pn);
console.log('Plugins: '+pf.plugins.length);
console.log('');
if(skills.length){
  const active=skills.filter(s=>!s.excluded);const excluded=skills.filter(s=>s.excluded);
  console.log('Skills ('+active.length+' active'+(excluded.length?', '+excluded.length+' excluded':'')+'):');
  for(const s of active)console.log('  + '+s.name+(s.desc?' — '+s.desc:''));
  for(const s of excluded)console.log('  - '+s.name+' (excluded)');
}
if(commands.length){
  const active=commands.filter(c=>!c.excluded);const excluded=commands.filter(c=>c.excluded);
  console.log('Commands ('+active.length+' active'+(excluded.length?', '+excluded.length+' excluded':'')+'):');
  for(const c of active)console.log('  + /'+c.name);
  for(const c of excluded)console.log('  - /'+c.name+' (excluded)');
}
if(agents.length){
  const active=agents.filter(a=>!a.excluded);const excluded=agents.filter(a=>a.excluded);
  console.log('Agents ('+active.length+' active'+(excluded.length?', '+excluded.length+' excluded':'')+'):');
  for(const a of active)console.log('  + '+a.name);
  for(const a of excluded)console.log('  - '+a.name+' (excluded)');
}
if(local.length){console.log('');console.log('Local (from '+wd+'/.claude/):');for(const l of local)console.log('  ~ '+l)}
console.log('');
" 2>&1`

Display the output above as a formatted summary. Do not modify or interpret it.
