#!/usr/bin/env node
import {ingest,getReport,taskJsonView} from '../src/core.mjs';
import {getScopeContract} from '../src/scope.mjs';
import {processQueue,recoverQueue} from '../src/worker.mjs';
import {installProject} from '../src/install.mjs';
import {projectPaths,readProjectConfig} from '../src/store.mjs';
import {processReviews,processImprovementQueue} from '../src/improvement/queue.mjs';
import {listReviews} from '../src/improvement/review.mjs';
import {evaluateImpact,refreshImpact} from '../src/improvement/impact.mjs';

const [cmd,...args]=process.argv.slice(2);
const cwd=process.env.DEVH_CWD??process.cwd();
const out=data=>console.log(JSON.stringify(data,null,2));
try{
  if(cmd==='install')out(await installProject(args[0]??cwd));
  else if(cmd==='report')out(await getReport(cwd));
  else if(cmd==='contract')out(await getScopeContract(projectPaths(cwd).root));
  else if(cmd==='task'){
    const task=(await getReport(cwd)).tasks.find(t=>t.id===args[0]);
    if(!task)throw Error('Task not found: '+String(args[0]??''));
    out(taskJsonView(task));
  }
  else if(cmd==='process'){
    await recoverQueue(cwd);
    const verified=await processQueue(cwd);
    // Review is separate, bounded and opt-in. The developer's original
    // result is never held waiting for the analysis agent.
    let review=null,improvement=null;
    const cfg=await readProjectConfig(projectPaths(cwd).root);
    if(cfg.improvement?.autoReview){
      try{review=await processReviews(cwd,{maxBatches:1})}
      catch(e){review={state:'deferred',reason:String(e.message??e).slice(0,200)}}
    }
    if(cfg.improvement?.autoImprove){
      try{improvement=await processImprovementQueue(cwd)}
      catch(e){improvement={state:'deferred',reason:String(e.message??e).slice(0,200)}}
    }
    // Impact observations are refreshed AFTER delivery and any separate improvement attempt.
    // Failure to assess must never delay or invalidate the developer's result.
    let impact;
    try{impact=await refreshImpact(cwd)}catch(e){impact={state:'unavailable',reason:String(e.message??e).slice(0,200)}}
    out({verified,review,improvement,impact});
  }
  else if(cmd==='impact')out(await evaluateImpact(cwd));
  else if(cmd==='review')out(await processReviews(cwd,{maxBatches:1}));
  else if(cmd==='reviews')out(await listReviews(projectPaths(cwd).dir));
  else if(cmd==='improve')out(await processImprovementQueue(cwd));
  else if(cmd==='event'){
    const input=JSON.parse(args[0]??'{}');out(await ingest({cwd,...input}));
  } else {
    console.log('Usage: devh install [PROJECT] | contract | task ID | report | process | impact | review | reviews | improve | event JSON   (Codex/Pi adapters call these internally)');
  }
}catch(e){console.error('[devh] '+e.message);process.exitCode=1}
