/** Post-change impact is an observation, never a causal attribution or a model-claimed saving.
 * Only attempts actually integrated on local main can be evaluated. A post-task must
 * start from a clean revision descending from the improvement commit.
 */
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {projectPaths,readState} from '../store.mjs';

const numeric=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const median=values=>{
  if(!values.length)return null;
  const a=[...values].sort((x,y)=>x-y),i=Math.floor(a.length/2);
  return a.length%2?a[i]:(a[i-1]+a[i])/2;
};

/** Capture once, before code changes. A dirty or unknown source cannot prove exposure. */
export function sourceRevision(root){
  try{
    const run=(args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:2500,maxBuffer:64_000}).trim();
    const head=run(['rev-parse','--verify','HEAD']);
    const dirty=run(['status','--porcelain=v1','--untracked-files=normal']);
    return {head,clean:dirty.length===0,provenance:'git-start-snapshot'};
  }catch{return {head:null,clean:null,provenance:'unavailable'};}
}

async function readJsonRows(dir){
  let names;
  try{names=await readdir(dir);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  return Promise.all(names.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).sort().map(async name=>
    JSON.parse(await readFile(join(dir,name),'utf8'))));
}

const comparable=(t,kind,agent,stepCount,status)=>t.kind===kind&&t.agent===agent&&
  t.steps?.length===stepCount&&t.status===status&&numeric(t.actual?.activeMinutes);
const goodTokens=t=>numeric(t.actual?.tokens)&&t.actual?.coverage==='observed-hooks-only'&&
  t.tokenUsage?.missingEvents===0;

/** Optional test seam. Real code must verify Git ancestry, not just timestamps. */
function ancestor(root,older,newer){
  try{
    execFileSync('git',['merge-base','--is-ancestor',older,newer],
      {cwd:root,stdio:'ignore',timeout:2500});
    return true;
  }catch{return false;}
}
function pair(before,after,selector){
  const x=before.map(selector).filter(numeric),y=after.map(selector).filter(numeric);
  const b=median(x),a=median(y);
  return {beforeCount:x.length,afterCount:y.length,beforeMedian:b,afterMedian:a,
    medianDifference:b===null||a===null?null:b-a};
}

export function assessAttempt(attempt,tasks,reviews,attempts,{repo,hasAncestor=ancestor,minCohort=3}={}){
  const base={schemaVersion:1,attemptId:attempt.id,reviewId:attempt.reviewId,
    changeCommit:attempt.commit??null,attemptState:attempt.state,attemptFinishedAt:attempt.finishedAt??null,
    causalClaim:false,netSavings:null,netTokenSavings:null,
    limitation:'Observational matching by agent, kind, Step count, technical acceptance and clean Git ancestry does not control task difficulty or other changes.'};
  const review=reviews.find(r=>r.id===attempt.reviewId);
  const charged=attempts.filter(a=>a.reviewId===attempt.reviewId&&numeric(a.totalWallMs));
  const reviewMs=numeric(review?.reviewWallMs)?review.reviewWallMs:
    numeric(review?.modelWallMs)?review.modelWallMs:null;
  const timeCostLowerBoundMinutes=reviewMs===null?null:
    (reviewMs+charged.reduce((n,a)=>n+a.totalWallMs,0))/60_000;
  const cost={timeCostLowerBoundMinutes,attemptCount:charged.length,
    modelTokens:null,tokenCoverage:'unmeasured',
    limitation:'Recorded review/attempt wall time is a lower bound on total improvement effort; AI tokens and external costs are not yet attributable.'};
  if(attempt.state!=='integrated-local')return {...base,status:'not-applied',cost,
    reason:'A draft or blocked attempt is not a confirmed local-main integration.'};
  if(!attempt.commit||!repo)return {...base,status:'unverifiable-exposure',cost,reason:'Missing integration commit or repository.'};
  const related=tasks.filter(t=>attempt.relatedTaskIds?.includes(t.id));
  const kind=[...new Set(related.map(t=>t.kind))],agent=[...new Set(related.map(t=>t.agent))],
    stepCounts=[...new Set(related.map(t=>t.steps?.length))];
  if(kind.length!==1||agent.length!==1||stepCounts.length!==1)
    return {...base,status:'incomparable-source-tasks',cost,
      reason:'Source tasks must share agent, kind and Step count (failed source tasks are allowed).'};
  // Source anomalies may be failures. Compare only technically accepted delivery
  // cohorts before/after to avoid treating failures as cheap successful work.
  const cohort=tasks.filter(t=>comparable(t,kind[0],agent[0],stepCounts[0],'completed')&&
    t.source?.clean===true&&typeof t.source.head==='string'&&
    /^[a-f0-9]{40}$/.test(t.source.head)&&
    !t.runs?.some(r=>r.status==='running'));
  const exposure=new Map();
  const isExposed=t=>{
    if(!exposure.has(t.source.head))exposure.set(t.source.head,hasAncestor(repo,attempt.commit,t.source.head));
    return exposure.get(t.source.head);
  };
  // Stop observing at the next confirmed intervention in the same repository.
  // Otherwise a second improvement could be misattributed to the first.
  const nextIntervention=attempts.filter(a=>a.id!==attempt.id && a.state==='integrated-local'&&
    a.finishedAt && attempt.finishedAt && a.finishedAt>attempt.finishedAt)
    .sort((a,b)=>a.finishedAt.localeCompare(b.finishedAt))[0]??null;
  // Explicitly exclude tasks that straddle integration or lack a traceable revision.
  const before=cohort.filter(t=>t.finishedAt && attempt.startedAt &&
    t.finishedAt<attempt.startedAt&&!isExposed(t));
  const after=cohort.filter(t=>t.startedAt && attempt.finishedAt &&
    t.startedAt>attempt.finishedAt&&(!nextIntervention||t.startedAt<nextIntervention.finishedAt)&&isExposed(t));
  const time=pair(before,after,t=>t.actual.activeMinutes);
  const tokens=pair(before.filter(goodTokens),after.filter(goodTokens),t=>t.actual.tokens);
  const enoughTime=time.beforeCount>=minCohort&&time.afterCount>=minCohort;
  const enoughTokens=tokens.beforeCount>=minCohort&&tokens.afterCount>=minCohort;
  const status=!enoughTime?'insufficient-comparable-tasks':!enoughTokens?'incomplete-token-coverage':'directional-observation';
  const directionalTimeBalanceMinutes=enoughTime&&timeCostLowerBoundMinutes!==null?
    time.medianDifference*time.afterCount-timeCostLowerBoundMinutes:null;
  return {...base,status,observationWindowEndsAt:nextIntervention?.finishedAt??null,
    cohort:{agent:agent[0],kind:kind[0],stepCount:stepCounts[0],acceptance:'completed'},
    beforeTaskIds:before.map(t=>t.id),afterTaskIds:after.map(t=>t.id),time,tokens,cost,
    directionalTimeBalanceMinutes,
    signal:!enoughTime?'not-enough-comparable-tasks':
      time.medianDifference<0?'observed-slower':time.medianDifference>0?'observed-faster':'no-observed-time-difference',
    caveat:'Directional time balance projects the median difference across observed follow-up tasks; it is NOT realized savings or causal net ROI. Token cost prevents a net two-resource verdict.'};
}

export async function evaluateImpact(cwd,{hasAncestor,minCohort=3}={}){
  const {root,dir}=projectPaths(cwd);
  const [state,reviews,attempts]=await Promise.all([
    readState(dir),readJsonRows(join(dir,'reviews')),readJsonRows(join(dir,'attempts'))]);
  const tasks=Object.values(state.tasks);
  return attempts.filter(a=>['integrated-local','verified-draft'].includes(a.state))
    .map(a=>assessAttempt(a,tasks,reviews,attempts,{repo:root,hasAncestor,minCohort}));
}

/** Durable, replay-safe snapshots; never change the approved policy automatically. */
export async function refreshImpact(cwd,options={}){
  const {dir}=projectPaths(cwd),assessments=await evaluateImpact(cwd,options);
  const target=join(dir,'impact');
  if(assessments.length)await mkdir(target,{recursive:true});
  for(const record of assessments){
    const path=join(target,`${record.attemptId}.json`);
    const temporary=`${path}.${randomUUID()}.tmp`;
    await writeFile(temporary,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
    await rename(temporary,path);
  }
  return assessments;
}

export async function recentImpactEvidence(dir,{limit=5}={}){
  const records=await readJsonRows(join(dir,'impact'));
  return records.filter(r=>r.status==='directional-observation')
    .sort((a,b)=>(a.attemptFinishedAt??'').localeCompare(b.attemptFinishedAt??''))
    .slice(-limit).map(r=>({
    attemptId:r.attemptId,reviewId:r.reviewId,cohort:r.cohort,time:r.time,tokens:r.tokens,
    cost:r.cost,signal:r.signal,causalClaim:false,limitation:r.limitation}));
}
