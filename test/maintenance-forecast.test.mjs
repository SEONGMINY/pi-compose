import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { suggestForecast, suggestHistoricalForecast } from '../maintenance/forecast.mjs';
import { startTask, finishTask, listTasks } from '../maintenance/core.mjs';

const q={minutes:{p30:2,p50:4,p80:6},tokens:{p30:50,p50:90,p80:110}};
const item=(n,kind='bug',env='pi',basis='wall-clock',tokens=n*10)=>({
  state:'completed',kind,environment:env,measurement:{elapsedMs:n*60_000,elapsedBasis:basis,
    tokens:tokens==null?null:{totalTokens:tokens,coverage:'registered-sources-only'}}});

test('cohort quantiles only compare the same type, environment and accounting basis',()=>{
  const tasks=Array.from({length:10},(_,i)=>item(i+1));
  tasks.push(item(1000,'feature'),item(1000,'bug','chatgpt'),item(1000,'bug','pi','runner-monotonic'));
  const r=suggestForecast(tasks,{kind:'bug',environment:'pi'});
  assert.equal(r.ready,true);
  assert.deepEqual(r.forecast.minutes,{p30:3,p50:5,p80:8});
  assert.deepEqual(r.forecast.tokens,{p30:30,p50:50,p80:80});
  assert.equal(r.sampleCount.cohort,10);
  assert.equal(r.probabilityCalibration,'not-verified');
  assert.match(r.tokenCoverage,/may underestimate/);
});

test('incomplete and failed evidence never produces invented forecasts',()=>{
  const tasks=Array.from({length:10},(_,i)=>item(i+1,'bug','pi','wall-clock',i>3?null:100));
  tasks.push({...item(100),state:'failed'});
  const r=suggestForecast(tasks,{kind:'bug',environment:'pi'});
  assert.equal(r.ready,false);
  assert.deepEqual(r.missing,['tokens']);
  assert.equal(r.forecast,null);
  assert.deepEqual(r.sampleCount,{cohort:10,minutes:10,tokens:4});
});

test('a low-sample cohort is unavailable and validation rejects ambiguous requests',()=>{
  assert.equal(suggestForecast([item(1)],{kind:'bug',environment:'pi'}).ready,false);
  assert.throws(()=>suggestForecast([],{kind:'bug'}),/explicit/);
  assert.throws(()=>suggestForecast([],{kind:'bug',environment:'pi',minSamples:1}),/minSamples/);
});

test('historical start freezes sample basis and quantiles at the moment of start',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'maintenance-forecast-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  for(let i=1;i<=8;i++) {
    const task=await startTask({dir,title:`History ${i}`,kind:'bug',environment:'pi',forecast:q});
    await finishTask({dir,id:task.id,elapsedMs:i*60_000});
  }
  // This sample has no token evidence; only a manual forecast is allowed.
  assert.deepEqual((await suggestHistoricalForecast(dir,{kind:'bug',environment:'pi',elapsedBasis:'runner-monotonic'})).missing,['tokens']);
  const cli=new URL('../maintenance/cli.mjs',import.meta.url).pathname;
  const bad=spawnSync(process.execPath,[cli,'start','--title','No guess','--kind','bug',
    '--environment','pi','--historical','--elapsed-basis','runner-monotonic','--data-dir',dir],{encoding:'utf8'});
  assert.notEqual(bad.status,0);
  assert.match(bad.stderr,/Insufficient comparable history/);
});

test('CLI historical start records immutable quantiles and provenance when evidence is sufficient',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'maintenance-history-ready-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  for(let i=1;i<=8;i++) {
    const session=join(dir,`session-${i}.jsonl`);
    await writeFile(session,'');
    const task=await startTask({dir,title:`Completed ${i}`,kind:'feature',environment:'pi',sessions:[session],forecast:q});
    await appendFile(session,JSON.stringify({type:'message',message:{role:'assistant',usage:{input:10*i,output:10*i,totalTokens:20*i}}})+'\n');
    await finishTask({dir,id:task.id,elapsedMs:60_000*i});
  }
  const result=suggestForecast(await listTasks(dir),
    {kind:'feature',environment:'pi',elapsedBasis:'runner-monotonic'});
  assert.equal(result.ready,true);
  assert.deepEqual(result.forecast.minutes,{p30:3,p50:4,p80:7});
  assert.deepEqual(result.forecast.tokens,{p30:60,p50:80,p80:140});
  const cli=new URL('../maintenance/cli.mjs',import.meta.url).pathname;
  const raw=execFileSync(process.execPath,[cli,'start','--title','New task','--kind','feature',
    '--environment','pi','--historical','--elapsed-basis','runner-monotonic','--data-dir',dir],{encoding:'utf8'});
  const next=JSON.parse(raw);
  assert.deepEqual(next.forecast,result.forecast);
  assert.equal(next.forecastProvenance.source,'historical');
  assert.equal(next.forecastProvenance.basis.counts.tokens,8);
  assert.equal(next.forecastProvenance.basis.calibration,'not-verified');
});
