import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ingest,getReport} from '../src/core.mjs';
import {processQueue} from '../src/worker.mjs';

const step={id:'delivery',goal:'Fix handshake bug',ac:['Auth callback returns success'],dependencies:[]};
async function setup(t,{criterion=step.ac[0],command=['npm','run','check'],script='node -e "process.exit(0)"',checks=[]}={}){
  const cwd=await mkdtemp(join(tmpdir(),'devh-ac-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
  execFileSync('git',['init','-q'],{cwd});
  await writeFile(join(cwd,'.devh.json'),JSON.stringify({checks,acceptanceContracts:{delivery:[{criterion,command}]}}));
  await writeFile(join(cwd,'package.json'),JSON.stringify({scripts:{check:script}}));
  return cwd;
}
async function complete(cwd,plan=[step]){
  const x=await ingest({cwd,agent:'codex',sessionId:'a',turnId:'1',event:'prompt',prompt:'Fix handshake bug',plan,eventId:'prompt1'});
  await ingest({cwd,agent:'codex',sessionId:'a',turnId:'1',event:'settled',eventId:'settled1'});
  await processQueue(cwd);
  return (await getReport(cwd)).tasks.find(t=>t.id===x.taskId);
}
test('Project-owner AC contract gives independent check receipts scoped to each criterion',async t=>{
  const cwd=await setup(t);const task=await complete(cwd);
  assert.equal(task.status,'completed');
  assert.equal(task.acceptance.state,'verified-by-contract');
  assert.equal(task.steps[0].status,'verified-by-contract');
  assert.deepEqual(task.verification.results.map(x=>x.criterion),['Auth callback returns success']);
  assert.equal(task.verification.results[0].exitCode,0);
});
test('Unrelated successful check is not semantic completion',async t=>{
  const cwd=await setup(t,{criterion:'Something else',checks:[['npm','run','check']]});const task=await complete(cwd);
  assert.equal(task.status,'delivered-unverified');
  assert.deepEqual(task.acceptance.steps.delivery.missing,['Auth callback returns success']);
  assert.equal(task.verification.results.length,1);
});
test('Failed project-owner AC check cannot complete task',async t=>{
  const cwd=await setup(t,{script:'node -e "process.exit(3)"'});const task=await complete(cwd);
  assert.equal(task.status,'verification-failed');
  assert.equal(task.acceptance.steps.delivery.state,'failed');
});
test('Provider hook cannot claim verification',async t=>{
  const cwd=await setup(t);await assert.rejects(()=>ingest({cwd,agent:'codex',sessionId:'a',turnId:'1',event:'verify-passed'}),/worker/);
});
