#!/usr/bin/env node
import {ingest} from '../src/core.mjs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const readAll=async()=>{let value='';for await(const chunk of process.stdin)value+=chunk;if(value.length>1_000_000)throw Error('Hook payload too large');return JSON.parse(value)};
try {
 const input=await readAll();
 const type=input.hook_event_name,sessionId=input.session_id,turnId=input.turn_id??`session-${sessionId}`;
 if(!sessionId||!type)process.exit(0);
 const cwd=input.cwd??process.cwd();
 const base={cwd,agent:'codex',sessionId,turnId};
 let result;
 if(type==='UserPromptSubmit')result=await ingest({...base,event:'prompt',prompt:input.prompt,eventId:`start:${turnId}`});
 else if(type==='PostModelRequest'){
   result=await ingest({...base,event:'usage',usage:input.token_usage,
     eventId:input.request_id?`request:${input.request_id}`:undefined});
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
