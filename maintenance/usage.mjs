import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const PROVIDERS = new Set(['chatgpt', 'codex', 'claude', 'other']);
const PROVENANCE = new Set(['provider-export', 'manual']);
function ensure(value, message) { if (!value) throw new Error(message); }
function isCount(n) { return Number.isSafeInteger(n) && n >= 0; }
const usageDir = (dir) => join(resolve(dir), 'external-usage');

/** A run is attributed to exactly one task. Never infer tokens from text length or UI activity. */
export async function recordExternalUsage({ dir, taskId, provider, runId, totalTokens, provenance = 'manual', reference }) {
  ensure(typeof taskId === 'string' && /^[a-f0-9-]{36}$/.test(taskId), 'Invalid task id');
  ensure(PROVIDERS.has(provider), 'Unsupported external provider (Pi JSONL uses --session)');
  ensure(typeof runId === 'string' && /^[a-zA-Z0-9_.:-]{3,128}$/.test(runId), 'Invalid run id');
  ensure(PROVENANCE.has(provenance), 'Invalid provenance');
  ensure(isCount(totalTokens), 'Tokens must be a nonnegative safe integer');
  ensure(typeof reference === 'string' && reference.trim().length > 0 && reference.length <= 240,
    'An external usage reference is required');
  const key = createHash('sha256').update(JSON.stringify([provider, runId])).digest('hex');
  const dirPath = usageDir(dir);
  const taskLock = join(resolve(dir), 'tasks', `${taskId}.json.lock`);
  let lock;
  try { lock = await open(taskLock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Task usage/finalization is in progress'); throw error; }
  try {
    const task = JSON.parse(await readFile(join(resolve(dir), 'tasks', `${taskId}.json`), 'utf8'));
    ensure(task.state === 'running', 'Cannot record usage after task finalization');
    await mkdir(dirPath, { recursive:true });
    const receipt = { schemaVersion:1, taskId, provider, runId, totalTokens,
      provenance, reference:reference.trim(), recordedAt:new Date().toISOString(),
      verification:'not-independently-verified',
      note:'Attribution is limited to this run. Imported usage does not prove complete task coverage.' };
    await writeFile(join(dirPath, `${key}.json`), JSON.stringify(receipt, null, 2) + '\n',
      { flag:'wx', mode:0o600 });
    return receipt;
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('External provider run already recorded (possibly in another task)');
    throw error;
  } finally {
    await lock.close(); await unlink(taskLock);
  }
}

export async function listExternalUsage(dir, taskId) {
  const dirPath = usageDir(dir);
  let names;
  try { names = await readdir(dirPath); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const rows = await Promise.all(names.filter(n => /^[a-f0-9]{64}\.json$/.test(n))
    .map(async n => JSON.parse(await readFile(join(dirPath, n), 'utf8'))));
  return rows.filter(row => row.taskId === taskId);
}

export async function summarizeExternalUsage(dir, taskId) {
  const receipts = await listExternalUsage(dir, taskId);
  const totalTokens = receipts.reduce((n, row) => {
    ensure(isCount(row.totalTokens) && isCount(n + row.totalTokens), 'External usage overflow');
    return n + row.totalTokens;
  }, 0);
  return { totalTokens, receipts: receipts.map(({ provider, runId, totalTokens, provenance, reference }) =>
    ({ provider, runId, totalTokens, provenance, reference })),
    coverage: receipts.length ? 'explicit-external-runs-only' : 'no-external-evidence' };
}
