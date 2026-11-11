import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {ingest,getReport} from '../src/core.mjs';
import {processQueue,recoverQueue,triage} from '../src/worker.mjs';
import {projectPaths,readState,withState} from '../src/store.mjs';
import {initialPlan,validatePlan} from '../src/plan.mjs';
import {chooseForecast} from '../src/forecast.mjs';

async function fixture(t,{checks=[],seed=null}={}){
 const dir=await mkdtemp(join(tmpdir(),'devh-fixture-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 execFileSync('git',['init','-q'],{cwd:dir});
 await writeFile(join(dir,'.devh.json'),JSON.stringify({checks,forecastSeed:seed}));
 return dir;
}
const seed={minutes:{p30:10,p50:20,p80:40},tokens:{p30:100,p50:200,p80:500}};
const start=(cwd,sessionId='s1',turnId='t1',prompt='Fix Handoff')=>ingest({cwd,agent:'codex',sessionId,turnId,event:'prompt',prompt,eventId:`start:${turnId}`});
const done=(cwd,sessionId='s1',turnId='t1')=>ingest({cwd,agent:'codex',sessionId,turnId,event:'settled',eventId:`settled:${turnId}`});

test('Adaptive task decomposition avoids artificial phases; validates dependencies',()=>{
 assert.equal(initialPlan('Fix bug').length,1);
 assert.equal(initialPlan('1. Requirements\n2. Constraints').length,1); // lists are not phases
 assert.deepEqual(initialPlan('Step 1: Reproduce\nStep 2: Fix\nStep 3: Test').map(x=>x.dependencies),[[],['step-1'],['step-2']]);
 assert.throws(()=>validatePlan([{id:'a',goal:'Test',ac:['Test'],dependencies:['b']}]),/earlier/);
});
test('Start is idempotent, forecast is recorded before execution, multiple runs share task',async t=>{
 const cwd=await fixture(t,{seed});
 const a=await start(cwd);
 const b=await start(cwd);
 assert.equal(a.taskId,b.taskId);
 assert.equal(b.duplicate,true);
 assert.equal(a.forecast.provenance,'configured-uncalibrated-prior');
 const second=await start(cwd,'s1','t2','추가로 테스트해줘');
 assert.equal(a.taskId,second.taskId);
 const report=await getReport(cwd);
 assert.equal(report.tasks.length,1);assert.equal(report.tasks[0].runs.length,2);
 assert.equal(report.tasks[0].steps.length,1);
});
test('Hooks do not declare completion without verification; queue is durable',async t=>{
 const cwd=await fixture(t,{checks:[],seed});
 await start(cwd);await done(cwd);
 assert.equal((await getReport(cwd)).tasks[0].status,'awaiting-verification');
 const items=await processQueue(cwd);
 assert.equal(items[0].state,'awaiting-verification');
 assert.equal((await getReport(cwd)).tasks[0].actual,null);
});
test('A passing trusted project check completes task, captures usage and runs cheap triage',async t=>{
 const cwd=await fixture(t,{checks:[['npm','run','check']],seed});
 await writeFile(join(cwd,'package.json'),JSON.stringify({scripts:{check:'node -e "process.exit(0)"'}}));
 const a=await start(cwd);
 await ingest({cwd,agent:'codex',sessionId:'s1',turnId:'t1',event:'usage',usage:{input_tokens:700,output_tokens:200},eventId:'req-1'});
 await ingest({cwd,agent:'codex',sessionId:'s1',turnId:'t1',event:'usage',usage:{input_tokens:700,output_tokens:200},eventId:'req-1'});
 await done(cwd);
 const x=await processQueue(cwd);
 assert.equal(x[0].state,'delivered-unverified');
 const task=(await getReport(cwd)).tasks[0];
 assert.equal(task.acceptance.state,'unverified');
 assert.equal(task.actual.tokens,900);
 assert.deepEqual(task.analysis.signals.filter(x=>x==='tokens-p80'),['tokens-p80']);
 assert.ok((await getReport(cwd)).queue.some(q=>q.type==='review' && q.state==='pending'));
 assert.equal(task.steps[0].status,'checks-passed-ac-unverified');
});
test('Failures do not become successful completions, record analysis for review',async t=>{
 const cwd=await fixture(t,{checks:[['npm','run','check']],seed});
 await writeFile(join(cwd,'package.json'),JSON.stringify({scripts:{check:'node -e "process.exit(1)"'}}));
 await start(cwd);await done(cwd);await processQueue(cwd);
 const r=await getReport(cwd);
 assert.equal(r.tasks[0].status,'verification-failed');
 assert.equal(r.tasks[0].analysis.needsReview,true);
 assert.equal(r.tasks[0].verification.state,'failed');
});
test('Unknown tokens are null, not zero; no fabricated forecast without priors',async t=>{
 const cwd=await fixture(t,{checks:[['npm','run','check']]});
 await writeFile(join(cwd,'package.json'),JSON.stringify({scripts:{check:'node -e "process.exit(0)"'}}));
 const a=await start(cwd);assert.equal(a.forecast.provenance,'unavailable');
 assert.equal(a.forecast.tokens,null);
 await done(cwd);await processQueue(cwd);
 const r=await getReport(cwd);assert.equal(r.tasks[0].actual.tokens,null);
 assert.deepEqual(r.tasks[0].analysis.signals,['usage-incomplete']);
});
test('Different worktrees share one store through git common dir',async t=>{
 const cwd=await fixture(t,{seed});
 // Empty repo needs a commit before a worktree branch can be checked out.
 execFileSync('git',['-c','user.name=devh','-c','user.email=devh@example.test','commit','--allow-empty','-m','initial'],{cwd});
 const alt=join(cwd,'..',`devh-worktree-${Date.now()}-${Math.random().toString(36).slice(2)}`);
 execFileSync('git',['worktree','add','-q','-b','feature',alt],{cwd});
 t.after(()=>{try{execFileSync('git',['worktree','remove','-f',alt],{cwd})}catch{}});
 assert.equal(projectPaths(cwd).dir,projectPaths(alt).dir);
 await start(cwd);
 assert.equal((await getReport(alt)).tasks.length,1);
});
test('Stale verification workers can be recovered',async t=>{
 const cwd=await fixture(t,{seed});await start(cwd);await done(cwd);
 const {dir}=projectPaths(cwd);
 await withState(dir,s=>{const q=Object.values(s.queue)[0];q.state='running';q.startedAt='2000-01-01T00:00:00Z'});
 assert.equal((await recoverQueue(cwd)).length,1);
 assert.equal((await getReport(cwd)).queue[0].state,'pending');
});
test('Interrupted run is not counted as successful work',async t=>{
 const cwd=await fixture(t,{seed});await start(cwd);
 await ingest({cwd,agent:'codex',sessionId:'s1',turnId:'t1',event:'interrupt',eventId:'i1'});
 const r=await getReport(cwd);
 assert.equal(r.tasks[0].status,'interrupted');
 assert.equal(r.queue.length,1);
 assert.equal(r.queue[0].type,'review');
});

test('One-time installer does not overwrite existing project hooks or Pi settings', async t=>{
 const cwd=await fixture(t);
 await mkdir(join(cwd,'.codex'),{recursive:true});
 await writeFile(join(cwd,'.codex','hooks.json'),JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:'echo existing'}]}]}}));
 await mkdir(join(cwd,'.pi'),{recursive:true});
 await writeFile(join(cwd,'.pi','settings.json'),JSON.stringify({extensions:['existing.ts']}));
 const {installProject}=await import('../src/install.mjs');
 const r=await installProject(cwd);
 const original=JSON.parse(await readFile(join(cwd,'.codex','hooks.json'),'utf8'));
 assert.equal(original.hooks.Stop[0].hooks[0].command,'echo existing');
 assert.ok(r.changes.some(s=>s.includes('merge-example')));
 const proposal=JSON.parse(await readFile(join(cwd,'.codex','devh-hooks.merge-example.json'),'utf8'));
 assert.ok(proposal.hooks.Stop.some(g=>g.hooks.some(h=>h.command.includes('codex-hook.mjs'))));
 const piOriginal=JSON.parse(await readFile(join(cwd,'.pi','settings.json'),'utf8'));
 assert.deepEqual(piOriginal.extensions,['existing.ts']);
});

test('One-time installer creates project-local hooks and extension config on empty setup', async t=>{
 const cwd=await fixture(t);
 const {installProject}=await import('../src/install.mjs');
 const r=await installProject(cwd);
 assert.ok(r.changes.includes('.codex/hooks.json'));
 const hooks=JSON.parse(await readFile(join(cwd,'.codex','hooks.json'),'utf8')).hooks;
 assert.ok(hooks.UserPromptSubmit&&hooks.PreModelRequest&&hooks.PostModelRequest&&hooks.Stop);
 const settings=JSON.parse(await readFile(join(cwd,'.pi','settings.json'),'utf8'));
 assert.ok(settings.extensions.some(x=>x.endsWith('adapters/pi-extension.ts')));
});

test('A later verified turn requeues verification after earlier missing checks',async t=>{
 const cwd=await fixture(t,{seed});
 await start(cwd);await done(cwd);await processQueue(cwd);
 await start(cwd,'s1','t2','Additional fix');await done(cwd,'s1','t2');
 const r=await getReport(cwd);
 assert.equal(r.queue.filter(x=>x.type==='verify'&&x.state==='pending').length,1);
});


test('Stale crashed state lock is recovered but active locks are not stolen',async t=>{
 const cwd=await fixture(t,{seed});const {dir}=projectPaths(cwd);
 await mkdir(dir,{recursive:true});
 const lock=join(dir,'.state.lock');
 await writeFile(lock,JSON.stringify({pid:99999999,startedAt:'2000-01-01T00:00:00Z'}));
 const past=new Date('2000-01-01');await utimes(lock,past,past);
 const a=await start(cwd);assert.ok(a.taskId);
});

test('Codex hook consumes a real-shaped JSON event without requiring developer commands',async t=>{
 const cwd=await fixture(t,{seed});
 const hook=resolve('adapters/codex-hook.mjs');
 const input={hook_event_name:'UserPromptSubmit',session_id:'codex-1',turn_id:'turn-1',cwd,prompt:'Fix a bug'};
 const r=spawnSync(process.execPath,[hook],{input:JSON.stringify(input),encoding:'utf8',cwd:resolve('.')});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/additionalContext/);
 const list=await getReport(cwd);assert.equal(list.tasks[0].agent,'codex');
});

test('Codex synthetic end-to-end: hook Stop starts a detached validation worker',async t=>{
 const cwd=await fixture(t,{checks:[['npm','run','check']],seed});
 await writeFile(join(cwd,'package.json'),JSON.stringify({scripts:{check:'node -e "process.exit(0)"'}}));
 const hook=resolve('adapters/codex-hook.mjs');
 for(const input of [
   {hook_event_name:'UserPromptSubmit',session_id:'codex-live',turn_id:'turn-77',cwd,prompt:'Fix the auth bug'},
   {hook_event_name:'PreModelRequest',session_id:'codex-live',turn_id:'turn-77',cwd},
   {hook_event_name:'PostModelRequest',session_id:'codex-live',turn_id:'turn-77',cwd,token_usage:{total_tokens:900}},
   {hook_event_name:'Stop',session_id:'codex-live',turn_id:'turn-77',cwd,last_assistant_message:'Implemented and tested'}
 ]){
   const r=spawnSync(process.execPath,[hook],{cwd:resolve('.'),input:JSON.stringify(input),encoding:'utf8'});
   assert.equal(r.status,0,r.stderr);
 }
 let task;
 for(let i=0;i<80;i++){
  task=(await getReport(cwd)).tasks[0];
  if(task?.status==='delivered-unverified')break;
  await new Promise(ok=>setTimeout(ok,40));
 }
 assert.equal(task?.status,'delivered-unverified');
 assert.equal(task.actual.tokens,900);
 assert.ok(task.analysis.needsReview);
});

test('Forecast calibration compares active time, not waiting time between user turns',async t=>{
 const cwd=await fixture(t,{checks:[['npm','run','check']],seed});
 await writeFile(join(cwd,'package.json'),JSON.stringify({scripts:{check:'node -e "process.exit(0)"'}}));
 await start(cwd);
 const {dir}=projectPaths(cwd);
 await withState(dir,s=>{const task=Object.values(s.tasks)[0];task.startedAtMs-=24*60*60*1000;task.startedAt=new Date(task.startedAtMs).toISOString()});
 await done(cwd);await processQueue(cwd);
 const task=(await getReport(cwd)).tasks[0];
 assert.ok(task.actual.wallMinutes>1400);
 assert.ok(task.actual.activeMinutes<1);
 assert.equal(task.analysis.signals.includes('time-p80'),false);
});

test('An unrelated user request in one session creates a separate Task, not silent scope growth',async t=>{
 const cwd=await fixture(t,{seed});
 const a=await start(cwd,'s1','first','Fix Handoff failures');
 await done(cwd,'s1','first');
 const b=await start(cwd,'s1','second','이제 다른 기능인 Sidebar를 만들어줘');
 assert.notEqual(a.taskId,b.taskId);
 const report=await getReport(cwd);
 assert.equal(report.tasks.length,2);
 assert.equal(report.tasks.find(x=>x.id===b.taskId).relatedTaskId,a.taskId);
 assert.equal(report.tasks.find(x=>x.id===b.taskId).boundaryBasis,'explicit-topic-switch');
});

test('Explicit continuation stays on one goal, original forecast remains unchanged',async t=>{
 const cwd=await fixture(t,{seed});
 const a=await start(cwd,'s1','first','Fix Handoff failures');
 await done(cwd,'s1','first');
 const b=await start(cwd,'s1','second','추가로 회귀 테스트를 만들어줘');
 assert.equal(a.taskId,b.taskId);
 const task=(await getReport(cwd)).tasks[0];
 assert.equal(task.runs.length,2);
 assert.deepEqual(task.forecast,a.forecast);
});

test('A follow-up to a delivered but unaccepted Task reopens it while preserving prior measurements',async t=>{
 const cwd=await fixture(t,{seed,checks:[['npm','run','check']]});
 await writeFile(join(cwd,'package.json'),JSON.stringify({scripts:{check:'node -e "process.exit(0)"'}}));
 const original=await start(cwd,'s1','t1','Fix Handoff');
 await done(cwd);await processQueue(cwd);
 assert.equal((await getReport(cwd)).tasks[0].status,'delivered-unverified');
 const followup=await start(cwd,'s1','t2','여전히 버그가 발생해. 다시 수정해줘');
 assert.equal(original.taskId,followup.taskId);
 const task=(await getReport(cwd)).tasks[0];
 assert.equal(task.reopenCount,1);
 assert.equal(task.deliveries.length,1);
 assert.ok(task.deliveries[0].actual);
 assert.equal(task.actual,null);
 assert.equal(task.status,'running');
});

test('A settled old Run is still routed correctly after a new Task starts',async t=>{
 const cwd=await fixture(t,{seed});
 const old=await start(cwd,'s1','old','Fix Handoff');
 const newer=await start(cwd,'s1','new','새로운 기능 개발');
 assert.notEqual(old.taskId,newer.taskId);
 const event=await done(cwd,'s1','old');
 assert.equal(event.taskId,old.taskId);
 const report=await getReport(cwd);
 assert.equal(report.tasks.find(x=>x.id===newer.taskId).runs[0].status,'running');
 assert.equal(report.tasks.find(x=>x.id===old.taskId).runs[0].status,'settled');
});

test('A provider usage event without stable ID is not counted as measured tokens',async t=>{
 const cwd=await fixture(t,{seed});
 await start(cwd);
 await ingest({cwd,agent:'codex',sessionId:'s1',turnId:'t1',event:'usage',usage:{total_tokens:100}});
 await ingest({cwd,agent:'codex',sessionId:'s1',turnId:'t1',event:'usage',usage:{total_tokens:100}});
 const task=(await getReport(cwd)).tasks[0];
 assert.equal(task.tokenUsage.observed,0);
 assert.equal(task.tokenUsage.missingEvents,2);
});

test('Changed Task during checks cannot be closed by a stale verification result',async t=>{
 const cwd=await fixture(t,{seed});
 const first=await start(cwd,'s1','t1','Fix Handoff');
 await done(cwd);
 let calls=0;
 const result=await processQueue(cwd,{limit:1,run:async()=>{
  calls++;
  await start(cwd,'s1','t2','추가로 회귀 테스트');
  return {state:'passed',results:[],reason:null};
 }});
 assert.equal(calls,1);
 assert.equal(result[0].state,'deferred');
 const task=(await getReport(cwd)).tasks.find(x=>x.id===first.taskId);
 assert.equal(task.status,'running');
 assert.equal(task.verification,null);
 assert.equal((await getReport(cwd)).queue.find(x=>x.type==='verify').state,'pending');
});

test('Numbered requirements do not automatically create phases; explicit phases do',()=>{
 assert.equal(initialPlan('1. Must be reliable\n2. Must avoid Docker').length,1);
 const steps=initialPlan('Phase 1: Investigate\nPhase 2: Implement\nPhase 3: Verify');
 assert.deepEqual(steps.map(x=>x.dependencies),[[],['step-1'],['step-2']]);
});

test('Codex local Pre/Post pairing sums distinct attempts but does not double-count a repeated Post',async t=>{
 const cwd=await fixture(t,{seed});
 await start(cwd);
 const base={cwd,agent:'codex',sessionId:'s1',turnId:'t1'};
 await ingest({...base,event:'request-start'});
 await ingest({...base,event:'request-end',usage:{total_tokens:300}});
 await ingest({...base,event:'request-end',usage:{total_tokens:300}}); // duplicated callback, not a new attempt
 await ingest({...base,event:'request-start'});
 await ingest({...base,event:'request-end',usage:{total_tokens:300}}); // real second attempt
 const task=(await getReport(cwd)).tasks[0];
 assert.equal(task.tokenUsage.observed,600);
 assert.equal(task.tokenUsage.events,2);
 assert.equal(task.tokenUsage.missingEvents,1);
 assert.equal(task.runs[0].modelRequests.length,2);
});

test('Historical estimates can learn from delivered work without claiming semantic AC was accepted',()=>{
 const cases={};
 for(let i=0;i<8;i++)cases[`task-${i}`]={status:'delivered-unverified',agent:'codex',kind:'feature',
   actual:{activeMinutes:i+1,tokens:(i+1)*100,coverage:'observed-hooks-only'},
   tokenUsage:{missingEvents:0}};
 const f=chooseForecast(cases,{agent:'codex',kind:'feature'});
 assert.equal(f.provenance,'historical-delivery-observed');
 assert.equal(f.calibrated,false);
 assert.equal(f.samples.time,8);
 assert.equal(f.samples.tokens,8);
});

test('A matching anomaly cohort is counted but unrelated signal types are not grouped',()=>{
 const task={id:'current',kind:'bug',agent:'pi',forecast:{minutes:{p80:4},tokens:null},
   actual:{activeMinutes:7,tokens:null},verification:{state:'passed'}};
 const previous=[
   {id:'other-agent',kind:'bug',agent:'codex',analysis:{signals:['time-p80']}},
   {id:'other-kind',kind:'feature',agent:'pi',analysis:{signals:['time-p80']}},
   {id:'other-signal',kind:'bug',agent:'pi',analysis:{signals:['verification-failed']}},
   {id:'matched',kind:'bug',agent:'pi',analysis:{signals:['time-p80']}}
 ];
 assert.equal(triage(task,previous).repeatedAnomalyCount,1);
});
