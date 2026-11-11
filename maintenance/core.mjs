import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { summarizeExternalUsage } from './usage.mjs';

const VERSION = 1;
const LEVELS = ['p30', 'p50', 'p80'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

export function validateForecast(forecast) {
  assert(forecast && typeof forecast === 'object', 'Forecast is required');
  for (const dimension of ['minutes', 'tokens']) {
    const values = LEVELS.map((level) => forecast[dimension]?.[level]);
    assert(values.every(finiteNonnegative), `${dimension}: provide nonnegative numeric P30/P50/P80`);
    assert(values[0] <= values[1] && values[1] <= values[2], `${dimension}: require P30 <= P50 <= P80`);
  }
  return forecast;
}

export function parseQuantiles(input, label) {
  const raw = String(input ?? '').split(',').map((item) => item.trim());
  assert(raw.length === 3 && raw.every((item) => item !== ''), `${label}: expected three numbers P30,P50,P80`);
  const values = raw.map(Number);
  assert(values.length === 3 && values.every(finiteNonnegative), `${label}: expected three numbers P30,P50,P80`);
  assert(values[0] <= values[1] && values[1] <= values[2], `${label}: must be ascending`);
  return Object.fromEntries(LEVELS.map((level, index) => [level, values[index]]));
}

function usageFromEntry(entry) {
  if (entry?.type === 'message' && entry.message?.role === 'assistant') return entry.message.usage;
  if (entry?.type === 'usage' || entry?.type === 'compaction') return entry.usage;
  return undefined;
}

// Pi JSONL contains assistant usage, non-message usage and compaction usage.
// Count each entry once, independent of which conversation branch is active.
export function summarizePiSession(content) {
  const lines = content.split('\n');
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let totalTokens = 0;
  let usageEntries = 0;
  let parseErrors = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { parseErrors++; continue; }
    const usage = usageFromEntry(entry);
    if (!usage) continue;
    const values = ['input', 'output', 'cacheRead', 'cacheWrite'];
    if (!values.every((key) => finiteNonnegative(usage[key] ?? 0))) { parseErrors++; continue; }
    const total = usage.totalTokens ?? values.reduce((sum, key) => sum + (usage[key] ?? 0), 0);
    if (!finiteNonnegative(total)) { parseErrors++; continue; }
    input += usage.input ?? 0;
    output += usage.output ?? 0;
    cacheRead += usage.cacheRead ?? 0;
    cacheWrite += usage.cacheWrite ?? 0;
    totalTokens += total;
    usageEntries++;
  }
  return { input, output, cacheRead, cacheWrite, totalTokens, usageEntries, parseErrors };
}

async function snapshot(path) {
  const absolute = resolve(path);
  let data;
  try { data = await readFile(absolute); } catch (error) {
    if (error.code === 'ENOENT') return { path: absolute, bytes: 0, sha256: null, missingAtStart: true, summary: summarizePiSession('') };
    throw error;
  }
  const summary = summarizePiSession(data.toString('utf8'));
  assert(summary.parseErrors === 0, `Session ${absolute} contains malformed usage or JSON`);
  return { path: absolute, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), summary };
}

export async function snapshotSessions(paths = []) {
  const unique = [...new Set(paths.map((path) => resolve(path)))];
  return Promise.all(unique.map(snapshot));
}

export async function deltaSessions(baselines, additionalPaths = []) {
  const seen = new Map(baselines.map((item) => [item.path, item]));
  for (const path of additionalPaths) {
    const absolute = resolve(path);
    if (!seen.has(absolute)) seen.set(absolute, { path: absolute, bytes: 0, sha256: null, summary: summarizePiSession('') });
  }
  const sources = [];
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, usageEntries: 0 };
  for (const baseline of seen.values()) {
    const data = await readFile(baseline.path);
    assert(data.length >= baseline.bytes, `Session was truncated: ${baseline.path}`);
    if (baseline.sha256) {
      const oldHash = createHash('sha256').update(data.subarray(0, baseline.bytes)).digest('hex');
      assert(oldHash === baseline.sha256, `Session prefix changed: ${baseline.path}`);
    }
    // Only new records are attributed to this task; no double counting older turns.
    const slice = data.subarray(baseline.bytes).toString('utf8');
    // An earlier snapshot must end at an LF boundary; otherwise a partial line
    // could be erroneously counted as a new assistant message.
    if (baseline.bytes && data[baseline.bytes - 1] !== 10 && slice) throw new Error(`Incomplete baseline line in ${baseline.path}`);
    const usage = summarizePiSession(slice);
    assert(usage.parseErrors === 0, `Session ${baseline.path} has unparseable new lines`);
    for (const key of Object.keys(totals)) totals[key] += usage[key];
    sources.push({ path: baseline.path, ...usage });
  }
  return { ...totals, sources, coverage: sources.length ? 'explicit-sessions-only' : 'no-session-evidence' };
}

const taskPath = (dir, id) => join(resolve(dir), 'tasks', `${id}.json`);
const analysisPath = (dir, id) => join(resolve(dir), 'analysis', `${id}.json`);

async function atomicJson(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}

export async function getTask(dir, id) {
  assert(/^[a-f\d-]{36}$/.test(id), 'Invalid task id');
  return JSON.parse(await readFile(taskPath(dir, id), 'utf8'));
}

export async function listTasks(dir) {
  const tasks = join(resolve(dir), 'tasks');
  let names;
  try { names = await readdir(tasks); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) =>
    JSON.parse(await readFile(join(tasks, name), 'utf8'))));
}

export async function startTask({ dir, title, kind = 'other', forecast, sessions = [], assumptions = '', environment = 'unknown', forecastProvenance = {source:'manual'} }) {
  assert(typeof title === 'string' && title.trim(), 'Task title is required');
  assert(typeof kind === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(kind), 'Invalid task kind');
  assert(typeof environment === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(environment), 'Invalid task environment');
  validateForecast(forecast);
  const baselines = await snapshotSessions(sessions);
  const startedAt = new Date().toISOString();
  const task = { schemaVersion: VERSION, id: randomUUID(), title: title.trim(), kind, environment,
    forecast: structuredClone(forecast), forecastProvenance: structuredClone(forecastProvenance), assumptions, startedAt, state: 'running', baselines };
  const file = taskPath(dir, task.id);
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(task, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return task;
}

// Lock prevents two concurrent finish operations from both claiming success.
export async function finishTask({ dir, id, state = 'completed', sessions = [], elapsedMs }) {
  assert(['completed', 'failed', 'cancelled'].includes(state), 'Invalid final state');
  const lockFile = taskPath(dir, id) + '.lock';
  let lock;
  try { lock = await open(lockFile, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`Task ${id} is already being finalized`); throw error; }
  try {
    const task = await getTask(dir, id);
    assert(task.state === 'running', `Task already finalized: ${id}`);
    const usage = await deltaSessions(task.baselines, sessions);
    const external = await summarizeExternalUsage(dir, id);
    const tokenCounted = usage.coverage !== 'no-session-evidence' || external.receipts.length > 0;
    const tokens = tokenCounted ? { ...usage, ...(usage.coverage === 'no-session-evidence'
      ? { input:null, output:null, cacheRead:null, cacheWrite:null, usageEntries:null } : {}), totalTokens: usage.totalTokens + external.totalTokens,
      externalSources: external.receipts, provenance: external.receipts.length
        ? (usage.coverage !== 'no-session-evidence' ? 'mixed-pi-and-reported' : 'external-reported')
        : 'pi-jsonl', coverage: 'registered-sources-only' } : null;
    assert(!tokens || Number.isSafeInteger(tokens.totalTokens), 'Token aggregate overflow');
    const endedAt = new Date().toISOString();
    const wallMs = new Date(endedAt).getTime() - new Date(task.startedAt).getTime();
    const measuredMs = elapsedMs == null ? wallMs : elapsedMs;
    assert(finiteNonnegative(measuredMs), 'Invalid measured elapsed time');
    const next = { ...task, state, endedAt, measurement: {
      wallMs, elapsedMs: measuredMs, elapsedBasis: elapsedMs == null ? 'wall-clock' : 'runner-monotonic',
      activeMs: null, tokens,
      caveat: !tokenCounted
        ? 'No Pi sessions or external usage receipts; token usage is unknown, not zero.'
        : 'Totals include only registered Pi sessions and explicitly recorded external runs; unregistered activity is unknown.',
    } };
    await atomicJson(taskPath(dir, id), next);
    return next;
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}

export function triageTask(task) {
  assert(task.state !== 'running' && task.measurement, 'Task has no final measurement');
  const minutes = task.measurement.elapsedMs / 60000;
  const tokens = task.measurement.tokens?.totalTokens ?? null;
  const compare = (actual, predictions) => actual == null ? { actual: null, coverage: 'missing' } : {
    actual, coverage: 'observed', within: Object.fromEntries(LEVELS.map((level) => [level, actual <= predictions[level]])),
    aboveP80: actual > predictions.p80,
    ratioToP50: predictions.p50 > 0 ? actual / predictions.p50 : null,
  };
  const compared = { minutes: compare(minutes, task.forecast.minutes), tokens: compare(tokens, task.forecast.tokens) };
  return { schemaVersion: VERSION, taskId: task.id, state: task.state, compared,
    needsRootCauseReview: task.state !== 'completed' || compared.minutes.aboveP80 || compared.tokens.aboveP80,
    rootCause: 'undetermined',
    note: 'Single-task P80 exceedance is not proof of forecast miscalibration. Requires evidence and cohort calibration.',
  };
}

export async function analyzePending(dir) {
  const tasks = await listTasks(dir);
  const analyzed = [];
  for (const task of tasks) {
    if (task.state === 'running') continue;
    const file = analysisPath(dir, task.id);
    try { await stat(file); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const report = { ...triageTask(task), analyzedAt: new Date().toISOString() };
    await mkdir(resolve(file, '..'), { recursive: true });
    try { await writeFile(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; continue; }
    analyzed.push(report);
  }
  return analyzed;
}

export async function pendingRootCauseReviews(dir) {
  const folder = join(resolve(dir), 'analysis');
  let names;
  try { names = await readdir(folder); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const reports = await Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) =>
    JSON.parse(await readFile(join(folder, name), 'utf8'))));
  const reviewDir = join(resolve(dir), 'reviews');
  let reviewedIds = new Set();
  try {
    const reviewNames = await readdir(reviewDir);
    for (const name of reviewNames.filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))) {
      const review = JSON.parse(await readFile(join(reviewDir, name), 'utf8'));
      for (const id of review.taskIds ?? []) reviewedIds.add(id);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return reports.filter((report) => report.needsRootCauseReview && report.rootCause === 'undetermined'
    && !reviewedIds.has(report.taskId));
}

export function calibration(tasks) {
  const successful = tasks.filter((task) => task.state === 'completed' && task.measurement);
  const output = {};
  for (const dimension of ['minutes', 'tokens']) {
    const eligible = successful.map((task) => ({ prediction: task.forecast[dimension], actual: dimension === 'minutes'
      ? task.measurement.elapsedMs / 60000 : task.measurement.tokens?.totalTokens }))
      .filter((item) => finiteNonnegative(item.actual));
    output[dimension] = { sampleCount: eligible.length, indicativeOnly: eligible.length < 20,
      fractionsWithin: Object.fromEntries(LEVELS.map((level) => [level,
        eligible.length ? eligible.filter((row) => row.actual <= row.prediction[level]).length / eligible.length : null])) };
  }
  return output;
}
