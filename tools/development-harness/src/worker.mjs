import {spawnSync} from 'node:child_process';
import {projectPaths, withState, readState, enqueue} from './store.mjs';

const iso=()=>new Date().toISOString();
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function triage(task,priorTasks=[]) {
  const actual=task.actual;
  const p=task.forecast;
  const minutesOver80=finite(p?.minutes?.p80)&&actual?.activeMinutes>p.minutes.p80;
  const tokensOver80=finite(p?.tokens?.p80)&&finite(actual?.tokens)&&actual.tokens>p.tokens.p80;
  const repeated=priorTasks.filter(t=>t.id!==task.id && t.kind===task.kind &&
    t.analysis?.signals?.some(s=>['time-p80','tokens-p80','verification-failed'].includes(s))).length;
  const signals=[...(minutesOver80?['time-p80']:[]),...(tokensOver80?['tokens-p80']:[]),
    ...(task.verification?.state==='failed'?['verification-failed']:[]),
    ...(actual?.tokens===null?['usage-incomplete']:[])];
  return {at:iso(),signals,repeatedAnomalyCount:repeated,needsReview:signals.some(s=>s!=='usage-incomplete')||repeated>1,
    inference:'signals are not proof of a root cause',estimatedNetSaving:null};
}
async function runChecks(task){
  if(!task.checks?.length)return {state:'unverified',results:[],reason:'No project-specific trusted checks configured'};
  const results=[];
  for(const cmd of task.checks){
    const t=Date.now();
    const r=spawnSync(cmd[0],cmd.slice(1),{cwd:task.workdir,encoding:'utf8',timeout:120_000,
      maxBuffer:1_000_000,env:process.env});
    const row={command:cmd,ms:Date.now()-t,exitCode:r.status,error:r.error?.message??null,
      outputTail:(String(r.stdout??'')+'\n'+String(r.stderr??'')).slice(-1200)};
    results.push(row);
    if(r.status!==0)return {state:'failed',results,reason:'A required project check failed'};
  }
  return {state:'passed',results,reason:null};
}
export async function processQueue(cwd,{limit=10,run=runChecks}={}){
  const {dir}=projectPaths(cwd);let processed=[];
  for(let i=0;i<limit;i++){
    const item=await withState(dir,s=>{
      const pick=Object.entries(s.queue).find(([_,q])=>q.type==='verify'&&q.state==='pending');
      if(!pick)return null;
      const [id,q]=pick;q.state='running';q.attempts++;q.startedAt=iso();
      return {id,task:structuredClone(s.tasks[q.taskId])};
    });
    if(!item)break;
    let verdict;
    try{verdict=await run(item.task)}catch(e){verdict={state:'failed',results:[],reason:String(e)}}
    const result=await withState(dir,s=>{
      const q=s.queue[item.id],task=s.tasks[item.task.id];
      if(!q || !task)return {state:'missing'};
      if(task.runs.some(r=>r.status==='running')){
        q.state='pending';q.reason='still-running';return {taskId:task.id,state:'deferred'};
      }
      task.verification={...verdict,finishedAt:iso()};q.state='done';q.finishedAt=iso();
      if(verdict.state==='passed'){
        task.status='completed';task.finishedAt=iso();
        // Successful checks do not establish every semantic AC; record that limitation.
        for(const step of task.steps)step.status='checks-passed-ac-unverified';
      }else if(verdict.state==='failed'){
        task.status='verification-failed';task.finishedAt=iso();
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
      // Cheap triage is done synchronously; expensive AI review is a separate queue.
      if(task.analysis.needsReview)enqueue(s,'review',task.id,'anomaly-or-repeat');
      const sessionKey=`${task.agent}:${task.sessionId}`;
      const session=s.sessions[sessionKey];
      if(session?.activeTaskId===task.id){session.lastTaskId=task.id;session.activeTaskId=null}
      return {taskId:task.id,state:task.status,analysis:task.analysis};
    });
    processed.push(result);
  }
  return processed;
}
/** Re-queue abandoned verification attempts from killed workers. */
export async function recoverQueue(cwd,{olderThanMs=600_000}={}){
  const {dir}=projectPaths(cwd);
  return withState(dir,s=>{
    const recovered=[];
    for(const [id,q] of Object.entries(s.queue)){
      if(q.type==='verify'&&q.state==='running'&&Date.now()-Date.parse(q.startedAt)>olderThanMs){
        q.state='pending';q.reason='recovered-stale-worker';recovered.push(id)
      }
    }
    return recovered;
  });
}
