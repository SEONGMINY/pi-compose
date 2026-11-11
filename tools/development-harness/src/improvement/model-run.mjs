/** Observe the model cost of internal read-only Pi runs, without keeping model
 * prompts, raw events or outputs in the durable cost ledger.
 * Pi --mode json is a one-shot JSONL protocol, NOT a JSON response body.
 */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {mkdir,readFile,readdir,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';

const MAX_EVENT_LINE=2_000_000;
const MAX_STREAM_BYTES=24_000_000;
const MAX_ANSWER=64_000;
const safeInt=n=>Number.isSafeInteger(n)&&n>=0;
const getUsage=u=>u&&safeInt(u.totalTokens)?u.totalTokens:null;

/** Mutating this collector is safe only within one invocation. Never sum
 * message_update.usage: it is cumulative and would double count deltas. */
export function piJsonCollector(){
  let assistantMessages=0, missingUsage=0, observedTokens=0, compactionCalls=0;
  let lastAnswer='',settled=false,aborted=false,terminalError=null,pendingUsage=null;
  function accept(event){
    if(event?.type==='message_start'&&event.message?.role==='assistant')pendingUsage=null;
    if(event?.type==='message_update')pendingUsage=getUsage(event.usage)??pendingUsage;
    if(event?.type==='message_end' && event.message?.role==='assistant'){
      assistantMessages++;
      const total=getUsage(event.message.usage);
      if(total===null){
        missingUsage++;if(pendingUsage!==null)observedTokens+=pendingUsage;
      }else observedTokens+=total;
      pendingUsage=null;
      if(!Number.isSafeInteger(observedTokens))throw Error('Pi model token total overflow');
      const blocks=event.message.content;
      const message=Array.isArray(blocks)?blocks.filter(b=>b?.type==='text'&&typeof b.text==='string').map(b=>b.text).join(''):
        typeof blocks==='string'?blocks:'';
      if(message){if(message.length>MAX_ANSWER)throw Error('Pi final answer too large');lastAnswer=message;}
      // An earlier failed response can recover through Pi auto-retry.
      terminalError=['error','aborted','length','deferred'].includes(event.message.stopReason)?
        event.message.stopReason:null;
    }else if(event?.type==='compaction_end' && event.result){
      // Separate compaction model calls are not part of an assistant message.
      compactionCalls++;
      const total=getUsage(event.result.usage);
      if(total===null)missingUsage++;else observedTokens+=total;
      if(!Number.isSafeInteger(observedTokens))throw Error('Pi model token total overflow');
    }else if(event?.type==='agent_settled'){
      settled=true;aborted=event.aborted===true;
    }
  }
  function observed(){return observedTokens+(pendingUsage??0)}
  function result(){
    const totalCalls=assistantMessages+compactionCalls+(pendingUsage!==null?1:0);
    const totalTokens=totalCalls>0&&missingUsage+(pendingUsage!==null?1:0)===totalCalls&&observed()===0?null:
      totalCalls?observed():null;
    return {answer:lastAnswer,settled,aborted,terminalError,
      usage:{totalTokens,coverage:!totalCalls||totalTokens===null?'unknown':
        missingUsage||pendingUsage!==null?'partial':'assistant-and-compaction-events',
        assistantMessages,compactionCalls,missingUsage}};
  }
  return {accept,result,observed};
}

/** Model results from Pi JSON mode are tagged to prevent confusion with the
 * JSON object returned by a mocked model itself. */
export function measuredModelOutput(output,usage){
  return {__devhModelRun:1,output,usage};
}
export function unwrapModelOutput(value){
  if(value?.__devhModelRun===1){
    const raw=value.usage??{};
    const tokens=getUsage(raw);
    return {output:value.output,usage:{totalTokens:tokens,
      coverage:tokens===null?'unknown':(['partial','assistant-and-compaction-events','provider-observed'].includes(raw.coverage)?raw.coverage:'unknown')}};
  }
  return {output:value,usage:{totalTokens:null,coverage:'unknown'}};
}

/** One-shot Pi subprocess. A missing or malformed event stream MUST NOT look
 * like a successful zero-token run. Errors retain partial usage on .modelRun.
 */
export async function runPiJson(prompt,cwd,{executable='pi',timeoutMs=120_000,tools='read,grep,find,ls',maxObservedTokens=60_000}={}){
  const started=performance.now();
  const collector=piJsonCollector();
  return new Promise((resolve,reject)=>{
    const args=['--mode','json','--no-session','--no-extensions','--no-mcp','--tools',tools,'--',prompt];
    let child,settled=false,pending='',streamBytes=0,protocolError=null,timedOut=false;
    if(!safeInt(maxObservedTokens)||maxObservedTokens===0)throw Error('Invalid observed token budget');
    const decoder=new StringDecoder('utf8');
    const finish=(err,code)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      const data=collector.result();
      const meta={usage:data.usage,durationMs:performance.now()-started};
      const reason=err??protocolError??(timedOut?'Pi model run timed out':null)??
        (code!==0?`Pi model exited with code ${code}`:null)??
        (!data.settled?'Pi JSON stream did not settle':null)??
        (data.aborted?'Pi model run aborted':null)??
        (data.terminalError?`Pi model stop reason: ${data.terminalError}`:null)??
        (!data.answer?'Pi model returned no final text':null);
      if(reason){
        if(meta.usage.totalTokens!==null)meta.usage={...meta.usage,coverage:'partial'};
        const error=new Error(String(reason));error.modelRun=meta;reject(error)
      }
      else resolve(measuredModelOutput(data.answer,data.usage));
    };
    const timer=setTimeout(()=>{timedOut=true;child?.kill('SIGKILL')},timeoutMs);
    try{
      child=spawn(executable,args,{cwd,stdio:['ignore','pipe','pipe'],shell:false,
        env:{...process.env,DEVH_IMPROVEMENT_WORKER:'1'}});
      const parseLine=line=>{
        if(!line.trim())return;
        if(Buffer.byteLength(line,'utf8')>MAX_EVENT_LINE)throw Error('Oversized Pi JSON event');
        collector.accept(JSON.parse(line));
        if(collector.observed()>maxObservedTokens)throw Error('Pi model exceeded observed token budget');
      };
      child.stdout.on('data',buffer=>{
        if(protocolError)return;
        try{
          streamBytes+=buffer.length;
          if(streamBytes>MAX_STREAM_BYTES)throw Error('Pi JSON stream exceeded limit');
          pending+=decoder.write(buffer);
          if(Buffer.byteLength(pending,'utf8')>MAX_EVENT_LINE)throw Error('Oversized Pi JSON event');
          let i;
          while((i=pending.indexOf('\n'))!==-1){const line=pending.slice(0,i).replace(/\r$/,'');pending=pending.slice(i+1);parseLine(line)}
        }catch(e){protocolError=e.message;child.kill('SIGKILL')}
      });
      // Drain stderr to prevent a pipe stall; do not persist untrusted diagnostics.
      child.stderr.on('data',()=>{});
      child.once('error',e=>finish(`Cannot launch Pi JSON model: ${e.message}`,null));
      child.once('close',code=>{
        if(!protocolError)try{pending+=decoder.end();if(pending.trim())parseLine(pending.replace(/\r$/,''))}
          catch(e){protocolError=e.message}
        finish(null,code);
      });
    }catch(e){finish(e.message,null)}
  });
}

/** Persist a receipt for every attempted model call, including errors. No raw
 * prompts or responses are written. Unknown usage remains null. */
export async function recordModelCall({dir,purpose,taskIds=[],reviewId=null,attemptId=null,signature=null},invoke){
  if(!['review','propose','verify'].includes(purpose))throw Error('Unknown improvement model call purpose');
  const id=randomUUID(),startedAt=new Date().toISOString(),start=performance.now();
  let output,error=null,usage={totalTokens:null,coverage:'unknown'};
  try{
    const value=await invoke();
    const unpacked=unwrapModelOutput(value);output=unpacked.output;usage=unpacked.usage;
  }catch(e){error=e; if(e?.modelRun?.usage){
    const v=unwrapModelOutput(measuredModelOutput(null,e.modelRun.usage));usage=v.usage;
  }}
  const record={schemaVersion:1,id,purpose,taskIds:[...taskIds],reviewId,attemptId,signature,
    startedAt,finishedAt:new Date().toISOString(),durationMs:performance.now()-start,
    status:error?'failed':'returned',tokens:usage.totalTokens,tokenCoverage:usage.coverage,
    // Record a bounded diagnostic instead of a raw traceback, prompt or model text.
    ...(error?{error:String(error.message??error).slice(0,300)}:{})};
  const folder=join(dir,'model-calls');await mkdir(folder,{recursive:true});
  const target=join(folder,`${id}.json`),tmp=`${target}.${randomUUID()}.tmp`;
  await writeFile(tmp,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(tmp,target);
  if(error)throw error;
  return {output,receipt:record};
}

export async function listModelCalls(dir){
  const folder=join(dir,'model-calls');
  let names;try{names=await readdir(folder)}catch(e){if(e.code==='ENOENT')return [];throw e}
  return Promise.all(names.filter(n=>/^[a-f\d-]{36}\.json$/.test(n)).map(async n=>
    JSON.parse(await readFile(join(folder,n),'utf8'))));
}
