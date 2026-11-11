#!/usr/bin/env node
import {ingest,getReport} from '../src/core.mjs';
import {processQueue,recoverQueue} from '../src/worker.mjs';
import {installProject} from '../src/install.mjs';

const [cmd,...args]=process.argv.slice(2);
const cwd=process.env.DEVH_CWD??process.cwd();
const out=data=>console.log(JSON.stringify(data,null,2));
try{
  if(cmd==='install')out(await installProject(args[0]??cwd));
  else if(cmd==='report')out(await getReport(cwd));
  else if(cmd==='process'){await recoverQueue(cwd);out(await processQueue(cwd))}
  else if(cmd==='event'){
    const input=JSON.parse(args[0]??'{}');out(await ingest({cwd,...input}));
  } else {
    console.log('Usage: devh install [PROJECT] | report | process | event JSON   (Codex/Pi adapters call these internally)');
  }
}catch(e){console.error('[devh] '+e.message);process.exitCode=1}
