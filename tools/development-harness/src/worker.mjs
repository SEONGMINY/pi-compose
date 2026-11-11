import {spawnSync} from 'node:child_process';
import {projectPaths, withState, readState, enqueue} from './store.mjs';
import {acceptanceForStep} from './acceptance.mjs';

const iso=()=>new Date().toISOString();
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function triage(task,priorTasks=[]) {
  const actual=task.actual;
  const p=task.forecast;
  const minutesOver80=finite(p?.minutes?.p80)&&actual?.activeMinutes>p.minutes.p80;
  const tokensOver80=finite(p?.tokens?.p80)&&finite(actual?.tokens)&&actual.tokens>p.tokens.p80;
  const signals=[...(minutesOver80?['time-p80']:[]),...(tokensOver80?['tokens-p80']:[]),
    ...(task.verification?.state==='failed'?['verification-failed']:[]),
    ...(actual?.tokens===null?['usage-incomplete']:[])];
  const relevant=signals.filter(x=>x!=='usage-incomplete');
  // A failure in unrelated work of the same generic kind is not a repeat.
  // This is a provisional cohort signal, not proof of common root cause.
  const repeated=priorTasks.filter(t=>t.id!==task.id && t.kind===task.kind && t.agent===task.agent &&
    relevant.some(signal=>t.analysis?.signals?.includes(signal))).length;
  return {at:iso(),signals,repeatedAnomalyCount:repeated,needsReview:signals.some(s=>s!=='usage-incomplete')||repeated>1,
    inference:'matching anomalies are not proof of a shared root cause',estimatedNetSaving:null};
}
async function runChecks(task){
  const results=[];
  const execCheck=(cmd,scope,stepId=null,criterion=null)=>{
    const t=Date.now();
    const r=spawnSync(cmd[0],cmd.slice(1),{cwd:task.workdir,encoding:'utf8',timeout:120_000,
      maxBuffer:1_000_000,env:process.env});
    const row={command:cmd,scope,stepId,criterion,ms:Date.now()-t,exitCode:r.status,error:r.error?.message??null,
      outputTail:(String(r.stdout??'')+'\n'+String(r.stderr??'')).slice(-1200)};
    results.push(row);
    return r.status===0 && !r.error;
  };
  for(const cmd of task.checks??[]){
    if(!execCheck(cmd,'project-check'))return {state:'failed',results,reason:'A required project check failed',acceptance:{state:'failed',steps:{}}};
  }
  const stepResults={};
  let completeContract=task.steps.length>0;
  for(const step of task.steps){
    const contract=acceptanceForStep(step,task.acceptanceContracts);
    const receipts=[];
    for(const entry of contract.covered?contract.entries:[]){
      const passed=execCheck(entry.command,'acceptance-check',step.id,entry.criterion);
      receipts.push({criterion:entry.criterion,command:entry.command,passed});
      if(!passed)return {state:'failed',results,reason:`Step ${step.id} acceptance check failed`,
        acceptance:{state:'failed',steps:{...stepResults,[step.id]:{state:'failed',receipts}}}};
    }
    const ok=contract.covered && receipts.length===step.ac.length;
    stepResults[step.id]={state:ok?'verified-by-contract':'unverified',receipts,missing:contract.missing,unexpected:contract.unexpected};
    if(!ok)completeContract=false;
  }
  if(!results.length)return {state:'unverified',results,reason:'No project-specific trusted checks or complete acceptance contracts configured',
    acceptance:{state:'unverified',steps:stepResults}};
  return {state:'passed',results,reason:null,
    acceptance:{state:completeContract?'verified-by-contract':'unverified',steps:stepResults,
      limitation:'Only the project-owner-declared executable criteria were checked; unlisted feature behavior is not proven'}};
}
export async function processQueue(cwd,{limit=10,run=runChecks}={}){
  const {dir}=projectPaths(cwd);let processed=[];
  for(let i=0;i<limit;i++){
    const item=await withState(dir,s=>{
      const pick=Object.entries(s.queue).find(([_,q])=>q.type==='verify'&&q.state==='pending');
      if(!pick)return null;
      const [id,q]=pick;q.state='running';q.attempts++;q.startedAt=iso();
      return {id,task:structuredClone(s.tasks[q.taskId]),revision:s.tasks[q.taskId].revision??0};
    });
    if(!item)break;
    let verdict;
    try{verdict=await run(item.task)}catch(e){verdict={state:'failed',results:[],reason:String(e)}}
    const result=await withState(dir,s=>{
      const q=s.queue[item.id],task=s.tasks[item.task.id];
      if(!q || !task)return {state:'missing'};
      if(task.runs.some(r=>r.status==='running') || (task.revision??0)!==item.revision){
        q.state='pending';q.reason='task-changed-during-verification';return {taskId:task.id,state:'deferred'};
      }
      task.verification={...verdict,finishedAt:iso()};q.state='done';q.finishedAt=iso();
      if(verdict.state==='passed'){
        const contractAccepted=verdict.acceptance?.state==='verified-by-contract';
        task.status=contractAccepted?'completed':'delivered-unverified';task.finishedAt=iso();
        task.acceptance=verdict.acceptance??{state:'unverified',steps:{}};
        for(const step of task.steps)step.status=task.acceptance.steps?.[step.id]?.state==='verified-by-contract'?'verified-by-contract':'checks-passed-ac-unverified';
      }else if(verdict.state==='failed'){
        task.status='verification-failed';task.finishedAt=iso();
        task.acceptance={...(verdict.acceptance??{state:'failed'}),reason:verdict.reason};
      }else {
        task.status='awaiting-verification';
        task.updatedAt=iso();return {taskId:task.id,state:'awaiting-verification'};
      }
      const wallMinutes=Math.max(0,(Date.parse(task.finishedAt)-task.startedAtMs)/60_000);
      const agentRunMs=task.runs.filter(r=>r.endedAt).reduce((n,r)=>n+Math.max(0,Date.parse(r.endedAt)-Date.parse(r.startedAt)),0);
      const checkMs=task.verification.results.reduce((n,r)=>n+(r.ms??0),0);
      const activeMinutes=(agentRunMs+checkMs)/60_000;
      const tokens=task.tokenUsage.events>0?task.tokenUsage.observed:null;
      task.actual={wallMinutes,tokens,coverage:tokens===null?'unknown':task.tokenUsage.missingEvents>0?'partial-observed':'observed-hooks-only',
        activeMinutes,agentRunMinutes:agentRunMs/60_000,checkMinutes:checkMs/60_000};
      task.analysis=triage(task,Object.values(s.tasks));
      // Cheap triage is done synchronously; unverified delivery is NOT accepted completion.
      // Expensive AI review is a separate queue.
      if(task.analysis.needsReview)enqueue(s,'review',task.id,'anomaly-or-repeat');
      const sessionKey=`${task.agent}:${task.sessionId}`;
      const session=s.sessions[sessionKey];
      if(session?.activeTaskId===task.id){session.lastTaskId=task.id;session.activeTaskId=null}
      return {taskId:task.id,state:task.status,analysis:task.analysis};
    });
    processed.push(result);
    // Do not hot-loop an active Task or run checks repeatedly while it changes.
    if(result.state==='deferred')break;
  }
  return processed;
}
/** Re-queue abandoned verification attempts from killed workers. */
export async function recoverQueue(cwd,{olderThanMs=600_000}={}){
  const {dir}=projectPaths(cwd);
  return withState(dir,s=>{
    const recovered=[];
    for(const [id,q] of Object.entries(s.queue)){
      if(['verify','improve'].includes(q.type)&&q.state==='running'&&Date.now()-Date.parse(q.startedAt)>olderThanMs){
        q.state='pending';q.reason='recovered-stale-worker';recovered.push(id)
      }
    }
    return recovered;
  });
}
