import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ingest,getReport,taskJsonView} from '../src/core.mjs';
import {processQueue,recoverQueue} from '../src/worker.mjs';
import {projectPaths,withState} from '../src/store.mjs';
import {trustedImprovementScope,SCOPE_CONTRACT_PATH} from '../src/scope.mjs';
import {captureSemanticEvidence,processSemanticQueue,validateSemanticVerdict} from '../src/semantic.mjs';
import {listModelCalls,measuredModelOutput} from '../src/improvement/model-run.mjs';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,stdio:'pipe',encoding:'utf8'}).trim();
async function fixture(t,{enabled=true}={}){
 const cwd=await mkdtemp(join(tmpdir(),'devh-semantic-'));
 t.after(()=>rm(cwd,{recursive:true,force:true}));
 git(cwd,'init','-q','-b','main');
 git(cwd,'config','user.name','Test');git(cwd,'config','user.email','test@example.test');
 await mkdir(join(cwd,'src'),{recursive:true});
 await writeFile(join(cwd,'src','feature.mjs'),'export const value=1;\n');
 await writeFile(join(cwd,'package.json'),JSON.stringify({name:'pi-compose',version:'0.1.0'}));
 await writeFile(join(cwd,'.devh.json'),JSON.stringify({checks:[],semanticReview:{enabled}}));
 const contract=join(cwd,SCOPE_CONTRACT_PATH);
 await mkdir(join(cwd,'tools/development-harness/contracts'),{recursive:true});
 await writeFile(contract,await readFile(new URL('../contracts/pi-compose-maintenance.json',import.meta.url)));
 git(cwd,'add','.');git(cwd,'commit','-qm','base');
 return cwd;
}
async function begin(cwd){return ingest({cwd,agent:'pi',sessionId:'semantic-demo',turnId:'one',event:'prompt',
 prompt:'Fix pi-compose Handoff so the session remains connected',eventId:'start:one'});}
async function complete(cwd){
 await ingest({cwd,agent:'pi',sessionId:'semantic-demo',turnId:'one',event:'settled',eventId:'settled:one'});
 return (await processQueue(cwd,{run:async()=>({state:'passed',results:[{ms:1,exitCode:0}],
  acceptance:{state:'verified-by-contract',steps:{delivery:{state:'verified-by-contract',receipts:[]}}}})}))[0];
}
const verdict=(kind='no-drift-observed')=>JSON.stringify({schemaVersion:1,verdict:kind,
 findings:[{kind:kind==='drift-evidenced'?'drift':'support',stepId:'delivery',path:'src/feature.mjs',
  quote:'+export const value=2;',reason:kind==='drift-evidenced'?'Modification does not address Handoff':'Patch is in the requested feature module'}],
 limitations:[]});

test('Code-changing pi-compose Task queues a separate JSON semantic audit after checks',async t=>{
 const cwd=await fixture(t);await begin(cwd);
 await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');
 const completed=await complete(cwd),report=await getReport(cwd);
 assert.equal(completed.state,'completed');
 assert.equal(report.queue.find(x=>x.type==='semantic')?.state,'pending');
 assert.equal(report.tasks[0].semanticGate.status,'pending');
 assert.equal(trustedImprovementScope(report.tasks[0]),false);
 const evidence=await captureSemanticEvidence(cwd,report.tasks[0]);
 assert.equal(evidence.state,'ready');assert.match(evidence.sha256,/^[a-f0-9]{64}$/);
 const json=taskJsonView(report.tasks[0]);
 assert.equal(json.scope.independentSemanticReview.status,'pending');
});

test('Anchored independent no-drift observation is advisory and metered',async t=>{
 const cwd=await fixture(t);await begin(cwd);
 await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');
 await complete(cwd);
 let modelPrompt='';
 const done=await processSemanticQueue(cwd,{runModel:async prompt=>{
   modelPrompt=prompt;return measuredModelOutput(verdict(),{totalTokens:120,coverage:'provider-observed'});
 }});
 assert.equal(done[0].state,'no-drift-observed');
 assert.match(modelPrompt,/pi-compose MAINTENANCE/);assert.match(modelPrompt,/Pi\/Codex are DEVELOPMENT TOOLS/);
 const report=(await getReport(cwd)).tasks[0];
 assert.equal(report.semanticGate.status,'no-drift-observed');
 assert.equal(report.status,'completed');
 assert.equal(trustedImprovementScope(report),true);
 assert.equal((await getReport(cwd)).queue.find(x=>x.type==='semantic').state,'done');
 const calls=await listModelCalls(projectPaths(cwd).dir);
 assert.equal(calls.length,1);assert.equal(calls[0].purpose,'scope-review');
 assert.equal(calls[0].tokens,120);assert.equal(calls[0].status,'returned');
 assert.equal(calls[0].taskIds[0],report.id);
 assert.equal((await processSemanticQueue(cwd,{runModel:async()=>{throw Error('must not rerun')}})).length,0);
});

test('An evidenced mismatch flags scope-review-required and blocks an existing improvement candidate',async t=>{
 const cwd=await fixture(t),started=await begin(cwd);
 await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');
 await complete(cwd);
 const {dir}=projectPaths(cwd);
 await withState(dir,s=>{s.queue['improve:stale']={type:'improve',reviewId:'stale',taskId:started.taskId,state:'pending',attempts:0};});
 const result=await processSemanticQueue(cwd,{runModel:async()=>verdict('drift-evidenced')});
 assert.equal(result[0].state,'drift-evidenced');
 const report=await getReport(cwd);
 assert.equal(report.tasks[0].status,'scope-review-required');
 assert.equal(report.tasks[0].semanticGate.findings[0].kind,'drift');
 assert.equal(report.queue.find(x=>x.type==='improve').state,'blocked');
 assert.equal(trustedImprovementScope(report.tasks[0]),false);
});

test('Model cannot invent evidence or grant unsupported verdicts',async t=>{
 const cwd=await fixture(t);await begin(cwd);
 await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');
 await complete(cwd);
 const task=(await getReport(cwd)).tasks[0],evidence=await captureSemanticEvidence(cwd,task);
 assert.throws(()=>validateSemanticVerdict({...JSON.parse(verdict()),findings:[]},evidence,task),/supporting evidence/);
 assert.throws(()=>validateSemanticVerdict({...JSON.parse(verdict()),findings:[{kind:'support',stepId:'delivery',path:'src/feature.mjs',quote:'fabricated content',reason:'x'}]},evidence,task),/Unattributed/);
 assert.throws(()=>validateSemanticVerdict({...JSON.parse(verdict()),findings:[{kind:'support',stepId:'nonexistent',path:'src/feature.mjs',quote:'+export const value=2;',reason:'x'}]},evidence,task),/Unattributed/);
 assert.throws(()=>validateSemanticVerdict({...JSON.parse(verdict('drift-evidenced')),findings:[{kind:'support',stepId:'delivery',path:'src/feature.mjs',quote:'+export const value=2;',reason:'x'}]},evidence,task),/Drift finding/);
 const result=await processSemanticQueue(cwd,{runModel:async()=>JSON.stringify({...JSON.parse(verdict()),findings:[]})});
 assert.equal(result[0].state,'unverified');
 const pending=(await getReport(cwd)).queue.find(x=>x.type==='semantic');
 assert.equal(pending.state,'pending');assert.ok(pending.nextAttemptAt);
 assert.equal((await getReport(cwd)).tasks[0].semanticGate.status,'unverified');
});

test('A model failure records its expense and preserves retryable work',async t=>{
 const cwd=await fixture(t);await begin(cwd);await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');await complete(cwd);
 const result=await processSemanticQueue(cwd,{runModel:async()=>{throw Error('no authenticated Pi on this host')}});
 assert.equal(result[0].state,'unverified');
 const calls=await listModelCalls(projectPaths(cwd).dir);
 assert.equal(calls[0].status,'failed');assert.equal(calls[0].tokens,null);
 assert.equal((await getReport(cwd)).queue.find(x=>x.type==='semantic').failures,1);
});

test('A file change during independent analysis makes the verdict stale',async t=>{
 const cwd=await fixture(t);await begin(cwd);await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');await complete(cwd);
 const r=await processSemanticQueue(cwd,{runModel:async()=>{
   await writeFile(join(cwd,'src','feature.mjs'),'export const value=3;\n');return verdict();
 }});
 assert.equal(r[0].state,'stale');
 const q=(await getReport(cwd)).queue.find(x=>x.type==='semantic');
 assert.equal(q.state,'pending');
 assert.equal((await getReport(cwd)).tasks[0].semanticGate.status,'unverified');
});

test('Sensitive or oversized diffs are never transmitted to model',async t=>{
 const cwd=await fixture(t);await begin(cwd);
 await writeFile(join(cwd,'src','feature.mjs'),`export const password='secrets-secret-value-123456';\n`);
 await complete(cwd);
 const r=await processSemanticQueue(cwd,{runModel:async()=>{throw Error('should not send')}});
 assert.equal(r[0].state,'unverified');
 assert.equal((await getReport(cwd)).tasks[0].semanticGate.reason,'possible-secret-in-diff');
 assert.equal((await listModelCalls(projectPaths(cwd).dir)).length,0);
});

test('Disabled independent review never silently grants autonomous edit permission',async t=>{
 const cwd=await fixture(t,{enabled:false});await begin(cwd);
 await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');await complete(cwd);
 const task=(await getReport(cwd)).tasks[0];
 assert.equal(task.semanticGate.status,'unverified');
 assert.equal(task.semanticGate.reason,'one-time-semantic-review-opt-in-required');
 assert.equal(trustedImprovementScope(task),false);
 assert.equal((await getReport(cwd)).queue.some(q=>q.type==='semantic'),false);
});

test('Abandoned semantic model work is recovered like verification jobs',async t=>{
 const cwd=await fixture(t);await begin(cwd);await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');await complete(cwd);
 const {dir}=projectPaths(cwd);
 await withState(dir,s=>{const q=s.queue[`semantic:${Object.keys(s.tasks)[0]}`];q.state='running';q.startedAt='2000-01-01T00:00:00Z';});
 const recovered=await recoverQueue(cwd,{olderThanMs:100});
 assert.equal(recovered.length,1);assert.equal((await getReport(cwd)).queue.find(q=>q.type==='semantic').state,'pending');
});

test('An approved scope document changed while the independent model was running blocks the Task',async t=>{
 const cwd=await fixture(t);await begin(cwd);
 await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');await complete(cwd);
 const r=await processSemanticQueue(cwd,{runModel:async()=>{
   const path=join(cwd,SCOPE_CONTRACT_PATH);const json=JSON.parse(await readFile(path,'utf8'));
   json.purpose+=' unauthorized';await writeFile(path,JSON.stringify(json));
   return verdict();
 }});
 assert.equal(r[0].state,'scope-review-required');
 const task=(await getReport(cwd)).tasks[0];
 assert.equal(task.status,'scope-review-required');
 assert.equal(task.scopeGate.basis,'scope-contract-changed');
 assert.equal((await getReport(cwd)).queue.find(q=>q.type==='semantic').state,'blocked');
 assert.equal(trustedImprovementScope(task),false);
});

test('Semantic review runs against original Task worktree even when queue is processed elsewhere',async t=>{
 const cwd=await fixture(t);await begin(cwd);
 await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');await complete(cwd);
 const other=await mkdtemp(join(tmpdir(),'devh-semantic-other-'));
 t.after(()=>rm(other,{recursive:true,force:true}));
 git(cwd,'worktree','add','-qb','second-branch',other);
 let inspectedCwd=null;
 const result=await processSemanticQueue(other,{runModel:async(_prompt,root)=>{
   inspectedCwd=root;return verdict();
 }});
 assert.equal(inspectedCwd,cwd);assert.equal(result[0].state,'no-drift-observed');
});

test('Review cannot cite a patch filename as proof of semantic compliance',async t=>{
 const cwd=await fixture(t);await begin(cwd);
 await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');await complete(cwd);
 const task=(await getReport(cwd)).tasks[0],e=await captureSemanticEvidence(cwd,task);
 const fake=JSON.parse(verdict());fake.findings[0].quote='src/feature.mjs';
 assert.throws(()=>validateSemanticVerdict(fake,e,task),/Unattributed/);
});

test('Separate subprocess follows the real Pi JSON event protocol with measured audit usage',async t=>{
 const cwd=await fixture(t);await begin(cwd);
 await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');await complete(cwd);
 const fakeDir=await mkdtemp(join(tmpdir(),'devh-fake-pi-'));
 t.after(()=>rm(fakeDir,{recursive:true,force:true}));
 const bin=join(fakeDir,'fake-pi-semantic.mjs');
 const body=`#!/usr/bin/env node\nconst answer=${JSON.stringify(verdict())};\n`+
   `process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:answer}],usage:{totalTokens:77},stopReason:'stop'}})+'\\n');\n`+
   `process.stdout.write(JSON.stringify({type:'agent_settled',aborted:false})+'\\n');\n`;
 await writeFile(bin,body,{mode:0o755});
 const {runPiJson}=await import('../src/improvement/model-run.mjs');
 const result=await processSemanticQueue(cwd,{runModel:(prompt,root)=>runPiJson(prompt,root,{executable:bin,
   tools:'',timeoutMs:5_000,maxObservedTokens:500})});
 assert.equal(result[0].state,'no-drift-observed');
 const call=(await listModelCalls(projectPaths(cwd).dir))[0];
 assert.equal(call.tokens,77);assert.equal(call.tokenCoverage,'assistant-and-compaction-events');
 const view=taskJsonView((await getReport(cwd)).tasks[0]);
 assert.equal(view.scope.independentSemanticReview.modelCost.observedTokens,77);
});

test('A Task held for semantic drift may be reopened for repair but cannot reuse its old review',async t=>{
 const cwd=await fixture(t),first=await begin(cwd);
 await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');await complete(cwd);
 await processSemanticQueue(cwd,{runModel:async()=>verdict('drift-evidenced')});
 const later=await ingest({cwd,agent:'pi',sessionId:'semantic-demo',turnId:'two',event:'prompt',
   prompt:'Continue correcting the Handoff implementation',taskIntent:'continue',eventId:'start:two'});
 assert.equal(later.taskId,first.taskId);
 const task=(await getReport(cwd)).tasks[0];
 assert.equal(task.status,'running');
 assert.equal(task.semanticGate,null);assert.equal(task.scopeGate,null);
 assert.equal(trustedImprovementScope(task),false);
});

test('A crashed/reclaimed semantic worker cannot overwrite a newer lease',async t=>{
 const cwd=await fixture(t);await begin(cwd);
 await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');await complete(cwd);
 const {dir}=projectPaths(cwd);
 const r=await processSemanticQueue(cwd,{runModel:async()=>{
   await withState(dir,s=>{const q=Object.values(s.queue).find(v=>v.type==='semantic');
     q.leaseId='newer-worker-lease';q.state='running';});
   return verdict();
 }});
 assert.equal(r[0].state,'lease-lost');
 const task=(await getReport(cwd)).tasks[0];
 assert.equal(task.semanticGate.status,'pending');
 assert.equal(trustedImprovementScope(task),false);
});
