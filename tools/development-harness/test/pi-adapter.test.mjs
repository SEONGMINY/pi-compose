import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
test('Pi extension simulated custom and user events: custom never creates a maintenance task',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'devh-pi-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 await writeFile(join(cwd,'.devh.json'),JSON.stringify({checks:[]}));
 const source=`
   import assert from 'node:assert/strict';
   import extension from ${JSON.stringify(new URL('../adapters/pi-extension.ts',import.meta.url).href)};
   import {getReport} from ${JSON.stringify(new URL('../src/core.mjs',import.meta.url).href)};
   const events={};extension({on:(id,cb)=>{events[id]=cb}});
   const ctx={cwd:${JSON.stringify(cwd)},sessionManager:{getSessionFile:()=>null}};
   await events.before_agent_start({messageType:'custom',message:{content:'internal review'}},ctx);
   assert.equal((await getReport(ctx.cwd)).tasks.length,0);
   await events.before_agent_start({messageType:'user',prompt:'Fix API bug'},ctx);
   await events.message_end({message:{role:'assistant',id:'answer-1',usage:{totalTokens:345}}},ctx);
   await events.message_end({message:{role:'assistant',id:'answer-1',usage:{totalTokens:345}}},ctx);
   const report=await getReport(ctx.cwd);
   assert.equal(report.tasks.length,1);assert.equal(report.tasks[0].tokenUsage.observed,345);
 `;
 const p=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',source],{encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
});
