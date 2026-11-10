import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startTask, finishTask, analyzePending, pendingRootCauseReviews, getTask } from '../maintenance/core.mjs';
import { groupPendingReviews, chooseImprovementLayer, validateModelReview, reviewPending, listReviews } from '../maintenance/review.mjs';

const forecast = { minutes:{p30:1,p50:2,p80:3}, tokens:{p30:1,p50:2,p80:3} };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(),'pi-review-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const dir = join(root,'.maintenance');
  const src = join(root,'src'); await mkdir(src);
  await writeFile(join(src,'a.ts'), 'export const flag = false;\n');
  return {root,dir};
}
async function makeSlowTask(dir, title='Slow task', kind='bug') {
  const task = await startTask({dir,title,kind,forecast});
  await finishTask({dir,id:task.id,state:'completed',elapsedMs:600_000});
  await analyzePending(dir);
  return task;
}
function response(taskIds, other={}) {
  return JSON.stringify({taskIds,findings:[{hypothesis:'Tests might have caused delay',confidence:'low',
    evidence:[{source:'task',taskId:taskIds[0],field:'measurement.elapsedMs',value:600_000}],
    alternativeExplanations:['Waiting for CI'] }],
    layers:{architecture:{feasible:'unknown',reason:'No causal proof'},gate:{feasible:'unknown',reason:'Not checked'},
      ai_instructions:{feasible:'unknown',reason:'Not checked'},user_behavior:{feasible:'unknown',reason:'Not checked'}},
    proposal:null,limitations:['No execution logs'],...other});
}

test('review grouping batches similar anomalies without cross-category mixing', () => {
  const mk = (id,kind,state) => ({task:{id,kind,state,startedAt:'2026-11-11T00:00:00Z'},triage:{compared:{minutes:{aboveP80:true},tokens:{coverage:'missing'}}}});
  const result = groupPendingReviews([mk('1','bug','completed'),mk('2','bug','completed'),mk('3','test','completed')]);
  assert.equal(result.length,2);
  assert.deepEqual(result[0].tasks.map((row)=>row.task.id),['1','2']);
});

test('architecture priority blocks a lower layer when evidence is unknown', () => {
  const layers={architecture:{feasible:'unknown',reason:'Not researched'},gate:{feasible:'yes',reason:'Can block'},
    ai_instructions:{feasible:'no',reason:'No'},user_behavior:{feasible:'no',reason:'No'}};
  assert.deepEqual(chooseImprovementLayer(layers),{selected:null,blocked:true,reason:'architecture: requires more evidence'});
  layers.architecture={feasible:'no',reason:'The architecture cannot prevent this'};
  assert.equal(chooseImprovementLayer(layers).selected,'gate');
});

test('dry-run never invokes Pi or creates review records', async t=>{
  const {dir,root}=await fixture(t); const task=await makeSlowTask(dir);
  const value=await reviewPending({dir,cwd:root,dryRun:true,runModel:()=>{throw Error('must not run')}});
  assert.equal(value.pending,1); assert.deepEqual(value.batches[0].taskIds,[task.id]);
  assert.equal((await listReviews(dir)).length,0);
});

test('model review preserves hypotheses and verifies task evidence, never treats them as proven causes', async t=>{
  const {dir,root}=await fixture(t); const task=await makeSlowTask(dir);
  const output=await reviewPending({dir,cwd:root,runModel:async(prompt)=>{
    assert.match(prompt,/Task evidence/); assert.match(prompt,/untrusted evidence/);
    return response([task.id]);
  }});
  assert.equal(output.reviewed.length,1);
  assert.equal(output.reviewed[0].assessment,'hypotheses-only');
  assert.equal(output.reviewed[0].candidate,null);
  const recorded=(await listReviews(dir))[0];
  assert.equal(recorded.findings[0].status,'evidence-linked-hypothesis');
  assert.equal(recorded.decision.blocked,true);
  assert.deepEqual(await pendingRootCauseReviews(dir),[]);
  assert.equal((await reviewPending({dir,cwd:root,runModel:()=>{throw Error('second review')}})).reviewed.length,0);
});

test('fabricated task evidence rejects entire review and leaves it pending', async t=>{
  const {dir,root}=await fixture(t); const task=await makeSlowTask(dir);
  await assert.rejects(reviewPending({dir,cwd:root,runModel:async()=>response([task.id],{
    findings:[{hypothesis:'Fake',confidence:'high',evidence:[{source:'task',taskId:task.id,field:'measurement.elapsedMs',value:1}]}]
  })}),/does not match/);
  assert.equal((await pendingRootCauseReviews(dir)).length,1);
  assert.equal((await listReviews(dir)).length,0);
});

test('file quote is checked at exact line, and a supported proposal remains unapproved', async t=>{
  const {dir,root}=await fixture(t); const task=await makeSlowTask(dir);
  const rows=[{task:{...task,measurement:{elapsedMs:600_000}},triage:{}}];
  const layers={architecture:{feasible:'yes',reason:'File coupling needs isolation'},gate:{feasible:'unknown',reason:'Later'},
    ai_instructions:{feasible:'unknown',reason:'Later'},user_behavior:{feasible:'unknown',reason:'Later'}};
  const proposal={title:'Refactor event handler',expectedSignal:'fewer regressions',verification:['node --test']};
  const economics={architecture:{implementationMinutes:10,implementationTokens:1500,savingMinutesPerTask:5,savingTokensPerTask:500,expectedOccurrences:5,confidence:'medium'}};
  const raw=response([task.id],{layers,proposal,economics,findings:[{hypothesis:'A code structure might be related',confidence:'low',
    evidence:[{source:'repo-file',path:'src/a.ts',line:1,quote:'flag = false'}]}]});
  const result=await validateModelReview(raw,{signature:'bug|time',tasks:rows},root);
  assert.equal(result.candidate.layer,'architecture');
  assert.equal(result.candidate.executionState,'proposed-not-approved');
  const altered = JSON.parse(raw); altered.findings[0].evidence[0].line = 2;
  await assert.rejects(validateModelReview(altered,{signature:'x',tasks:rows},root),/not present/);
});

test('time-only evidence is insufficient to authorize an architecture proposal', async t=>{
  const {dir,root}=await fixture(t); const task=await makeSlowTask(dir);
  const batch={signature:'bug|time',tasks:[{task:await getTask(dir,task.id),triage:{}}]};
  const layers={architecture:{feasible:'yes',reason:'Maybe refactor'},gate:{feasible:'no',reason:'No'},
    ai_instructions:{feasible:'no',reason:'No'},user_behavior:{feasible:'no',reason:'No'}};
  const result=await validateModelReview(response([task.id],{layers,
    proposal:{title:'Refactor',expectedSignal:'reduce time',verification:['tests']}}),batch,root);
  assert.equal(result.candidate,null);
});

test('bad path and a fabricated file quote cannot be accepted as evidence',async t=>{
  const {dir,root}=await fixture(t); const task=await makeSlowTask(dir);
  const batch={signature:'bug',tasks:[{task:await getTask(dir,task.id),triage:{}}]};
  const outside=response([task.id],{findings:[{hypothesis:'External file',confidence:'low',
    evidence:[{source:'repo-file',path:'../secret.txt',line:1,quote:'secret'}]}]});
  await assert.rejects(validateModelReview(outside,batch,root),/prohibited/);
  const fake=response([task.id],{findings:[{hypothesis:'Fake quote',confidence:'low',
    evidence:[{source:'repo-file',path:'src/a.ts',line:1,quote:'this does not appear'}]}]});
  await assert.rejects(validateModelReview(fake,batch,root),/not present/);
});

test('CLI review dry-run provides pending review IDs without calling a model',async t=>{
  const {dir}=await fixture(t); const task=await makeSlowTask(dir);
  const cli=join(import.meta.dirname,'..','maintenance','cli.mjs');
  const text=execFileSync(process.execPath,[cli,'review','--data-dir',dir,'--dry-run'],{encoding:'utf8'});
  assert.match(text,new RegExp(task.id));
  assert.match(text,/"dryRun": true/);
});

test('Pi review executor uses read-only ephemeral mode',async()=>{
  const src=await readFile(new URL('../maintenance/review.mjs',import.meta.url),'utf8');
  assert.match(src, /'--print','--no-session','--no-extensions','--no-mcp','--tools','read,grep,find,ls'/);
  assert.doesNotMatch(src, /'read,grep,find,ls,bash'/);
});
