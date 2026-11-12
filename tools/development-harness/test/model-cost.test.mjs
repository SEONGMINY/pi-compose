import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {piJsonCollector,runPiJson,recordModelCall,measuredModelOutput,listModelCalls} from '../src/improvement/model-run.mjs';

async function sandbox(t){
 const dir=await mkdtemp(join(tmpdir(),'devh-model-cost-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));return dir;
}
async function fakePi(t,events,{exit=0}={}){
 const dir=await sandbox(t),file=join(dir,'fake-pi');
 const program=`#!/usr/bin/env node\nconst events=${JSON.stringify(events)};\n`+
  `if(!process.argv.includes('--mode')||!process.argv.includes('json')||process.env.DEVH_IMPROVEMENT_WORKER!=='1')process.exit(43);\n`+
  `for(const e of events)process.stdout.write(typeof e==='string'?e+'\\n':JSON.stringify(e)+'\\n');\nprocess.exit(${exit});\n`;
 await writeFile(file,program);await chmod(file,0o755);
 return {file,dir};
}
const answer=(text,tokens,stopReason='stop')=>({type:'message_end',message:{role:'assistant',
 content:[{type:'text',text}],stopReason,usage:tokens===null?null:{totalTokens:tokens}}});
const complete={type:'agent_settled',aborted:false};

test('Pi collector counts final message and compaction once, never streaming deltas or tool result',()=>{
 const c=piJsonCollector();
 c.accept({type:'message_update',usage:{totalTokens:999}});
 c.accept({type:'message_end',message:{role:'toolResult',usage:{totalTokens:222}}});
 c.accept(answer('{"ok":true}',120));
 c.accept({type:'compaction_end',result:{usage:{totalTokens:30}}});
 c.accept(complete);
 const r=c.result();assert.equal(r.answer,'{"ok":true}');
 assert.equal(r.usage.totalTokens,150);assert.equal(r.usage.missingUsage,0);
 assert.equal(r.usage.coverage,'assistant-and-compaction-events');
});

test('Pi JSON subprocess extracts terminal response and provider usage, not JSONL text',async t=>{
 const {file,dir}=await fakePi(t,[{type:'session',id:'test'},
  {type:'message_update',usage:{totalTokens:9000},assistantMessageEvent:{type:'text_delta',delta:'ignored'}},
  answer('{"edits":[]}',61),complete]);
 const r=await runPiJson('Inspect harmless test',dir,{executable:file,timeoutMs:3000});
 assert.equal(r.__devhModelRun,1);assert.equal(r.output,'{"edits":[]}');
 assert.equal(r.usage.totalTokens,61);
});

test('Pi JSON missing model usage is unknown, never fabricated as zero',async t=>{
 const {file,dir}=await fakePi(t,[answer('hello',null),complete]);
 const r=await runPiJson('Test',dir,{executable:file,timeoutMs:3000});
 assert.equal(r.usage.totalTokens,null);assert.equal(r.usage.coverage,'unknown');
});

test('Pi JSON partial messages preserve observed lower bound instead of claiming completeness',async t=>{
 const {file,dir}=await fakePi(t,[answer('first',34),answer('second',null),complete]);
 const r=await runPiJson('Test',dir,{executable:file,timeoutMs:3000});
 assert.equal(r.usage.totalTokens,34);assert.equal(r.usage.coverage,'partial');
});

test('Pi JSON fail/aborted/malformed stream never reported as success',async t=>{
 for(const events of [[answer('{"ok":true}',12)],
   [answer('partial',10,'length'),complete],[answer('x',10),{...complete,aborted:true}],
   ['{not json}',complete]]){
  const {file,dir}=await fakePi(t,events);
  await assert.rejects(()=>runPiJson('Test',dir,{executable:file,timeoutMs:3000}),e=>{
    assert.equal(typeof e.modelRun?.durationMs,'number');
    if(events[0]?.type==='message_end')assert.equal(e.modelRun?.usage?.totalTokens,events[0].message.usage.totalTokens);
    return true;
  });
 }
});

test('Every model call, including failures and mock calls, persists cost provenance without raw prompts',async t=>{
 const dir=await sandbox(t),context={dir,purpose:'review',taskIds:['task-a'],reviewId:'review-1'};
 const result=await recordModelCall(context,async()=>measuredModelOutput('private model output',
    {totalTokens:456,coverage:'assistant-and-compaction-events'}));
 assert.equal(result.receipt.tokens,456);
 await assert.rejects(()=>recordModelCall(context,async()=>{
  const e=new Error('provider unavailable');e.modelRun={usage:{totalTokens:28,coverage:'partial'}};throw e;
 }),/provider unavailable/);
 await recordModelCall({...context,purpose:'propose'},async()=>'{"edits":[]}');
 const records=await listModelCalls(dir);
 assert.equal(records.length,3);
 assert.deepEqual(records.map(x=>x.tokens).sort((a,b)=>Number(a??0)-Number(b??0)),[null,28,456]);
 assert.equal(records.find(x=>x.status==='failed').tokens,28);
 assert.equal(records.find(x=>x.purpose==='propose').tokenCoverage,'unknown');
 for(const file of await readdir(join(dir,'model-calls'))){
  const content=await readFile(join(dir,'model-calls',file),'utf8');
  assert.doesNotMatch(content,/private model output|Test prompt text|api.key/i);
 }
});

test('Recovered Pi retry does not treat an earlier assistant error as final failure',async t=>{
 const {file,dir}=await fakePi(t,[answer('initial retry error',12,'error'),
  {type:'auto_retry_start',attempt:1},answer('Final accepted JSON',19,'stop'),complete]);
 const r=await runPiJson('Test',dir,{executable:file,timeoutMs:3000});
 assert.equal(r.output,'Final accepted JSON');assert.equal(r.usage.totalTokens,31);
});

test('Observed streaming token budget terminates runaway Pi without treating it as free',async t=>{
 const {file,dir}=await fakePi(t,[{type:'message_start',message:{role:'assistant'}},
  {type:'message_update',usage:{totalTokens:95},assistantMessageEvent:{type:'text_delta',delta:'x'}},
  answer('should not be accepted',100),complete]);
 await assert.rejects(()=>runPiJson('Test',dir,{executable:file,timeoutMs:3000,maxObservedTokens:60}),e=>{
  assert.match(e.message,/budget/);
  assert.ok(e.modelRun.usage.totalTokens>=95);
  assert.equal(e.modelRun.usage.coverage,'partial');
  return true;
 });
});
