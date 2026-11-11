import { createHash, randomUUID } from 'node:crypto';
import { constants, watch } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { branchDecisions, decisionSchema } from './decisions.ts';

export const snapshotSchema = z.object({
  version: z.literal(1),
  mainSessionId: z.string().min(1),
  product: z.string().min(1),
  activeLeafId: z.string().min(1),
  decisions: z.array(decisionSchema),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PolicySnapshot = z.infer<typeof snapshotSchema>;

const dirKey = (id: string) => createHash('sha256').update(id).digest('hex').slice(0,40);
const revisionOf = (mainId: string, leafId: string, ids: readonly string[]) =>
  createHash('sha256').update(JSON.stringify([mainId, leafId, ids])).digest('hex');

export function makePolicySnapshot(
  mainSessionId: string, product: string, activeLeafId: string,
  entries: readonly unknown[],
): PolicySnapshot {
  if (!mainSessionId || !activeLeafId) throw Error('policy-main-active-leaf-required');
  const decisions = branchDecisions(entries as Parameters<typeof branchDecisions>[0], mainSessionId);
  return snapshotSchema.parse({
    version:1,mainSessionId,product,activeLeafId,decisions,
    revision:revisionOf(mainSessionId,activeLeafId,decisions.map(d=>d.id)),
  });
}

async function root(): Promise<string> {
  const home = await realpath(homedir());
  const pi = join(home,'.pi');
  for(const [path,mode] of [[pi,0o700],[join(pi,'compose'),0o700],
    [join(pi,'compose','policy-snapshots-v1'),0o700]] as const) {
    await mkdir(path,{recursive:false,mode}).catch((e:NodeJS.ErrnoException)=>{
      if(e.code!=='EEXIST')throw e;
    });
    const info = await lstat(path);
    if(!info.isDirectory()||info.isSymbolicLink()||
       (path===pi ? (info.mode&0o022)!==0 : (info.mode&0o077)!==0)||
       (typeof process.getuid==='function'&&info.uid!==process.getuid()))
      throw Error('unsafe-policy-directory');
  }
  return join(pi,'compose','policy-snapshots-v1');
}
async function pathFor(mainSessionId: string): Promise<string> {
  if(!mainSessionId)throw Error('policy-main-id-required');
  return join(await root(),dirKey(mainSessionId)+'.json');
}
async function safeRead(path:string):Promise<string>{
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=await file.stat();
    if(!info.isFile()||info.size>256*1024||(info.mode&0o077)!==0||
       (typeof process.getuid==='function'&&info.uid!==process.getuid()))
      throw Error('unsafe-policy-snapshot');
    return await file.readFile({encoding:'utf8'});
  }finally{await file.close();}
}
export async function readPolicySnapshot(mainSessionId:string):Promise<PolicySnapshot|undefined>{
  const path=await pathFor(mainSessionId);
  let data:string;
  try{data=await safeRead(path);}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
  const snapshot=snapshotSchema.parse(JSON.parse(data));
  if(snapshot.mainSessionId!==mainSessionId ||
     snapshot.revision!==revisionOf(mainSessionId,snapshot.activeLeafId,
       snapshot.decisions.map(d=>d.id)))throw Error('invalid-policy-snapshot');
  return snapshot;
}

export async function writePolicySnapshot(snapshot:PolicySnapshot):Promise<void>{
  const valid=snapshotSchema.parse(snapshot);
  if(valid.revision!==revisionOf(valid.mainSessionId,valid.activeLeafId,
      valid.decisions.map(d=>d.id)))throw Error('invalid-policy-snapshot-revision');
  const path=await pathFor(valid.mainSessionId);
  const body=JSON.stringify(valid);
  if(Buffer.byteLength(body,'utf8')>240*1024)throw Error('policy-snapshot-too-large');
  const temp=path+'.'+randomUUID()+'.tmp';
  const file=await open(temp,'wx',0o600);
  try{await file.writeFile(body,'utf8');await file.sync();}
  finally{await file.close();}
  try{
    await rename(temp,path);
    const dir=await open(dirname(path),'r');
    try{await dir.sync();}finally{await dir.close();}
  }finally{await unlink(temp).catch(()=>{});}
}
export async function watchPolicySnapshot(
  mainSessionId:string,onChange:()=>void,
):Promise<()=>void>{
  const directory=await root();
  const filename=dirKey(mainSessionId)+'.json';
  const watcher=watch(directory,{persistent:false},(_event,name)=>{
    if(name===null||name===filename)onChange();
  });
  watcher.on('error',()=>watcher.close());
  return ()=>watcher.close();
}
