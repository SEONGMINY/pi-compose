import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ingest,getReport} from '../src/core.mjs';import {processQueue} from '../src/worker.mjs';
import {projectPaths} from '../src/store.mjs';import {processReviews,processImprovementQueue} from '../src/improvement/queue.mjs';
import {listReviews,chooseCostAwareLayer} from '../src/improvement/review.mjs';
import {executeImprovement} from '../src/improvement/change.mjs';
async function fixture(t){
 const cwd=await mkdtemp(join(tmpdir(),'devh-loop-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 execFileSync('git',['init','-q','-b','main'],{cwd});
 await mkdir(join(cwd,'src'),{recursive:true});
 await writeFile(join(cwd,'src','worker.mjs'),'export const problem = true;\n');
 await writeFile(join(cwd,'package.json'),JSON.stringify({type:'module',scripts:{check:'node --check src/worker.mjs'}}));
 await writeFile(join(cwd,'.devh.json'),JSON.stringify({checks:[['npm','run','check']]}));
 execFileSync('git',['add','.'],{cwd});
 execFileSync('git',['-c','user.name=Tests','-c','user.email=devh@example.test','commit','-qm','initial'],{cwd});
 return cwd;
}
async function anomaly(cwd){
 const x=await ingest({cwd,agent:'codex',sessionId:'loop',turnId:'1',event:'prompt',prompt:'Fix bug'});
 await ingest({cwd,agent:'codex',sessionId:'loop',turnId:'1',event:'settled'});
 // Fake a failed acceptance project check in a worker override; no real code is changed.
 await processQueue(cwd,{run:async()=>({state:'failed',reason:'Known test failure',results:[]})});
 assert.equal((await getReport(cwd)).tasks[0].status,'verification-failed');
 return x.taskId;
}
function modelReview(taskId){return {
 taskIds:[taskId],findings:[{hypothesis:'repeated manual check is expensive',confidence:'medium',
   evidence:[{source:'task',taskId,field:'kind',value:'feature'},
     {source:'repo-file',path:'src/worker.mjs',line:1,quote:'export const problem = true;'}],
   alternativeExplanations:['Task scope may have changed']}],
 layers:{architecture:{feasible:'yes',reason:'Can reuse shared check'},gate:{feasible:'no',reason:'Not applicable'},
   ai_instructions:{feasible:'no',reason:'Architecture first'},user_behavior:{feasible:'no',reason:'No manual work'}},
 economics:{architecture:{implementationMinutes:5,implementationTokens:1000,savingMinutesPerTask:8,savingTokensPerTask:2000,expectedOccurrences:5,confidence:'medium'}},
 proposal:{title:'Reuse deterministic check',expectedSignal:'Less duplicate implementation work',verification:['npm run check']},limitations:[]
 }}
test('Real queued anomaly is reviewed, task and file evidence checked, and receipt saved exactly once',async t=>{
 const cwd=await fixture(t);const taskId=await anomaly(cwd);
 const q=await processReviews(cwd,{runModel:async()=>JSON.stringify(modelReview(taskId))});
 assert.equal(q.reviewed.length,1);
 const reviews=await listReviews(projectPaths(cwd).dir);assert.equal(reviews.length,1);
 assert.equal(reviews[0].candidate.layer,'architecture');assert.equal(reviews[0].candidate.executionState,'proposed-not-approved');
 assert.equal((await getReport(cwd)).queue.find(x=>x.type==='review').state,'done');
 assert.equal((await processReviews(cwd,{runModel:async()=>{throw Error('Should not rerun')}})).reviewed.length,0);
});
test('Model error preserves review queue and adds a bounded retry time',async t=>{
 const cwd=await fixture(t);await anomaly(cwd);
 await assert.rejects(()=>processReviews(cwd,{runModel:async()=>{throw Error('offline')}}),/offline/);
 const q=(await getReport(cwd)).queue.find(x=>x.type==='review');
 assert.equal(q.state,'pending');assert.ok(q.nextAttemptAt);assert.equal(q.failures,1);
});
test('Economic selection blocks unknown architecture and time/token tradeoffs',()=>{
 const layers={architecture:{feasible:'unknown'},gate:{feasible:'yes'},ai_instructions:{feasible:'no'},user_behavior:{feasible:'no'}};
 assert.equal(chooseCostAwareLayer(layers,{}).blocked,true);
 layers.architecture.feasible='yes';
 const economics={architecture:{implementationMinutes:999,implementationTokens:100,savingMinutesPerTask:1,savingTokensPerTask:100,expectedOccurrences:1,confidence:'high'}};
 assert.equal(chooseCostAwareLayer(layers,economics).blocked,true);
});
test('Code improvement requires explicit policy and independent pass; draft preserves main',async t=>{
 const cwd=await fixture(t);const taskId=await anomaly(cwd);
 const q=await processReviews(cwd,{runModel:async()=>JSON.stringify(modelReview(taskId))});
 const {dir}=projectPaths(cwd),reviewId=q.reviewed[0].reviewId;
 const policyFile=join(dir,'automation-policy.json');
 await writeFile(policyFile,JSON.stringify({schemaVersion:1,mode:'draft',allowedPaths:['src/worker.mjs'],checks:['project'],allowAutoMain:false}));
 const blocked=await executeImprovement({repo:cwd,dir,reviewId,policyFile,
   propose:async()=>({edits:[{path:'src/worker.mjs',old:'true',replacement:'false'}],rationale:'remove repeated failure'}),
   verify:async()=>({verdict:'block',summary:'Cannot establish behavior',risks:['unknown'],limitations:[]})});
 assert.equal(blocked.state,'blocked');
 const allowed=await executeImprovement({repo:cwd,dir,reviewId,policyFile,
   propose:async()=>({edits:[{path:'src/worker.mjs',old:'true',replacement:'false'}],rationale:'remove repeated failure'}),
   verify:async()=>({verdict:'pass',summary:'Actual diff and tests checked',risks:[],limitations:[]})});
 assert.equal(allowed.state,'verified-draft');
 assert.equal(await readFile(join(cwd,'src','worker.mjs'),'utf8'),'export const problem = true;\n');
 const branches=execFileSync('git',['branch','--list','maintenance/attempt-*'],{cwd,encoding:'utf8'});
 assert.match(branches,/maintenance\/attempt-/);
});

test('Automatic review queues an isolated improvement; accepted draft is recovered without duplicate edits',async t=>{
 const cwd=await fixture(t),taskId=await anomaly(cwd);
 const q=await processReviews(cwd,{runModel:async()=>JSON.stringify(modelReview(taskId))});
 const {dir}=projectPaths(cwd);
 const queued=(await getReport(cwd)).queue.find(x=>x.type==='improve');
 assert.equal(queued.state,'pending');assert.equal(queued.reviewId,q.reviewed[0].reviewId);
 const policyFile=join(dir,'automation-policy.json');
 await writeFile(policyFile,JSON.stringify({schemaVersion:1,mode:'draft',allowedPaths:['src/worker.mjs'],checks:['project'],allowAutoMain:false}));
 const result=await processImprovementQueue(cwd,{
   propose:async()=>({edits:[{path:'src/worker.mjs',old:'true',replacement:'false'}],rationale:'reduce redundant work'}),
   verify:async()=>({verdict:'pass',summary:'Check diff and tested change',risks:[],limitations:[]})
 });
 assert.equal(result.state,'verified-draft');
 assert.equal((await getReport(cwd)).queue.find(x=>x.type==='improve').state,'done');
 assert.equal((await processImprovementQueue(cwd)).state,'idle');
 assert.equal(await readFile(join(cwd,'src','worker.mjs'),'utf8'),'export const problem = true;\n');
});
test('A missing approved policy defers automatic code edits without losing the candidate',async t=>{
 const cwd=await fixture(t),taskId=await anomaly(cwd);
 await processReviews(cwd,{runModel:async()=>JSON.stringify(modelReview(taskId))});
 assert.equal((await processImprovementQueue(cwd)).state,'deferred');
 assert.equal((await getReport(cwd)).queue.find(x=>x.type==='improve').state,'pending');
});

test('Cost layer rejects non-positive expected savings even when costs are below the three-times guard',()=>{
 const layers={architecture:{feasible:'yes'},gate:{feasible:'no'},ai_instructions:{feasible:'no'},user_behavior:{feasible:'no'}};
 const economics={architecture:{implementationMinutes:15,implementationTokens:150,savingMinutesPerTask:10,savingTokensPerTask:100,expectedOccurrences:1,confidence:'high'}};
 const decision=chooseCostAwareLayer(layers,economics);
 assert.equal(decision.blocked,true);assert.match(decision.reason,/net savings/);
});
