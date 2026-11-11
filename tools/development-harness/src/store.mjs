import { execFileSync } from 'node:child_process';
import { mkdir, open, readFile, rename, unlink, stat } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

export function projectPaths(cwd) {
  const here = resolve(cwd);
  try {
    const root = execFileSync('git',['rev-parse','--show-toplevel'],{cwd:here,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    const common = execFileSync('git',['rev-parse','--git-common-dir'],{cwd:here,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    return { root, dir:join(isAbsolute(common)?common:resolve(here,common),'development-harness') };
  } catch {
    return {root:here,dir:join(here,'.dh-state')};
  }
}
export async function readState(dir) {
  try {return JSON.parse(await readFile(join(dir,'state.json'),'utf8'));}
  catch(e){if(e.code==='ENOENT')return {schemaVersion:1,tasks:{},sessions:{},queue:{},seen:{},events:[]};throw e;}
}
async function atomicWrite(path, value) {
  const name = `${path}.${randomUUID()}.tmp`;
  const file=await open(name,'wx',0o600);
  try { await file.writeFile(JSON.stringify(value,null,2)+'\n'); }
  finally { await file.close(); }
  await rename(name,path);
}
const sleep = ms => new Promise(ok=>setTimeout(ok,ms));
async function clearAbandonedLock(path){
  try {
    const info=await stat(path);
    if(Date.now()-info.mtimeMs<30_000)return false;
    let owner;
    try {owner=JSON.parse(await readFile(path,'utf8'))} catch {owner=null}
    if(owner?.pid&&Number.isSafeInteger(owner.pid)){
      try {process.kill(owner.pid,0);return false} catch(e){if(e.code!=='ESRCH')return false}
    }
    await unlink(path);return true;
  } catch(e){if(e.code==='ENOENT')return false;throw e}
}
export async function withState(dir, fn) {
  await mkdir(dir,{recursive:true});
  const lock=join(dir,'.state.lock');
  let fd;
  for(let i=0;i<75;i++){
    try{fd=await open(lock,'wx',0o600);break}
    catch(e){if(e.code!=='EEXIST')throw e;await clearAbandonedLock(lock);if(i===74)throw Error(`State lock timed out: ${lock}`);await sleep(20)}
  }
  try {
    await fd.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
    const state=await readState(dir);
    const result=await fn(state);
    await atomicWrite(join(dir,'state.json'),state);
    return result;
  } finally {await fd.close();await unlink(lock)}
}
export async function readProjectConfig(root) {
  let config;
  try {config=JSON.parse(await readFile(join(root,'.devh.json'),'utf8'))}
  catch(e){if(e.code==='ENOENT')return {checks:[],forecastSeed:null};throw e}
  if(!Array.isArray(config.checks) || config.checks.length>4)throw Error('Invalid trusted project checks');
  for(const c of config.checks){
    if(!Array.isArray(c) || c.length<2 || c.length>12 || c[0]!=='npm' || c[1]!=='run' || !c.slice(2).every(s=>/^[a-zA-Z0-9:_-]+$/.test(s))) throw Error('Only explicit npm run script checks supported');
  }
  return config;
}
export function enqueue(state, type, taskId, reason) {
  const key = `${type}:${taskId}`;
  if (!state.queue[key]) state.queue[key]={type,taskId,reason,state:'pending',attempts:0,createdAt:new Date().toISOString()};
  return key;
}
