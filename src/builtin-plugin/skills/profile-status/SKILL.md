---
name: profile-status
description: Show the current profile's configuration — plugins, settings, directories, model, effort level, and flags
---

Run the following command to read the current profile's status:

!`node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const cd=process.env.CLAUDE_CONFIG_DIR;
if(!cd){console.log('Not running under a profile (no CLAUDE_CONFIG_DIR)');process.exit(0)}
const pp=cd.split(path.sep),pn=pp[pp.lastIndexOf('config')-1];
const pfPath=path.join(os.homedir(),'.claudeworks','profiles.json');
if(!fs.existsSync(pfPath)){console.log('profiles.json not found');process.exit(0)}
const pf=JSON.parse(fs.readFileSync(pfPath,'utf-8')).profiles[pn];
if(!pf){console.log('Profile not found: '+pn);process.exit(0)}
const st=JSON.parse(fs.readFileSync(path.join(cd,'settings.json'),'utf-8'));

console.log('');
console.log('Profile: '+pn);
console.log('');
console.log('Description: '+(pf.description||'(none)'));
console.log('Default: '+(pf.isDefault?'Yes':'No'));
console.log('Alias: '+(pf.alias||'(none)'));
console.log('');
console.log('Model: '+(pf.model||st.model||'(default)'));
console.log('Effort: '+(pf.effortLevel||st.effortLevel||'(default)'));
console.log('Voice: '+(pf.voiceEnabled?'Enabled':'Disabled'));
console.log('Auth: '+(pf.useDefaultAuth!==false?'Default (shared)':'Separate'));
console.log('');
console.log('Directories:');
const dirs=pf.directories||(pf.directory?[pf.directory]:[]);
if(dirs.length===0)console.log('  (none configured)');
else for(const d of dirs)console.log('  '+d);
console.log('');
console.log('Plugins ('+pf.plugins.length+'):');
for(const p of pf.plugins){
  const excluded=(pf.excludedItems||{})[p]||[];
  console.log('  '+p.split('@')[0]+(excluded.length?' ('+excluded.length+' excluded)':''));
}
console.log('');
if(pf.customFlags)console.log('Custom flags: '+pf.customFlags);
if(pf.launchFlags?.dangerouslySkipPermissions)console.log('Dangerous mode: Enabled');
if(pf.launchFlags?.verbose)console.log('Verbose: Enabled');
if(pf.env&&Object.keys(pf.env).length>0){console.log('Environment:');for(const[k,v]of Object.entries(pf.env))console.log('  '+k+'='+v)}
if(pf.tags&&pf.tags.length>0)console.log('Tags: '+pf.tags.join(', '));
if(pf.lastLaunched)console.log('Last launched: '+new Date(pf.lastLaunched).toLocaleString());
console.log('');
" 2>&1`

Display the output above as a formatted status report. Do not modify or interpret it.
