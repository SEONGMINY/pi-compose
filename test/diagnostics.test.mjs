import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,mkdirSync,statSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
 configureDiagnostics,diagnosticEvent,startFlow,finishFlow,
 diagnosticsDir,readDiagnosticEvents,analyzeDiagnostics,
 exportDiagnostics,clearDiagnostics,diagnosticStatus,discloseDiagnostics
} from '../src/diagnostics.mjs';

test('private local events use an allowlist and stable flow IDs', async t=>{
 const dir=mkdtempSync(join(tmpdir(),'pic-ux-diag-'));
 const prev=process.env.PI_CODING_AGENT_DIR;
 process.env.PI_CODING_AGENT_DIR=dir;
 t.after(async()=>{if(prev===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=prev;await rm(dir,{recursive:true,force:true});});
 configureDiagnostics(true);
 const flow=startFlow('launch.started',{source:'natural-language',data:{
  workspace:'worktree',context:'fork',prompt:'SECRET prompt',path:'/Users/private/repo'
 }});
 diagnosticEvent('launch.approval',{flowId:flow.flowId,source:'natural-language',outcome:'success'});
 finishFlow(flow,'launch.finished',{source:'natural-language',outcome:'success',data:{context:'fork'}});
 const events=readDiagnosticEvents({days:1});
 assert.equal(events.length,3);
 assert.equal(events[0]?.flowId,events[2]?.flowId);
 assert.ok(events[2]?.data?.elapsedMs>=0);
 const raw=JSON.stringify(events);
 assert.ok(!raw.includes('SECRET prompt'));
 assert.ok(!raw.includes('/Users/private/repo'));
 const folder=diagnosticsDir();
 assert.equal(statSync(folder).mode & 0o777,0o700);
 const files=readdirSync(folder).filter(f=>f.endsWith('.jsonl'));
 assert.equal(files.length,1);
 assert.equal(statSync(join(folder,files[0])).mode&0o777,0o600);
 const out=join(folder,'export.json');
 const exported=exportDiagnostics({days:1,output:out});
 const filtered=exportDiagnostics({days:1,runId:events[0].runId});
 assert.equal(filtered.report.events.length,3);
 assert.equal(filtered.report.filteredRunId,events[0].runId);
 assert.equal(exportDiagnostics({days:1,runId:'00000000-0000-4000-8000-000000000000'}).report.events.length,0);
 assert.equal(exported.report.summary.metrics.delegation.dispatchSucceeded,1);
 assert.equal(statSync(out).mode&0o777,0o600);
 assert.ok(!readFileSync(out,'utf8').includes('SECRET prompt'));
 assert.equal(clearDiagnostics(),1);
 assert.equal(readDiagnosticEvents({days:1}).length,0);
});
test('preview is separate and stage categories are privacy safe', async t => {
 const dir=mkdtempSync(join(tmpdir(),'pic-ux-preview-')),prev=process.env.PI_CODING_AGENT_DIR;
 process.env.PI_CODING_AGENT_DIR=dir;
 t.after(async()=>{if(prev===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=prev;await rm(dir,{recursive:true,force:true});});
 configureDiagnostics(true);
 const preview=startFlow('launch.started',{source:'slash',data:{route:'preview'}});
 finishFlow(preview,'launch.finished',{source:'slash',outcome:'success',data:{route:'preview'}});
 const real=startFlow('launch.started',{source:'slash',data:{route:'launch'}});
 diagnosticEvent('launch.stage',{source:'slash',flowId:real.flowId,outcome:'failure',data:{stage:'dispatch',failureKind:'workmux_dispatch',stderr:'SECRET',path:'/Users/private'}});
 finishFlow(real,'launch.finished',{source:'slash',outcome:'failure',data:{route:'launch'}});
 const events=readDiagnosticEvents({days:1}),m=analyzeDiagnostics(events).metrics;
 assert.equal(m.preview.started,1);
 assert.equal(m.preview.completed,1);
 assert.equal(m.delegation.started,1);
 assert.equal(m.delegation.dispatchSucceeded,0);
 assert.equal(m.delegation.failures,1);
 assert.equal(m.launchFailureStages.dispatch,1);
 assert.equal(events.find(e=>e.event==='launch.stage')?.data?.failureKind,'workmux_dispatch');
 assert.ok(!JSON.stringify(events).includes('SECRET'));
 assert.ok(!JSON.stringify(events).includes('/Users/private'));
});
test('disabled collection does not append events',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'pic-ux-off-'));const prev=process.env.PI_CODING_AGENT_DIR;
 process.env.PI_CODING_AGENT_DIR=dir;
 t.after(async()=>{if(prev===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=prev;await rm(dir,{recursive:true,force:true});});
 assert.equal(discloseDiagnostics(),true);
 configureDiagnostics(false);
 assert.equal(discloseDiagnostics(),false,'collection toggle must preserve the original disclosure');
 assert.equal(diagnosticStatus().enabled,false);
 diagnosticEvent('navigation.opened',{source:'slash',data:{availableTargets:4}});
 assert.equal(readDiagnosticEvents({days:1}).length,0);
});
test('synthetic funnels report observed facts separately from hypotheses',()=>{
 const events=[
  {event:'launch.started',source:'slash',outcome:'unknown',data:{}},
  {event:'launch.approval',source:'slash',outcome:'cancelled',data:{}},
  {event:'launch.finished',source:'slash',outcome:'cancelled',data:{elapsedMs:1500}},
  {event:'navigation.opened',source:'slash',outcome:'unknown',data:{}},
  {event:'navigation.finished',source:'menu',outcome:'cancelled',data:{reason:'no_selection',elapsedMs:500}},
  {event:'switch.started',source:'menu',outcome:'unknown',data:{}},
  {event:'switch.finished',source:'menu',outcome:'failure',data:{}},
 ];
 const report=analyzeDiagnostics(events);
 assert.equal(report.metrics.delegation.cancellationPercent,100);
 assert.equal(report.metrics.navigation.noSelectionExitPercent,100);
 assert.equal(report.metrics.switching.failurePercent,100);
 assert.ok(report.facts.length>0 && report.hypotheses.length>0);
});
