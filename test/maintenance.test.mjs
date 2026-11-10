import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  parseQuantiles, validateForecast, summarizePiSession, startTask,
  finishTask, getTask, analyzePending, calibration,
} from '../maintenance/core.mjs';

const forecast = { minutes: { p30: 1, p50: 2, p80: 4 }, tokens: { p30: 20, p50: 100, p80: 400 } };

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'compose-maintenance-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function assistant(id, usage) {
  return JSON.stringify({ type: 'message', id, message: { role: 'assistant', usage } }) + '\n';
}

const u = (tokens) => ({ input: tokens / 2, output: tokens / 2, cacheRead: 0, cacheWrite: 0, totalTokens: tokens });

test('validation rejects inverted quantiles and malformed predictions', () => {
  assert.deepEqual(parseQuantiles('1,2,3','time'), { p30:1, p50:2, p80:3 });
  assert.throws(() => parseQuantiles('1,3,2','time'), /ascending/);
  assert.throws(() => validateForecast({ ...forecast, minutes: { p30: 1, p50: -1, p80: 4 } }), /nonnegative/);
});

test('Pi usage reads assistant, special usage, and compaction once', () => {
  const jsonl = assistant('a',u(20)) +
    JSON.stringify({ type:'usage', id:'b', usage:u(30) }) + '\n' +
    JSON.stringify({ type:'compaction', id:'c', usage:u(10) }) + '\n' +
    JSON.stringify({ type:'message', message: { role:'toolResult', usage:u(1000) } }) + '\n';
  const summary = summarizePiSession(jsonl);
  assert.equal(summary.totalTokens, 60);
  assert.equal(summary.usageEntries, 3);
});

test('start captures baseline; finish only counts added Pi usage', async (t) => {
  const dir = await fixture(t);
  const session = join(dir, 'pi.jsonl');
  await writeFile(session, assistant('old', u(70)));
  const started = await startTask({ dir, title:'New feature', kind:'feature', forecast, sessions:[session] });
  await appendFile(session, assistant('new',u(120)));
  await appendFile(session, JSON.stringify({type:'usage',id:'extra',usage:u(15)})+'\n');
  const ended = await finishTask({ dir, id:started.id, elapsedMs:150_000 });
  assert.equal(ended.state,'completed');
  assert.equal(ended.measurement.tokens.totalTokens,135);
  assert.equal(ended.measurement.elapsedBasis,'runner-monotonic');
  assert.equal(ended.measurement.activeMs,null);
  assert.equal((await getTask(dir,started.id)).measurement.tokens.input,67.5);
  await assert.rejects(finishTask({ dir, id:started.id }), /already finalized/);
});

test('no registered sessions yields UNKNOWN tokens rather than zero', async (t) => {
  const dir = await fixture(t);
  const task = await startTask({dir,title:'No session',forecast});
  const ended = await finishTask({dir,id:task.id});
  assert.equal(ended.measurement.tokens,null);
  assert.match(ended.measurement.caveat,/unknown/);
});

test('mutated Pi baseline cannot silently yield incorrect usage', async (t) => {
  const dir = await fixture(t);
  const session = join(dir,'pi.jsonl');
  await writeFile(session,assistant('old',u(20)));
  const task = await startTask({dir,title:'Mutating session',forecast,sessions:[session]});
  await writeFile(session,assistant('new',u(1000)) + assistant('another',u(1000)));
  await assert.rejects(finishTask({dir,id:task.id}), /prefix changed/);
  assert.equal((await getTask(dir,task.id)).state,'running');
});

test('analysis is idempotent, flags P80 exceedance but never invents a root cause', async (t) => {
  const dir = await fixture(t);
  const session = join(dir,'pi.jsonl');
  await writeFile(session,'');
  const task = await startTask({dir,title:'Slow',forecast,sessions:[session]});
  await appendFile(session,assistant('new',u(500)));
  await finishTask({dir,id:task.id,elapsedMs:5 * 60_000});
  const first = await analyzePending(dir);
  assert.equal(first.length,1);
  assert.equal(first[0].compared.minutes.aboveP80,true);
  assert.equal(first[0].compared.tokens.aboveP80,true);
  assert.equal(first[0].rootCause,'undetermined');
  assert.deepEqual(await analyzePending(dir),[]);
  const c = calibration([await getTask(dir,task.id)]);
  assert.equal(c.minutes.sampleCount,1);
  assert.equal(c.minutes.indicativeOnly,true);
});

test('CLI run records a process without requiring Pi or inventing token usage', async (t) => {
  const dir = await fixture(t);
  const cli = join(import.meta.dirname,'..','maintenance','cli.mjs');
  const output = execFileSync(process.execPath,[cli,'run','--data-dir',dir,'--title','Smoke','--time','0,1,2','--tokens','0,10,20','--',process.execPath,'-e','console.log(123)'],{encoding:'utf8'});
  assert.match(output, /"state": "completed"/);
  const list = execFileSync(process.execPath,[cli,'analyze','--data-dir',dir],{encoding:'utf8'});
  assert.match(list, /"calibration"/);
});

test('sessions created after task start are measurable', async (t) => {
  const dir = await fixture(t);
  const session = join(dir,'new-session.jsonl');
  const task = await startTask({dir,title:'New Pi session',forecast,sessions:[session]});
  await writeFile(session,assistant('first',u(40)));
  const ended = await finishTask({dir,id:task.id});
  assert.equal(ended.measurement.tokens.totalTokens,40);
});

test('malformed blank quantiles are rejected', () => {
  assert.throws(() => parseQuantiles('0,,3','time'), /expected three/);
});
