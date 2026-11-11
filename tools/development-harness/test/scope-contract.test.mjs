import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {captureScope,assessTaskScope,validateScopeContract,getScopeContract,SCOPE_CONTRACT_PATH} from '../src/scope.mjs';
import {ingest,getReport,taskJsonView} from '../src/core.mjs';
import {processQueue} from '../src/worker.mjs';

const reference=new URL('../contracts/pi-compose-maintenance.json',import.meta.url);
const git=(cwd,...args)=>execFileSync('git',args,{cwd,stdio:'pipe',encoding:'utf8'}).trim();
async function fixture(t,{contract=true,pkg='pi-compose'}={}){
  const cwd=await mkdtemp(join(tmpdir(),'devh-scope-'));
  t.after(()=>rm(cwd,{recursive:true,force:true}));
  git(cwd,'init','-q');git(cwd,'config','user.name','Test');git(cwd,'config','user.email','test@example.com');
  await writeFile(join(cwd,'package.json'),JSON.stringify({name:pkg,version:'0.0.0'}));
  await writeFile(join(cwd,'.devh.json'),JSON.stringify({checks:[]}));
  if(contract){const path=join(cwd,SCOPE_CONTRACT_PATH);await mkdir(resolve(path,'..'),{recursive:true});
    await writeFile(path,await readFile(reference,'utf8'));}
  await mkdir(join(cwd,'docs'),{recursive:true});
  await writeFile(join(cwd,'docs','PRD.md'),'Approved product specification\n');
  await mkdir(join(cwd,'src'),{recursive:true});
  await writeFile(join(cwd,'src','feature.mjs'),'export const value=1;\n');
  git(cwd,'add','.');git(cwd,'commit','-qm','seed');
  return cwd;
}
const start=(cwd,prompt='Fix pi-compose Handoff')=>ingest({cwd,agent:'codex',sessionId:'session-a',turnId:'turn-1',event:'prompt',eventId:'start:turn-1',prompt});
const settle=cwd=>ingest({cwd,agent:'codex',sessionId:'session-a',turnId:'turn-1',event:'settled',eventId:'settled:turn-1'});
const accepted=async()=>({state:'passed',results:[{ms:4,exitCode:0}],reason:null,
  acceptance:{state:'verified-by-contract',steps:{delivery:{state:'verified-by-contract',receipts:[]}}}});
const run=async cwd=>{await settle(cwd);return (await processQueue(cwd,{run:accepted}))[0];};

test('The scope contract is JSON, uniquely IDed and carries approved boundaries',async()=>{
 const contract=JSON.parse(await readFile(reference,'utf8'));
 assert.equal(validateScopeContract(contract),contract);
 assert.equal(contract.appliesTo.packageName,'pi-compose');
 assert.equal(contract.appliesTo.developmentTarget,'pi-compose-codebase');
 assert.ok(contract.boundaries.excluded.some(s=>s.includes('upstream Pi')));
 assert.ok(contract.requirements.some(r=>r.id==='DH-08'));
 assert.throws(()=>validateScopeContract({...contract,revision:0}),/Invalid project scope/);
 assert.throws(()=>validateScopeContract({...contract,requirements:[...contract.requirements,contract.requirements[0]]}),/Invalid project scope/);
});

test('Task JSON pins the original approved scope and provides criterion-to-evidence slots',async t=>{
 const cwd=await fixture(t),startResult=await start(cwd);
 const item=(await getReport(cwd)).tasks[0];
 assert.equal(startResult.scope.status,'repository-anchored');
 assert.equal(item.scope.contract.id,'pi-compose-maintenance');
 assert.match(item.scope.contract.sha256,/^[a-f0-9]{64}$/);
 assert.equal(item.scope.contract.requirementIds.length,8);
 const result=await run(cwd);
 assert.equal(result.state,'completed');
 const view=taskJsonView((await getReport(cwd)).tasks[0]);
 assert.equal(view.status,'completed');
 assert.equal(view.scope.afterVerification.status,'no-violation-observed');
 assert.equal(view.plan.steps[0].criteria.length,1);
 assert.equal(view.originalForecast.provenance,'unavailable');
 assert.equal(view.scope.atStart.contract.sha256,item.scope.contract.sha256);
});

test('Changes to the approved scope contract cannot self-approve work',async t=>{
 const cwd=await fixture(t);await start(cwd);
 const file=join(cwd,SCOPE_CONTRACT_PATH);
 const changed=JSON.parse(await readFile(file,'utf8'));changed.purpose+=' changed by agent';
 await writeFile(file,JSON.stringify(changed,null,2));
 const result=await run(cwd);
 assert.equal(result.state,'scope-review-required');
 assert.equal(result.scopeGate.basis,'scope-contract-changed');
 const report=(await getReport(cwd));
 assert.equal(report.queue.some(q=>q.type==='review'),false);
 assert.equal(report.tasks[0].acceptance.state,'verified-by-contract');
});

test('Modifying an approved product decision document is held for review, even when checks pass',async t=>{
 const cwd=await fixture(t);await start(cwd);
 await writeFile(join(cwd,'docs','PRD.md'),'Unauthorized policy revision\n');
 const result=await run(cwd);
 assert.equal(result.state,'scope-review-required');
 assert.equal(result.scopeGate.basis,'protected-policy-path-modified');
 assert.deepEqual(result.scopeGate.protectedFiles,['docs/PRD.md']);
});

test('Normal project code edits do not trigger a false policy approval claim',async t=>{
 const cwd=await fixture(t);await start(cwd);
 await writeFile(join(cwd,'src','feature.mjs'),'export const value=2;\n');
 const result=await run(cwd);
 assert.equal(result.state,'completed');
 assert.equal(result.scopeGate.status,'no-violation-observed');
 assert.deepEqual(result.scopeGate.changedPaths,['src/feature.mjs']);
 assert.match(result.scopeGate.caveat,/semantic/);
});

test('Pi upstream work is flagged; references phrased as prohibitions are not approvals',async t=>{
 const cwd=await fixture(t);
 const flagged=await captureScope(cwd,'Develop upstream Pi runtime');
 assert.equal(flagged.status,'needs-review');
 assert.equal(flagged.basis,'explicit-external-target');
 const allowed=await captureScope(cwd,'Do not modify upstream Pi runtime; fix pi-compose Handoff');
 const korean=await captureScope(cwd,'Pi 자체를 개발하지 마세요. pi-compose만 수정');
 assert.equal(korean.status,'repository-anchored');
 assert.equal(allowed.status,'repository-anchored');
 await start(cwd,'Pi 자체를 개발');
 const result=await run(cwd);
 assert.equal(result.state,'scope-review-required');
});

test('Missing contract in pi-compose is flagged; unrelated repository stays unconfigured',async t=>{
 const cwd=await fixture(t,{contract:false});
 const flagged=await captureScope(cwd,'Fix feature');
 assert.equal(flagged.status,'needs-review');
 assert.equal(flagged.basis,'missing-pi-compose-scope-contract');
 const second=await fixture(t,{contract:false,pkg:'other-app'});
 assert.equal((await captureScope(second,'Fix feature')).status,'not-configured');
 assert.equal((await getScopeContract(second)).status,'not-configured');
});

test('Dirty initial git state preserves uncertainty rather than pretending to verify modifications',async t=>{
 const cwd=await fixture(t);
 await writeFile(join(cwd,'src','feature.mjs'),'export const value=5;\n');
 await start(cwd);
 const result=await run(cwd);
 assert.equal(result.state,'completed');
 assert.equal(result.scopeGate.status,'unverified');
 assert.equal(result.scopeGate.basis,'no-clean-git-baseline');
});

test('JSON CLI exposes both project contract and scoped Task without changing state',async t=>{
 const cwd=await fixture(t),started=await start(cwd);
 const bin=resolve('bin/devh.mjs');
 const contract=spawnSync(process.execPath,[bin,'contract'],{cwd,encoding:'utf8'});
 assert.equal(contract.status,0,contract.stderr);
 assert.equal(JSON.parse(contract.stdout).contract.id,'pi-compose-maintenance');
 const detail=spawnSync(process.execPath,[bin,'task',started.taskId],{cwd,encoding:'utf8'});
 assert.equal(detail.status,0,detail.stderr);
 const parsed=JSON.parse(detail.stdout);
 assert.equal(parsed.id,started.taskId);
 assert.equal(parsed.scope.atStart.contract.revision,1);
 assert.ok(parsed.plan.steps[0].criteria[0].criterion);
 const missing=spawnSync(process.execPath,[bin,'task','missing-id'],{cwd,encoding:'utf8'});
 assert.notEqual(missing.status,0);
});

test('Existing improvement candidate is blocked when its source Task requires scope review',async t=>{
 const cwd=await fixture(t),started=await start(cwd);
 await writeFile(join(cwd,'docs','PRD.md'),'Unapproved policy\n');
 await run(cwd);
 const {projectPaths,withState}=await import('../src/store.mjs');
 const {processImprovementQueue}=await import('../src/improvement/queue.mjs');
 const {dir}=projectPaths(cwd);
 await writeFile(join(dir,'automation-policy.json'),JSON.stringify({schemaVersion:1,mode:'draft',allowedPaths:['src/feature.mjs'],checks:['project'],allowAutoMain:false}));
 await withState(dir,s=>{s.queue['improve:fake']={type:'improve',taskId:started.taskId,reviewId:'fake',state:'pending',attempts:0};});
 assert.equal((await processImprovementQueue(cwd)).state,'idle');
 const state=await getReport(cwd);
 assert.equal(state.queue.find(q=>q.type==='improve').state,'blocked');
 assert.equal(state.queue.find(q=>q.type==='improve').reason,'scope-review-required');
});

test('Direct improvement invocation rejects stale Task scope before even proposing edits',async t=>{
 const cwd=await fixture(t),started=await start(cwd);
 await run(cwd);
 const {projectPaths}=await import('../src/store.mjs');
 const {executeImprovement}=await import('../src/improvement/change.mjs');
 const {randomUUID}=await import('node:crypto');
 const {dir}=projectPaths(cwd),reviewId=randomUUID();
 await mkdir(join(dir,'reviews'),{recursive:true});
 await writeFile(join(dir,'reviews',`${reviewId}.json`),JSON.stringify({
  id:reviewId,taskIds:[started.taskId],candidate:{executionState:'proposed-not-approved'}
 }));
 const policy=join(dir,'automation-policy.json');
 await writeFile(policy,JSON.stringify({schemaVersion:1,mode:'draft',allowedPaths:['src/feature.mjs'],checks:['project'],allowAutoMain:false}));
 const file=join(cwd,SCOPE_CONTRACT_PATH),changed=JSON.parse(await readFile(file,'utf8'));
 changed.purpose+=' changed after Task completion';await writeFile(file,JSON.stringify(changed,null,2));
 await assert.rejects(()=>executeImprovement({repo:cwd,dir,reviewId,policyFile:policy,dryRun:true}),/Scope contract has changed/);
});

test('Task JSON displays unknown Run tokens as null, not observed zero',async t=>{
 const cwd=await fixture(t);await start(cwd);
 const view=taskJsonView((await getReport(cwd)).tasks[0]);
 assert.equal(view.runIds[0].tokens,null);
 assert.equal(view.runIds[0].usageCoverage,'unknown');
});


test('An automatic improvement policy cannot allow edits to the approval contract or scope gate',async t=>{
 const cwd=await fixture(t);
 const {projectPaths}=await import('../src/store.mjs');
 const {readPolicy}=await import('../src/improvement/change.mjs');
 const {dir}=projectPaths(cwd);
 const file=join(dir,'automation-policy.json');
 await mkdir(dir,{recursive:true});
 for(const path of [SCOPE_CONTRACT_PATH,'tools/development-harness/src/scope.mjs']){
   await writeFile(file,JSON.stringify({schemaVersion:1,mode:'draft',allowedPaths:[path],checks:['project'],allowAutoMain:false}));
   await assert.rejects(()=>readPolicy(cwd,file),/Invalid exact allowed paths/);
 }
});
