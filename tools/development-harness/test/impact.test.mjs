import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {projectPaths,withState} from '../src/store.mjs';
import {sourceRevision,assessAttempt,evaluateImpact,refreshImpact,recentImpactEvidence} from '../src/improvement/impact.mjs';
import {ingest,getReport} from '../src/core.mjs';
import {runTrustedChecks,readPolicy} from '../src/improvement/change.mjs';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const times={beforeStart:'2026-11-10T08:00:00.000Z',beforeEnd:'2026-11-10T09:00:00.000Z',
  improveStart:'2026-11-11T09:00:00.000Z',improveEnd:'2026-11-11T09:05:00.000Z',
  afterStart:'2026-11-12T08:00:00.000Z',afterEnd:'2026-11-12T09:00:00.000Z'};
async function repo(t){
  const cwd=await mkdtemp(join(tmpdir(),'devh-impact-'));
  t.after(()=>rm(cwd,{recursive:true,force:true}));
  git(cwd,'init','-q','-b','main');
  await writeFile(join(cwd,'main.txt'),'v1\n');
  git(cwd,'add','main.txt');
  const author=['-c','user.name=devh','-c','user.email=devh@example.test'];
  git(cwd,...author,'commit','-q','-m','baseline');
  const before=git(cwd,'rev-parse','HEAD');
  await writeFile(join(cwd,'main.txt'),'v2\n');
  git(cwd,'add','main.txt');
  git(cwd,...author,'commit','-q','-m','verified improvement');
  return {cwd,before,after:git(cwd,'rev-parse','HEAD')};
}
function task(id,head,minutes,tokens,{after=false,clean=true,kind='bug',agent='pi',status='completed',missingTokens=false}={}){
  return {id,kind,agent,status,source:{head,clean},steps:[{id:'delivery'}],
    startedAt:after?times.afterStart:times.beforeStart,finishedAt:after?times.afterEnd:times.beforeEnd,
    actual:{activeMinutes:minutes,tokens:missingTokens?null:tokens,
      coverage:missingTokens?'unknown':'observed-hooks-only'},tokenUsage:{missingEvents:missingTokens?1:0},runs:[]};
}
function records(before,after){
  const tasks=[task('pre1',before,10,1000),task('pre2',before,11,1100),task('pre3',before,12,1200),
    task('post1',after,5,600,{after:true}),task('post2',after,6,700,{after:true}),task('post3',after,7,800,{after:true})];
  const attempt={id:'11111111-1111-4111-8111-111111111111',reviewId:'22222222-2222-4222-8222-222222222222',
    relatedTaskIds:['pre1'],state:'integrated-local',commit:after,
    startedAt:times.improveStart,finishedAt:times.improveEnd,totalWallMs:120000};
  const review={id:attempt.reviewId,reviewWallMs:30000,modelTokens:null};
  return {tasks,attempt,review};
}

test('Capture a clean Git revision before development; dirty/unknown cannot prove exposure',async t=>{
  const {cwd,after}=await repo(t);
  assert.deepEqual(sourceRevision(cwd),{head:after,clean:true,provenance:'git-start-snapshot'});
  await writeFile(join(cwd,'main.txt'),'dirty');
  assert.equal(sourceRevision(cwd).clean,false);
  assert.equal(sourceRevision(join(cwd,'missing')).head,null);
});

test('Compare only tasks actually based on the integrated improvement commit',async t=>{
  const {cwd,before,after}=await repo(t);
  const {tasks,attempt,review}=records(before,after);
  const result=assessAttempt(attempt,tasks,[review],[attempt],{repo:cwd});
  assert.equal(result.status,'directional-observation');
  assert.equal(result.causalClaim,false);
  assert.equal(result.netSavings,null);
  assert.equal(result.netTokenSavings,null);
  assert.deepEqual(result.beforeTaskIds,['pre1','pre2','pre3']);
  assert.deepEqual(result.afterTaskIds,['post1','post2','post3']);
  assert.equal(result.time.beforeMedian,11);
  assert.equal(result.time.afterMedian,6);
  assert.equal(result.tokens.medianDifference,400);
  assert.equal(result.cost.timeCostLowerBoundMinutes,2.5);
  assert.equal(result.directionalTimeBalanceMinutes,12.5);
  assert.equal(result.signal,'observed-faster');
});

test('Do not confuse a verified draft, unrelated code or a dirty revision with applied improvement',async t=>{
  const {cwd,before,after}=await repo(t);
  const {tasks,attempt,review}=records(before,after);
  assert.equal(assessAttempt({...attempt,state:'verified-draft'},tasks,[review],[attempt],{repo:cwd}).status,'not-applied');
  const dirty=tasks.map(x=>x.id.startsWith('post')?{...x,source:{head:after,clean:false}}:x);
  assert.equal(assessAttempt(attempt,dirty,[review],[attempt],{repo:cwd}).afterTaskIds.length,0);
  const withoutAncestor=tasks.map(x=>x.id.startsWith('post')?{...x,source:{head:before,clean:true}}:x);
  assert.equal(assessAttempt(attempt,withoutAncestor,[review],[attempt],{repo:cwd}).afterTaskIds.length,0);
  const tooEarly=tasks.map(x=>x.id==='post1'?{...x,startedAt:times.improveStart}:x);
  assert.equal(assessAttempt(attempt,tooEarly,[review],[attempt],{repo:cwd}).afterTaskIds.length,2);
});

test('Unverified work and missing provider tokens never produce a positive two-resource ROI claim',async t=>{
  const {cwd,before,after}=await repo(t);
  const {tasks,attempt,review}=records(before,after);
  const unverified=tasks.map(x=>x.id.startsWith('post')?{...x,status:'delivered-unverified'}:x);
  assert.equal(assessAttempt(attempt,unverified,[review],[attempt],{repo:cwd}).afterTaskIds.length,0);
  const missing=tasks.map(x=>x.id.startsWith('post')?{...x,actual:{...x.actual,tokens:null,coverage:'unknown'}}:x);
  const outcome=assessAttempt(attempt,missing,[review],[attempt],{repo:cwd});
  assert.equal(outcome.status,'incomplete-token-coverage');
  assert.equal(outcome.tokens.afterMedian,null);
  assert.equal(outcome.netTokenSavings,null);
  assert.equal(outcome.netSavings,null);
});

test('Every failed attempt is included in the measured time cost, while unknown model tokens stay null',async t=>{
  const {cwd,before,after}=await repo(t);
  const {tasks,attempt,review}=records(before,after);
  const failed={...attempt,id:'33333333-3333-4333-8333-333333333333',state:'blocked',totalWallMs:60000};
  const outcome=assessAttempt(attempt,tasks,[review],[attempt,failed],{repo:cwd});
  assert.equal(outcome.cost.timeCostLowerBoundMinutes,3.5);
  assert.equal(outcome.cost.attemptCount,2);
  assert.equal(outcome.cost.modelTokens,null);
  assert.equal(outcome.directionalTimeBalanceMinutes,11.5);
});

test('Persist evaluation snapshots idempotently and make them available as bounded directional context',async t=>{
  const {cwd,before,after}=await repo(t);
  const {tasks,attempt,review}=records(before,after);
  const {dir}=projectPaths(cwd);
  await withState(dir,s=>{for(const row of tasks)s.tasks[row.id]=row;});
  await mkdir(join(dir,'reviews'),{recursive:true});
  await mkdir(join(dir,'attempts'),{recursive:true});
  await writeFile(join(dir,'reviews',`${review.id}.json`),JSON.stringify(review));
  await writeFile(join(dir,'attempts',`${attempt.id}.json`),JSON.stringify(attempt));
  const first=await refreshImpact(cwd),second=await refreshImpact(cwd);
  assert.deepEqual(second,first);
  assert.equal((await evaluateImpact(cwd))[0].status,'directional-observation');
  assert.equal((await recentImpactEvidence(dir)).length,1);
  const file=JSON.parse(await readFile(join(dir,'impact',`${attempt.id}.json`),'utf8'));
  assert.equal(file.afterTaskIds.length,3);
  assert.equal(file.causalClaim,false);
});


test('An improvement originating in a failed task can still be assessed against accepted delivery cohorts',async t=>{
  const {cwd,before,after}=await repo(t);
  const {tasks,attempt,review}=records(before,after);
  tasks.push(task('failed-source',before,50,null,{status:'verification-failed',missingTokens:true}));
  const result=assessAttempt({...attempt,relatedTaskIds:['failed-source']},tasks,[review],[attempt],{repo:cwd});
  assert.equal(result.status,'directional-observation');
  assert.equal(result.beforeTaskIds.length,3);
  assert.ok(!result.beforeTaskIds.includes('failed-source'));
});

test('Another integrated change ends the observation window to avoid misattributing its outcomes',async t=>{
  const {cwd,before,after}=await repo(t);
  const {tasks,attempt,review}=records(before,after);
  const second={...attempt,id:'44444444-4444-4444-8444-444444444444',finishedAt:'2026-11-13T00:00:00.000Z'};
  tasks.push(task('post-too-late',after,2,300,{after:true}));
  tasks.at(-1).startedAt='2026-11-14T08:00:00.000Z';
  const result=assessAttempt(attempt,tasks,[review],[attempt,second],{repo:cwd});
  assert.equal(result.afterTaskIds.length,3);
  assert.equal(result.observationWindowEndsAt,second.finishedAt);
});

test('Normal Task ingestion records the immutable initial repository revision',async t=>{
  const {cwd,after}=await repo(t);
  await writeFile(join(cwd,'.devh.json'),'{"checks":[]}');
  git(cwd,'add','.devh.json');
  git(cwd,'-c','user.name=devh','-c','user.email=devh@example.test','commit','-q','-m','commit local config');
  const expected=git(cwd,'rev-parse','HEAD');
  const started=await ingest({cwd,agent:'codex',sessionId:'verified-rev',turnId:'1',event:'prompt',
    prompt:'Implement a bounded feature'});
  assert.equal((await getReport(cwd)).tasks.find(x=>x.id===started.taskId).source.head,expected);
  assert.equal((await getReport(cwd)).tasks[0].source.clean,true);
  await writeFile(join(cwd,'main.txt'),'changed after task start');
  const original=(await getReport(cwd)).tasks[0].source;
  assert.equal(original.head,expected);
  assert.equal(original.clean,true);
  assert.notEqual(expected,after);
});

test('Harness check records a duration without referencing an uninitialized timer',async t=>{
  const {cwd}=await repo(t);
  await mkdir(join(cwd,'tools','development-harness'),{recursive:true});
  const results=await runTrustedChecks(cwd,['harness'],async(bin,args,opts)=>({code:0,timedOut:false,stdout:'ok',stderr:''}));
  assert.equal(results.length,1);
  assert.ok(results[0].durationMs>=0);
  assert.equal(results[0].name,'harness');
});


test('Automatic improvement cannot edit its own measurement or orchestration code',async t=>{
  const {cwd}=await repo(t);
  const {dir}=projectPaths(cwd);
  await mkdir(dir,{recursive:true});
  const policy=join(dir,'automation-policy.json');
  await writeFile(policy,JSON.stringify({schemaVersion:1,mode:'draft',
    allowedPaths:['tools/development-harness/src/improvement/impact.mjs'],checks:['project'],allowAutoMain:false}));
  await assert.rejects(()=>readPolicy(cwd,policy),/Invalid exact allowed paths/);
});
