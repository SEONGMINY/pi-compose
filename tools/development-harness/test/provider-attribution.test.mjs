import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {ingest,getReport} from '../src/core.mjs';
async function fixture(t){const cwd=await mkdtemp(join(tmpdir(),'devh-provider-'));t.after(()=>rm(cwd,{recursive:true,force:true}));execFileSync('git',['init','-q'],{cwd});await writeFile(join(cwd,'.devh.json'),JSON.stringify({checks:[]}));return cwd}
test('Subagent model requests in same parent turn do not cross-attribute',async t=>{
 const cwd=await fixture(t),base={cwd,agent:'codex',sessionId:'ses',turnId:'turn'};
 await ingest({...base,event:'prompt',prompt:'Fix bug'});
 await ingest({...base,event:'request-start',requestAgentId:'child-A'});
 await ingest({...base,event:'request-start',requestAgentId:'child-B'});
 await ingest({...base,event:'request-end',requestAgentId:'child-B',usage:{total_tokens:20},requestStatus:'failed'});
 await ingest({...base,event:'request-end',requestAgentId:'child-A',usage:{total_tokens:10},requestStatus:'completed'});
 await ingest({...base,event:'request-end',requestAgentId:'unknown',usage:{total_tokens:999}});
 const t1=(await getReport(cwd)).tasks[0],run=t1.runs[0];
 assert.equal(t1.tokenUsage.observed,30);assert.equal(t1.tokenUsage.missingEvents,1);
 assert.deepEqual(run.modelRequests.map(x=>[x.agentId,x.tokens,x.outcome]),[['child-A',10,'completed'],['child-B',20,'failed']]);
});
test('Real-shaped Codex model request events attribute subagent to parent Task safely',async t=>{
 const cwd=await fixture(t);const script=new URL('../adapters/codex-hook.mjs',import.meta.url).pathname;
 for(const event of [
  {hook_event_name:'UserPromptSubmit',session_id:'p',turn_id:'turn',cwd,prompt:'Fix issue'},
  {hook_event_name:'PreModelRequest',session_id:'p',turn_id:'turn',agent_id:'sub-1',cwd},
  {hook_event_name:'PostModelRequest',session_id:'p',turn_id:'turn',agent_id:'sub-1',status:'completed',token_usage:{total_tokens:123},cwd}
 ]) { const r=spawnSync(process.execPath,[script],{input:JSON.stringify(event),encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
 const task=(await getReport(cwd)).tasks[0];assert.equal(task.tokenUsage.observed,123);
 assert.equal(task.runs[0].modelRequests[0].agentId,'sub-1');
});
