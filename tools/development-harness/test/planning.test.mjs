import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {ingest,getReport} from '../src/core.mjs';import {classifyFollowup} from '../src/plan.mjs';
async function fixture(t){const cwd=await mkdtemp(join(tmpdir(),'devh-plan-'));t.after(()=>rm(cwd,{recursive:true,force:true}));execFileSync('git',['init','-q'],{cwd});await writeFile(join(cwd,'.devh.json'),JSON.stringify({checks:[]}));return cwd}
test('Explicit continuation naming a different product is not automatically merged',()=>{
 assert.deepEqual(classifyFollowup('추가로 Sidebar 기능 구현','Fix Handoff bug'),{intent:'new',basis:'different-named-target'});
 assert.equal(classifyFollowup('추가로 Handoff 회귀 테스트','Fix Handoff bug').intent,'continue');
});
test('Planning revision can only append steps and never change original forecast or completed obligations',async t=>{
 const cwd=await fixture(t),sessionId='s',turnId='t';
 const plan=[{id:'reproduce',goal:'reproduce',ac:['Repro documented'],dependencies:[]}];
 const start=await ingest({cwd,agent:'codex',sessionId,turnId,event:'prompt',prompt:'Fix bug',plan});
 const previousForecast=structuredClone(start.forecast);
 await assert.rejects(()=>ingest({cwd,agent:'codex',sessionId,turnId,event:'scope-change',plan:[{...plan[0],goal:'rewritten'},{id:'fix',goal:'repair',ac:['Test'],dependencies:['reproduce']}]}),/immutable/);
 const result=await ingest({cwd,agent:'codex',sessionId,turnId,event:'scope-change',plan:[...plan,{id:'fix',goal:'repair',ac:['Test'],dependencies:['reproduce']} ]});
 assert.equal(result.addedSteps,1);
 assert.deepEqual(result.forecast,previousForecast);
 const state=(await getReport(cwd)).tasks[0];
 assert.equal(state.scopeChanges.length,1);assert.equal(state.steps.length,2);
 assert.equal(state.steps[0].goal,'reproduce');
});

test('Greeting does not generate a spurious development task',async t=>{
 const cwd=await fixture(t);
 const r=await ingest({cwd,agent:'codex',sessionId:'social',turnId:'greeting',event:'prompt',prompt:'감사합니다'});
 assert.equal(r.ignored,true);assert.equal((await getReport(cwd)).tasks.length,0);
});
