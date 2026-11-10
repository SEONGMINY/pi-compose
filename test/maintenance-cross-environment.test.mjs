import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTask, finishTask, triageTask } from '../maintenance/core.mjs';
import { recordExternalUsage, listExternalUsage } from '../maintenance/usage.mjs';
import { chooseCostAwareLayer, validateModelReview } from '../maintenance/review.mjs';

const forecast = { minutes:{p30:1,p50:2,p80:3}, tokens:{p30:1,p50:2,p80:3} };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(),'maintenance-env-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return dir;
}

test('ChatGPT usage can be attached without pretending it came from Pi telemetry',async t=>{
  const dir=await fixture(t);
  const task=await startTask({dir,title:'Implement maintenance',forecast,environment:'chatgpt'});
  const receipt=await recordExternalUsage({dir,taskId:task.id,provider:'chatgpt',runId:'usage-turn-001',
    totalTokens:500,provenance:'provider-export',reference:'provider usage statement 2026-11-11'});
  assert.equal(receipt.verification,'not-independently-verified');
  const done=await finishTask({dir,id:task.id});
  assert.equal(done.environment,'chatgpt');
  assert.equal(done.measurement.tokens.totalTokens,500);
  assert.equal(done.measurement.tokens.provenance,'external-reported');
  assert.equal(done.measurement.tokens.coverage,'registered-sources-only');
  assert.equal(done.measurement.tokens.input,null); // no breakdown was invented
  assert.equal(done.measurement.tokens.externalSources[0].provider,'chatgpt');
  assert.equal(triageTask(done).compared.tokens.actual,500);
});

test('duplicate external run is rejected even across tasks',async t=>{
  const dir=await fixture(t);
  const a=await startTask({dir,title:'A',forecast});
  const b=await startTask({dir,title:'B',forecast});
  const args={dir,provider:'codex',runId:'step-abc',totalTokens:40,reference:'usage report'};
  await recordExternalUsage({...args,taskId:a.id});
  await assert.rejects(recordExternalUsage({...args,taskId:b.id}),/already recorded/);
  assert.equal((await listExternalUsage(dir,b.id)).length,0);
});

test('unavailable external usage stays unknown, not zero',async t=>{
  const dir=await fixture(t);
  const task=await startTask({dir,title:'No telemetry',forecast,environment:'chatgpt'});
  const done=await finishTask({dir,id:task.id});
  assert.equal(done.measurement.tokens,null);
  await assert.rejects(recordExternalUsage({dir,taskId:task.id,provider:'chatgpt',runId:'other-run',
    totalTokens:1,reference:'a'}),/after task finalization/);
});

test('Pi and other agent usage can be summed without replacing Pi baseline',async t=>{
  const dir=await fixture(t); const session=join(dir,'pi.jsonl'); await writeFile(session,'');
  const task=await startTask({dir,title:'Multi agent',forecast,sessions:[session]});
  await writeFile(session,JSON.stringify({type:'message',message:{role:'assistant',usage:{input:10,output:10,totalTokens:20}}})+'\n');
  await recordExternalUsage({dir,taskId:task.id,provider:'claude',runId:'claude-job-24',totalTokens:33,
    reference:'exported usage'});
  const done=await finishTask({dir,id:task.id});
  assert.equal(done.measurement.tokens.totalTokens,53);
  assert.equal(done.measurement.tokens.provenance,'mixed-pi-and-reported');
  assert.equal(done.measurement.tokens.input,10);
});

test('invalid and ungrounded usage records are rejected',async t=>{
  const dir=await fixture(t);const task=await startTask({dir,title:'A',forecast});
  const base={dir,taskId:task.id,provider:'chatgpt',runId:'run-x',reference:'manual reading'};
  await assert.rejects(recordExternalUsage({...base,totalTokens:-1}),/nonnegative/);
  await assert.rejects(recordExternalUsage({...base,totalTokens:1.5}),/nonnegative/);
  await assert.rejects(recordExternalUsage({...base,provider:'pi',totalTokens:10}),/Unsupported/);
  await assert.rejects(recordExternalUsage({...base,totalTokens:10,reference:''}),/reference/);
});

function layers({arch='yes',gate='yes'}={}) {
  return {architecture:{feasible:arch,reason:'why'},gate:{feasible:gate,reason:'why'},
    ai_instructions:{feasible:'no',reason:'n/a'},user_behavior:{feasible:'no',reason:'n/a'}};
}
const economics = (implementationMinutes, implementationTokens, savingMinutesPerTask, savingTokensPerTask,expectedOccurrences=5,confidence='high')=>({
  implementationMinutes,implementationTokens,savingMinutesPerTask,savingTokensPerTask,expectedOccurrences,confidence,
});

test('architecture wins when its projected payoff is reasonable',()=>{
  const e={architecture:economics(100,2000,30,600),gate:economics(10,100,2,20)};
  const r=chooseCostAwareLayer(layers(),e);
  assert.equal(r.selected,'architecture'); assert.equal(r.blocked,false);
});

test('architecture can yield to gate only when both resource costs are disproportionate',()=>{
  const e={architecture:economics(600,20000,2,60),gate:economics(10,100,5,100)};
  const r=chooseCostAwareLayer(layers(),e);
  assert.equal(r.selected,'gate');assert.equal(r.rejected[0].layer,'architecture');
});

test('uncertain cost and split time-token tradeoffs cannot silently drop architecture',()=>{
  const e={architecture:economics(600,100,2,200),gate:economics(10,50,5,100)};
  assert.equal(chooseCostAwareLayer(layers(),e).blocked,true);
  assert.equal(chooseCostAwareLayer(layers(),{}).blocked,true);
  assert.equal(chooseCostAwareLayer(layers(),{...e,architecture:{...e.architecture,confidence:'low'}}).blocked,true);
});

test('unknown architecture feasibility still blocks lower layer even with good ROI',()=>{
  const e={gate:economics(1,10,10,100)};
  assert.equal(chooseCostAwareLayer(layers({arch:'unknown'}),e).selected,null);
});

test('AI reviewer may only propose an economically assessed layer; costs are labeled forecasts',async t=>{
  const dir=await fixture(t);
  const source=join(dir,'a.js');await writeFile(source,'export const a = 1;\n');
  const task=await startTask({dir,title:'Investigate',forecast});
  await finishTask({dir,id:task.id,elapsedMs:600_000});
  const taskRecord={...task,measurement:{elapsedMs:600_000}};
  const raw=JSON.stringify({taskIds:[task.id], findings:[{hypothesis:'Possible coupling',confidence:'low',
    evidence:[{source:'repo-file',path:'a.js',line:1,quote:'const a = 1'}]}],
    layers:layers(),economics:{architecture:economics(10,100,5,50),gate:economics(10,100,2,20)},
    proposal:{title:'Untangle module',expectedSignal:'fewer retries',verification:['node --test']},limitations:[]});
  const result=await validateModelReview(raw,{signature:'bug',tasks:[{task:taskRecord,triage:{}}]},dir);
  assert.equal(result.candidate.layer,'architecture');
  assert.equal(result.decision.economicEvidence,'forecast-not-verified');
});
