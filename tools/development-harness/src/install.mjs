import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const readJson=async path=>{try{return JSON.parse(await readFile(path,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}};
const safeWrite=async(path,data)=>{await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600})};
/** One-time, opt-in. Does not touch global user settings or overwrite existing hook files. */
export async function installProject(project){
 const root=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:resolve(project),encoding:'utf8'}).trim();
 const script=fileURLToPath(new URL('../adapters/codex-hook.mjs',import.meta.url));
 const piExt=fileURLToPath(new URL('../adapters/pi-extension.ts',import.meta.url));
 const existing=await readJson(join(root,'.codex','hooks.json'))??{hooks:{}};
 if(!existing.hooks||typeof existing.hooks!=='object')throw Error('Existing hooks.json has unsupported structure');
 const config=await readJson(join(root,'.devh.json'));
 const pkg=await readJson(join(root,'package.json'));
 const changes=[];
 if(!config){
   const checks=pkg?.scripts?.check?[['npm','run','check']]:[];
   await safeWrite(join(root,'.devh.json'),{checks});changes.push('.devh.json');
 }
 const command=`node ${JSON.stringify(script)}`;
 for(const event of ['UserPromptSubmit','PreModelRequest','PostModelRequest','Stop','Interrupt']){
   const arr=existing.hooks[event]??[];
   if(!Array.isArray(arr))throw Error('Existing hook event has unsupported structure: '+event);
   if(!arr.some(g=>g?.hooks?.some(h=>h.command===command))){
     arr.push({hooks:[{type:'command',command,timeout:event==='Interrupt'?3:15}]});
     changes.push(`.codex/hooks.json#${event}`);
   }
   existing.hooks[event]=arr;
 }
 const hookPath=join(root,'.codex','hooks.json');
 const before=await readJson(hookPath);
 if(before){
   // Never rewrite an existing owner's configuration automatically.
   const suggestion=join(root,'.codex','devh-hooks.merge-example.json');
   if(!(await readJson(suggestion)))await safeWrite(suggestion,existing);
   changes.push('.codex/devh-hooks.merge-example.json (review and merge manually)');
 }else {await safeWrite(hookPath,existing);changes.push('.codex/hooks.json')}
 const settingsPath=join(root,'.pi','settings.json');
 const piSettings=await readJson(settingsPath)??{};
 if(piSettings.extensions!==undefined&&!Array.isArray(piSettings.extensions))throw Error('Unsupported Pi extensions configuration');
 if(!piSettings.extensions?.includes(piExt)){
   const proposal={...piSettings,extensions:[...(piSettings.extensions??[]),piExt]};
   if(await readJson(settingsPath)){
     const dest=join(root,'.pi','devh-settings.merge-example.json');
     if(!(await readJson(dest)))await safeWrite(dest,proposal);
     changes.push('.pi/devh-settings.merge-example.json (review and merge manually)');
   }else{await safeWrite(settingsPath,proposal);changes.push('.pi/settings.json')}
 }
 return {root,changes,requiresTrust:'Review project hooks with Codex /hooks and trust the project in Pi',
   requiresChecks:!(config?.checks??(pkg?.scripts?.check?[1]:[])).length};
}
