/** Run expensive review separately from the provider turn. Persist review
 * receipts first, then acknowledge the queue; replay is idempotent on restart.
 */
import {projectPaths,withState,readState} from '../store.mjs';
import {executeImprovement,listAttempts} from './change.mjs';
import {join} from 'node:path';
import {stat} from 'node:fs/promises';
import {reviewPending,listReviews} from './review.mjs';
export async function processReviews(cwd,{runModel,maxBatches=1,dryRun=false}={}){
  const {root,dir}=projectPaths(cwd);
  let result;
  try{
    result=await reviewPending({dir,cwd:root,maxBatches,dryRun,...(runModel?{runModel}:{})});
  }catch(e){
    // Do not discard the queued review when the model/host is unavailable.
    // Back off subsequent automatic retries, preserving the original evidence.
    if(!dryRun)await withState(dir,state=>{
      for(const q of Object.values(state.queue))if(q.type==='review'&&q.state==='pending'&&
        (!q.nextAttemptAt||Date.parse(q.nextAttemptAt)<=Date.now())){
        q.lastError=String(e.message??e).slice(0,500);
        q.failures=(q.failures??0)+1;
        q.nextAttemptAt=new Date(Date.now()+Math.min(3600_000,60_000*2**Math.min(q.failures,6))).toISOString();
      }
    });
    throw e;
  }
  if(dryRun)return result;
  const reviews=await listReviews(dir);
  await withState(dir,state=>{
    for(const review of reviews){
      if(review.candidate?.executionState==='proposed-not-approved'&&!state.queue[`improve:${review.id}`])
        state.queue[`improve:${review.id}`]={type:'improve',reviewId:review.id,taskId:review.taskIds[0],state:'pending',
          attempts:0,reason:'cost-aware-evidence-backed-candidate',createdAt:new Date().toISOString()};
      for(const taskId of review.taskIds??[]){
        const q=state.queue[`review:${taskId}`];
        if(q&&q.state!=='done'){
          q.state='done';q.reviewId=review.id;q.finishedAt=new Date().toISOString();
        }
      }
    }
  });
  return {...result,reviewedCount:reviews.length};
}

/** No automatic Git changes without a locally approved, path-limited policy.
 * Only one improvement is attempted per invocation, after development delivery.
 */
export async function processImprovementQueue(cwd,{propose,verify,checks}={}){
  const {root,dir}=projectPaths(cwd);
  const policyFile=join(dir,'automation-policy.json');
  try{await stat(policyFile)}catch(e){if(e.code==='ENOENT')return {state:'deferred',reason:'No local improvement allowlist policy'};throw e;}
  const previouslyAccepted=new Set((await listAttempts(dir)).filter(a=>['verified-draft','integrated-local'].includes(a.state)).map(a=>a.reviewId));
  const item=await withState(dir,state=>{
    // The process can die after writing a verified attempt but before queue ack.
    for(const q of Object.values(state.queue))if(q.type==='improve'&&previouslyAccepted.has(q.reviewId)){
      q.state='done';q.finishedAt??=new Date().toISOString();q.reason='already-accepted-attempt';
    }
    const pick=Object.entries(state.queue).find(([_,q])=>q.type==='improve'&&q.state==='pending'&&
      !previouslyAccepted.has(q.reviewId)&&(!q.nextAttemptAt||Date.parse(q.nextAttemptAt)<=Date.now()));
    if(!pick)return null;
    const [id,q]=pick;q.state='running';q.attempts++;q.startedAt=new Date().toISOString();
    return {id,reviewId:q.reviewId};
  });
  if(!item)return {state:'idle'};
  let result;
  try{result=await executeImprovement({repo:root,dir,reviewId:item.reviewId,policyFile,
    ...(propose?{propose}:{}),...(verify?{verify}:{}),...(checks?{checks}:{})});}
  catch(e){result={state:'blocked',error:String(e.message??e)}}
  await withState(dir,state=>{
    const q=state.queue[item.id];if(!q)return;
    q.lastAttemptState=result.state;
    if(result.state==='verified-draft'||result.state==='integrated-local'){
      q.state='done';q.attemptId=result.id;q.finishedAt=new Date().toISOString();
    }else{
      q.state='pending';q.lastError=(result.error??'Safety gate blocked improvement').slice(0,500);
      q.failures=(q.failures??0)+1;
      q.nextAttemptAt=new Date(Date.now()+Math.min(24*3600_000,60_000*2**Math.min(q.failures,10))).toISOString();
    }
  });
  return {state:result.state,reviewId:item.reviewId,attemptId:result.id??null,reason:result.error??null};
}
