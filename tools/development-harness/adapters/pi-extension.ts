/** Auto-discover as .pi/extensions/devh.ts or via Pi's extensions setting.
 * Requires @earendil-works/pi-coding-agent with agent_settled event (supported in Pi v1.4+).
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { ingest } from '../src/core.mjs';
import {readProjectConfig,projectPaths} from '../src/store.mjs';
import {choosePlan} from '../src/planner.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export default function(pi: ExtensionAPI){
  const localSession=randomUUID();let turnSeq=0,currentTurn:string|null=null;let sessionId=localSession;
  pi.on('before_agent_start',async(event,ctx)=>{
    if(process.env.DEVH_IMPROVEMENT_WORKER==='1'||(event as any).messageType==='custom'||!event.prompt)return;
    sessionId=ctx.sessionManager.getSessionFile()??localSession;
    currentTurn=`turn-${++turnSeq}-${randomUUID()}`;
    try{
      const config=await readProjectConfig(projectPaths(ctx.cwd).root);
      const planned=await choosePlan(event.prompt,ctx.cwd,config.planning??{});
      await ingest({cwd:ctx.cwd,agent:'pi',sessionId,turnId:currentTurn,
      event:'prompt',prompt:event.prompt,eventId:`start:${currentTurn}`,sessionFile:ctx.sessionManager.getSessionFile()??undefined,
      plan:planned.steps,planProvenance:planned.provenance});
    }
    catch(e){console.error('[devh pi] '+String(e))}
  });
  pi.on('message_end',async(event,ctx)=>{
    if(!currentTurn || event.message?.role!=='assistant')return;
    const msg=event.message as any;
    const durableMessageId=msg.id??msg.timestamp;
    try{await ingest({cwd:ctx.cwd,agent:'pi',sessionId,turnId:currentTurn,event:'usage',
      usage:msg.usage,eventId:durableMessageId?`message:${durableMessageId}`:undefined})}
    catch(e){console.error('[devh pi usage] '+String(e))}
  });
  pi.on('agent_settled',async(event,ctx)=>{
    if(!currentTurn)return;
    const turnId=currentTurn;currentTurn=null;
    try{
      const r=await ingest({cwd:ctx.cwd,agent:'pi',sessionId,turnId,
        event:event.aborted?'interrupt':'settled',eventId:`settled:${turnId}`});
      if(r?.status==='awaiting-verification'){
        const child=spawn(process.execPath,[fileURLToPath(new URL('../bin/devh.mjs',import.meta.url)),'process'],
          {cwd:ctx.cwd,env:{...process.env,DEVH_CWD:ctx.cwd},detached:true,stdio:'ignore'});
        child.unref();
      }
    }catch(e){console.error('[devh pi settle] '+String(e))}
  });
}
