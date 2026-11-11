/** Compatibility bridge from the new Task/Step/Run journal to the evidence
 * contract of PR #29. This does not migrate historic JSONL or alter product UX.
 */
import {readState} from '../store.mjs';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function toAnalysisTask(task){
  const m=task.actual;
  const total=m?.tokens;
  return {id:task.id,title:task.title,kind:task.kind,environment:task.agent,
    state:task.status==='completed'?'completed':task.status==='delivered-unverified'?'delivered-unverified':
      task.status==='verification-failed'?'failed':task.status,
    forecast:{minutes:task.forecast?.minutes??null,tokens:task.forecast?.tokens??null},
    assumptions:'',startedAt:task.startedAt,endedAt:task.finishedAt??task.updatedAt??task.startedAt,
    measurement:m?{elapsedMs:(m.activeMinutes??0)*60_000,elapsedBasis:'observed-active',wallMs:(m.wallMinutes??0)*60_000,
      activeMs:(m.activeMinutes??0)*60_000,tokens:finite(total)?{totalTokens:total}:null}:null};
}
export async function listTasks(dir){const state=await readState(dir);return Object.values(state.tasks).map(toAnalysisTask)}
export async function getTask(dir,id){const state=await readState(dir);if(!state.tasks[id])throw Error(`Unknown task ${id}`);return toAnalysisTask(state.tasks[id])}
export async function pendingRootCauseReviews(dir){
  const state=await readState(dir);
  let reviews=[];
  try{ const names=await readdir(join(dir,'reviews'));
    reviews=await Promise.all(names.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(async n=>JSON.parse(await readFile(join(dir,'reviews',n),'utf8'))));
  }catch(e){if(e.code!=='ENOENT')throw e;}
  const reviewed=new Set(reviews.flatMap(x=>x.taskIds??[]));
  return Object.values(state.queue).filter(q=>q.type==='review'&&q.state==='pending'&&(!q.nextAttemptAt||Date.parse(q.nextAttemptAt)<=Date.now())&&!reviewed.has(q.taskId))
    .map(q=>{
      const task=state.tasks[q.taskId];if(!task)return null;
      const actual=task.actual;
      return {taskId:task.id,state:task.status,rootCause:'undetermined',needsRootCauseReview:true,
        compared:{minutes:{aboveP80:task.analysis?.signals?.includes('time-p80')??false,actual:actual?.activeMinutes??null,
          coverage:finite(actual?.activeMinutes)?'observed':'missing'},
          tokens:{aboveP80:task.analysis?.signals?.includes('tokens-p80')??false,actual:actual?.tokens??null,
            coverage:finite(actual?.tokens)?'observed':'missing'}}};
    }).filter(Boolean);
}
