import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { type HandoffPackage, validateHandoffPackage } from './package.ts';

const statusSchema = z.object({
  packageId:z.string().uuid(),
  status:z.enum(['pending','discussed','archived','duplicate']),
  updatedAt:z.string(),
  comparedLeafId:z.string().optional(),
});
export type InboxStatus = z.infer<typeof statusSchema>;
export type InboxItem = { pkg: HandoffPackage; status: InboxStatus };
const dirId = (sessionId: string): string =>
  createHash('sha256').update(sessionId).digest('hex').slice(0,40);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function privateRoot(): Promise<string> {
  // Guard each ancestor we create/reuse. No symlink path is accepted.
  const home = await realpath(homedir());
  const pi = join(home,'.pi');
  await mkdir(pi, {recursive:true,mode:0o700});
  const piInfo = await lstat(pi);
  if (!piInfo.isDirectory() || piInfo.isSymbolicLink() ||
      (piInfo.mode & 0o022) !== 0 ||
      (typeof process.getuid === 'function' && piInfo.uid !== process.getuid()))
    throw Error('unsafe-pi-directory');
  const compose = join(pi,'compose');
  const root = join(compose,'handoff-inbox-v1');
  for (const dir of [compose,root]) {
    await mkdir(dir,{mode:0o700}).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink() ||
        (info.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && info.uid !== process.getuid()))
      throw Error('unsafe-handoff-directory');
  }
  return root;
}

async function recipientDir(mainId: string): Promise<string> {
  if (!mainId) throw Error('main-session-id-required');
  const path = join(await privateRoot(),dirId(mainId));
  await mkdir(path,{mode:0o700}).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid()))
    throw Error('unsafe-recipient-directory');
  return path;
}

async function safeRead(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64*1024 ||
      (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid()))
    throw Error('unsafe-inbox-file');
  return readFile(path,'utf8');
}
async function atomicWrite(path: string, contents: string, replace: boolean): Promise<void> {
  const tmp = path + '.' + randomUUID() + '.tmp';
  const handle = await open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(contents,'utf8');
    await handle.sync();
  } finally { await handle.close(); }
  let persisted=false;
  try {
    if (replace) await rename(tmp,path);
    else await link(tmp,path); // hardlink is atomic and fails if destination exists
    persisted=true;
    // File fsync alone does not guarantee the name survives a sudden crash.
    // Sync the containing directory as well; failure prevents success reporting.
    const dirHandle=await open(dirname(path),'r');
    try {await dirHandle.sync();} finally {await dirHandle.close();}
  } finally {
    await unlink(tmp).catch(() => {});
  }
  if(!persisted)throw Error('handoff-write-not-committed');
}

export async function putHandoff(pkg: HandoffPackage): Promise<'stored'|'already-stored'> {
  const valid = validateHandoffPackage(pkg);
  const dir = await recipientDir(valid.targetMainSessionId);
  const path = join(dir,valid.id+'.json');
  const content = JSON.stringify(valid);
  if (Buffer.byteLength(content,'utf8') > 60*1024) throw Error('handoff-package-too-large');
  try {
    await atomicWrite(path,content,false);
    return 'stored';
  } catch(error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const previous = validateHandoffPackage(JSON.parse(await safeRead(path)));
    if (JSON.stringify(previous) !== content) throw Error('package-id-collision');
    return 'already-stored';
  }
}

export async function readHandoff(mainSessionId: string, id: string): Promise<HandoffPackage> {
  if (!ID.test(id)) throw Error('invalid-package-id');
  const dir = await recipientDir(mainSessionId);
  const pkg = validateHandoffPackage(JSON.parse(await safeRead(join(dir,id+'.json'))));
  if (pkg.targetMainSessionId !== mainSessionId) throw Error('handoff-wrong-recipient');
  return pkg;
}

export async function getInboxStatus(mainSessionId: string, id: string): Promise<InboxStatus> {
  if (!ID.test(id)) throw Error('invalid-package-id');
  const dir = await recipientDir(mainSessionId);
  try {
    const status = statusSchema.parse(JSON.parse(await safeRead(join(dir,id+'.status.json'))));
    if (status.packageId !== id) throw Error('wrong-inbox-status-id');
    return status;
  } catch(error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {packageId:id,status:'pending',updatedAt:''};
  }
}

export async function setInboxStatus(
  mainSessionId: string, id: string,
  status: InboxStatus['status'], comparedLeafId?: string,
): Promise<void> {
  await readHandoff(mainSessionId,id);
  const dir = await recipientDir(mainSessionId);
  const state = statusSchema.parse({
    packageId:id,status,updatedAt:new Date().toISOString(),
    ...(comparedLeafId?{comparedLeafId}:{}),
  });
  await atomicWrite(join(dir,id+'.status.json'),JSON.stringify(state),true);
}

export async function listInbox(mainSessionId: string): Promise<InboxItem[]> {
  const dir = await recipientDir(mainSessionId);
  const files = await readdir(dir);
  const results: InboxItem[] = [];
  for (const name of files.filter(file => ID.test(file.slice(0,-5)) && file.endsWith('.json'))) {
    const id = name.slice(0,-5);
    const pkg = await readHandoff(mainSessionId,id);
    const status = await getInboxStatus(mainSessionId,id);
    results.push({pkg,status});
  }
  return results.sort((a,b) => b.pkg.createdAt.localeCompare(a.pkg.createdAt));
}
