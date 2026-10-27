import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { delegationPrompt, loadSourceSession } from './launch.ts';

type SessionMessage = {
  type?:unknown;
  message?:{role?:unknown;content?:unknown};
};
function textOf(content:unknown):string|null {
  if(typeof content==='string')return content;
  if(!Array.isArray(content))return null;
  return content.filter((v):v is {type:string;text:string} =>
    !!v && typeof v==='object' && v.type==='text' && typeof v.text==='string')
    .map(v=>v.text).join('\n');
}
export type DeliveryEvidence = {
  sessionId:string;
  parentSession:string|null;
  promptObserved:boolean;
  assistantObserved:boolean;
  status:'observed'|'not-observed'|'unavailable';
};

/** Official Pi JSONL is evidence. No model inference and no transcript export.
 * An unchanged session may not yet contain the new task, so absence is unknown,
 * NOT launch failure. Observe the exact full post-Fork instruction.
 */
export async function inspectChildSession(
  sessionFile:string, expectedPrompt:string,
):Promise<DeliveryEvidence> {
  const header=await loadSourceSession(sessionFile);
  const size=await stat(header.path);
  if(size.size>100*1024*1024) return {
    sessionId:header.id,parentSession:header.parentSession||null,
    promptObserved:false,assistantObserved:false,status:'unavailable',
  };
  let promptObserved=false;
  let assistantObserved=false;
  const reader=createInterface({input:createReadStream(header.path,{encoding:'utf8'}),crlfDelay:Infinity});
  try {
    for await(const line of reader){
      let entry:SessionMessage;
      try {entry=JSON.parse(line) as SessionMessage;}catch{continue;}
      if(entry.type!=='message'||!entry.message)continue;
      if(entry.message.role==='user'&&textOf(entry.message.content)===expectedPrompt){
        promptObserved=true;
        assistantObserved=false;
      }else if(promptObserved&&entry.message.role==='assistant'){
        assistantObserved=true;
      }
    }
  } finally {reader.close();}
  return {sessionId:header.id,parentSession:header.parentSession||null,promptObserved,
    assistantObserved,status:promptObserved?'observed':'not-observed'};
}

/** Shared exact prompt construction, no summarizing or weakening constraints. */
export function expectedDelivery(task:string,context:'fork'|'independent'):string {
  return delegationPrompt(task,context);
}
