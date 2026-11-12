#!/usr/bin/env node
import {ingest} from '../src/core.mjs';
import {readProjectConfig,projectPaths} from '../src/store.mjs';
import {choosePlan} from '../src/planner.mjs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const readAll=async()=>{let value='';for await(const chunk of process.stdin)value+=chunk;if(value.length>1_000_000)throw Error('Hook payload too large');return JSON.parse(value)};
try {
 const input=await readAll();
 const type=input.hook_event_name,sessionId=input.session_id,turnId=input.turn_id??`session-${sessionId}`;
 if(!sessionId||!type)process.exit(0);
 if(process.env.DEVH_IMPROVEMENT_WORKER==='1')process.exit(0); // never recursively instrument improvement work
 const cwd=input.cwd??process.cwd();
 const base={cwd,agent:'codex',sessionId,turnId,requestAgentId:input.agent_id??null,requestStatus:input.status??null};
 let result;
 if(type==='UserPromptSubmit'){
   const config=await readProjectConfig(projectPaths(cwd).root);
   const planned=await choosePlan(input.prompt,cwd,config.planning??{});
   result=await ingest({...base,event:'prompt',prompt:input.prompt,eventId:`start:${turnId}`,
     plan:planned.steps,planProvenance:planned.provenance});
 }
 else if(type==='PreModelRequest')result=await ingest({...base,event:'request-start'});
 else if(type==='PostModelRequest'){
   result=await ingest({...base,event:'request-end',usage:input.token_usage});
 }else if(type==='Stop'||type==='Interrupt'||type==='SessionEnd'){
   result=await ingest({...base,event:type==='Stop'?'settled':type==='Interrupt'?'interrupt':'end',eventId:`${type}:${turnId}`});
   if(type==='Stop'&&result?.status==='awaiting-verification'){
     const child=spawn(process.execPath,[fileURLToPath(new URL('../bin/devh.mjs',import.meta.url)),'process'],
       {cwd,env:{...process.env,DEVH_CWD:cwd},detached:true,stdio:'ignore'});
     child.unref();
   }
 }
 if(type==='UserPromptSubmit' && result?.taskId){
   // No user commands. Never block a developer prompt for telemetry failure.
   process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',
     additionalContext:`Maintenance record ${result.taskId} was started automatically. Follow the repository's normal verification contract; do not invent test evidence. No user interaction required.`}})+'\n');
 } else if(type==='Stop')process.stdout.write('{}\n');
} catch(e){
  // Fail open; technical hook problems are visible on stderr and should be fixed before production use.
  console.error('[devh hook] '+String(e));
  if(process.env.DEVH_STRICT==='1')process.exitCode=1;
}
