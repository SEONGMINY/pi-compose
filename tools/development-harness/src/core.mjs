import { randomUUID, createHash } from 'node:crypto';
import { withState, readState, projectPaths, readProjectConfig, enqueue } from './store.mjs';
import { initialPlan, validatePlan, classifyFollowup, isClearlyNonDevelopment } from './plan.mjs';
import { chooseForecast } from './forecast.mjs';

const iso = () => new Date().toISOString();
const digest = s=>createHash('sha256').update(s).digest('hex');
const allowed = new Set(['prompt','usage','request-start','request-end','scope-change','settled','interrupt','end','verify-passed','verify-failed']);
const validId=s=>typeof s==='string'&&s.length>0&&s.length<240;
const onlyNumber=n=>Number.isSafeInteger(n)&&n>=0?n:null;
const normalizeTokens=raw=>{
  if(!raw||typeof raw!=='object')return null;
  const total=onlyNumber(raw.total_tokens??raw.totalTokens??raw.total);
  const input=onlyNumber(raw.input_tokens??raw.input),output=onlyNumber(raw.output_tokens??raw.output);
  const n=total??(input!==null&&output!==null?input+output:null);
  return Number.isSafeInteger(n)&&n>=0?n:null;
};

/** Provider-normalized event entrypoint. Hook repeats and cross-process races are serialized. */
export async function ingest({cwd,agent,sessionId,turnId,event,prompt,usage,eventId,plan,kind='feature',sessionFile,taskIntent='auto',stepId,requestAgentId=null,requestStatus=null,planProvenance=null}) {
  if(!allowed.has(event))throw Error(`Unsupported event ${event}`);
  if(event==='verify-passed'||event==='verify-failed')throw Error('Verification must be submitted by trusted worker, not provider hooks');
  if(!['auto','new','continue','rework'].includes(taskIntent))throw Error('Invalid task intent');
  if(!['pi','codex','other'].includes(agent)||!validId(sessionId)||!validId(turnId))throw Error('Invalid agent/session/turn');
  const {dir,root}=projectPaths(cwd);
  const cfg=await readProjectConfig(root);
  return withState(dir, state=>{
    const sessionKey=`${agent}:${sessionId}`;
    // No stable provider attempt id is guaranteed for usage events; do not fabricate one.
    const key=eventId?`${sessionKey}:${eventId}`:null;
    if(key&&state.seen[key])return {duplicate:true,...state.seen[key]};
    const session=state.sessions[sessionKey]??{lastTaskId:null,activeTaskId:null};
    let task=session.activeTaskId?state.tasks[session.activeTaskId]:null;
    if(event==='prompt'){
      if(typeof prompt!=='string'||!prompt.trim())throw Error('Prompt required');
      if(taskIntent==='auto'&&isClearlyNonDevelopment(prompt))return {ignored:true,reason:'high-confidence-non-development'};
      // A provider may repeat the same turn with no event ID. Never invent another Run.
      const runId=`${agent}:${sessionId}:${turnId}`;
      const previousRunTask=Object.values(state.tasks).find(t=>t.runs.some(r=>r.id===runId));
      if(previousRunTask)return {duplicate:true,taskId:previousRunTask.id,runId,forecast:previousRunTask.forecast};
      const previous=task??(session.lastTaskId?state.tasks[session.lastTaskId]:null);
      const classification=taskIntent==='auto'?classifyFollowup(prompt,previous?.title??''):{intent:taskIntent,basis:'provider-explicit'};
      const resumable=previous && ['running','awaiting-verification','delivered-unverified','verification-failed','interrupted'].includes(previous.status);
      const reuse=resumable && ['continue','rework'].includes(classification.intent);
      if(reuse){
        task=previous;
        if(task.status!=='running'){
          task.deliveries??=[];
          if(task.actual)task.deliveries.push({actual:structuredClone(task.actual),analysis:task.analysis??null,at:task.finishedAt??iso()});
          task.reopenCount=(task.reopenCount??0)+1;
          task.actual=null;task.analysis=null;task.verification=null;task.finishedAt=null;
        }
        task.status='running';session.activeTaskId=task.id;
      }else{
        const id=randomUUID();
        const forecast=chooseForecast(state.tasks,{agent,kind,seed:cfg.forecastSeed});
        const steps=validatePlan(plan??initialPlan(prompt)).map(p=>({...p,status:'pending',runs:[]}));
        task={id,agent,sessionId,kind,title:prompt.slice(0,200),originalPromptHash:digest(prompt),steps,planProvenance:planProvenance??'deterministic',
          forecast,status:'running',startedAt:iso(),startedAtMs:Date.now(),runs:[],
          tokenUsage:{observed:0,events:0,missingEvents:0,coverage:'observed-events-only'},
          checks:cfg.checks,acceptanceContracts:cfg.acceptanceContracts,workdir:root,verification:null,actual:null,
          relatedTaskId:previous?.id??null,relation:previous?classification.intent:'initial',
          boundaryBasis:previous?classification.basis:'first-task',reopenCount:0,deliveries:[],revision:0};
        state.tasks[id]=task;session.activeTaskId=id;
        if(previous&&session.lastTaskId!==previous.id)session.lastTaskId=previous.id;
      }
      const step=stepId?task.steps.find(s=>s.id===stepId):task.steps.find(s=>s.status!=='completed'&&s.status!=='checks-passed-ac-unverified');
      const assigned=step??task.steps.at(-1);
      if(stepId&&!step)throw Error(`Unknown step ${stepId}`);
      assigned.status='running';assigned.runs.push(runId);
      task.runs.push({id:runId,turnId,status:'running',startedAt:iso(),tokens:0,missingUsage:0,
        stepId:assigned.id,sessionFile:sessionFile??null,modelRequests:[]});
      task.revision=(task.revision??0)+1;
      task.updatedAt=iso();
      state.sessions[sessionKey]=session;
      const result={taskId:task.id,runId,forecast:task.forecast,
        taskBoundary:{intent:task.relation??classification.intent,basis:task.boundaryBasis??classification.basis},
        plan:task.steps.map(({id,goal,ac,dependencies})=>({id,goal,ac,dependencies}))};
      if(key)state.seen[key]=result;
      return result;
    }
    const runId=`${agent}:${sessionId}:${turnId}`;
    // A previous run can settle after a newer, unrelated Task starts in the
    // same session. Route by the stable Run identity, not the active Task.
    task=Object.values(state.tasks).find(t=>t.runs.some(r=>r.id===runId));
    if(!task)return {ignored:true,reason:'unknown-turn'};
    const run=task.runs.find(x=>x.id===runId);
    if(event==='scope-change'){
      // A model may extend the plan, but must never rewrite already started
      // obligations or retroactively alter the forecast.
      const refined=validatePlan(plan);
      if(refined.length<=task.steps.length)throw Error('A scope change must append at least one step');
      for(let i=0;i<task.steps.length;i++){
        const {id,goal,ac,dependencies}=task.steps[i];
        if(JSON.stringify(refined[i])!==JSON.stringify({id,goal,ac,dependencies}))
          throw Error('Existing plan steps are immutable after execution starts');
      }
      const appended=refined.slice(task.steps.length).map(x=>({...x,status:'pending',runs:[]}));
      task.steps.push(...appended);
      task.scopeChanges??=[];
      task.scopeChanges.push({at:iso(),runId,addedStepIds:appended.map(x=>x.id),basis:'explicit-plan-extension',
        originalForecastPreserved:true});
      task.revision=(task.revision??0)+1;task.updatedAt=iso();
      return {taskId:task.id,revision:task.revision,addedSteps:appended.length,forecast:task.forecast};
    }
    if(event==='request-start'){
      // Codex does not expose a stable model-attempt ID in its public hook
      // schema. Pair PreModelRequest/PostModelRequest by turn and queue order.
      // This is best-effort; concurrent/out-of-order callbacks remain uncertain.
      run.modelRequests??=[];
      const attempt={id:`local-${run.modelRequests.length+1}`,startedAt:iso(),state:'pending',idProvenance:'local-sequence',
        agentId:requestAgentId??null};
      run.modelRequests.push(attempt);
    } else if(event==='request-end'){
      run.modelRequests??=[];
      // Pair by agent identity first; otherwise concurrent subagent callbacks
      // could be charged to the wrong attempt. Attempt IDs remain best-effort.
      const attempt=run.modelRequests.find(x=>x.state==='pending' && x.agentId===(requestAgentId??null));
      if(!attempt){
        run.missingUsage++;task.tokenUsage.missingEvents++;
        return {ignored:true,reason:'unmatched-model-request',taskId:task.id,runId};
      }
      attempt.state='observed';attempt.endedAt=iso();attempt.outcome=requestStatus??'unknown';
      const amount=normalizeTokens(usage);
      if(amount===null){
        run.missingUsage++;task.tokenUsage.missingEvents++;attempt.tokens=null;
      } else {
        attempt.tokens=amount;run.tokens+=amount;task.tokenUsage.observed+=amount;task.tokenUsage.events++;
      }
    } else if(event==='usage'){
      const amount=normalizeTokens(usage);
      if(amount===null){run.missingUsage++;task.tokenUsage.missingEvents++}
      else if(!eventId){
        // Without an upstream request ID, a retried hook is indistinguishable
        // from a second identical model call. Preserve unknown rather than double count.
        run.missingUsage++;task.tokenUsage.missingEvents++;
      }else {run.tokens+=amount;task.tokenUsage.observed+=amount;task.tokenUsage.events++}
    } else if(event==='settled'||event==='interrupt'||event==='end'){
      if(run.status==='running'){
        run.status=event==='settled'?'settled':event==='interrupt'?'interrupted':'session-ended';run.endedAt=iso();
      }
      const active=task.runs.some(r=>r.status==='running');
      if(!active&&task.status==='running'){
        task.status=event==='settled'?'awaiting-verification':'interrupted';
        if(event==='settled'){const q=enqueue(state,'verify',task.id,'turn-settled');
          if(state.queue[q].state==='done')state.queue[q].state='pending';}
        if(event==='interrupt'||event==='end'){
          task.actual={wallMinutes:Math.max(0,(Date.now()-task.startedAtMs)/60_000),
            tokens:task.tokenUsage.events?task.tokenUsage.observed:null,
            coverage:'interrupted-partial',
            activeMinutes:task.runs.filter(r=>r.endedAt).reduce((n,r)=>n+Math.max(0,Date.parse(r.endedAt)-Date.parse(r.startedAt)),0)/60_000};
          enqueue(state,'review',task.id,'incomplete-task');
        }
      }
    } else if(event==='verify-passed'||event==='verify-failed'){
      throw Error('Verification must be submitted by trusted worker, not provider hooks');
    }
    task.updatedAt=iso();
    const result={taskId:task.id,runId,status:task.status,tokenUsage:task.tokenUsage};
    if(key)state.seen[key]=result;
    return result;
  });
}

export async function getReport(cwd) {
 const {dir}=projectPaths(cwd);const state=await readState(dir);
 return {tasks:Object.values(state.tasks),queue:Object.entries(state.queue).map(([id,x])=>({id,...x})),sessions:state.sessions};
}
