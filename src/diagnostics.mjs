import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const SCHEMA_VERSION = 1;
const VALID = new Set([
  'setup.started','setup.component','setup.finished','setup.hook_prompted',
  'command.entered','command.invalid','command.finished',
  'launch.started','launch.approval','launch.finished','launch.agent_linked',
  'navigation.opened','navigation.selected','navigation.finished','navigation.detail',
  'switch.started','switch.finished','sessions.opened','sessions.finished',
  'handoff.started','handoff.finished','verify.started','verify.finished',
  'result.opened','result.unavailable'
]);
const SOURCES = new Set(['slash','natural-language','menu','automatic','cli','unknown']);
const OUTCOMES = new Set(['success','failure','cancelled','unavailable','unknown']);
const SAFE_KEYS = new Set([
  'action','route','reason','screen','context','workspace','from','to','kind',
  'availableTargets','choiceCount','selectionCount','elapsedMs','stepCount',
  'attempt','linked','hasResult','configured','component','status'
]);
const ENUM = new Set(['action','route','reason','screen','context','workspace','from','to','kind','component','status']);
const token = /^[a-z][a-z0-9_.-]{0,50}$/;
const runId = randomUUID();
const maxBytes=2*1024*1024;
const retentionDays=14;
const agentDir = () => {
  const value=process.env.PI_CODING_AGENT_DIR;
  return resolve(value?.startsWith('~/')?join(homedir(),value.slice(2)):value||join(homedir(),'.pi','agent'));
};
export const diagnosticsDir = () => join(agentDir(),'compose','diagnostics');
const preferencesFile = () => join(diagnosticsDir(),'settings.json');
function secureDir() { const dir=diagnosticsDir(); mkdirSync(dir,{recursive:true,mode:0o700}); chmodSync(dir,0o700); return dir; }
function settings() {
  try { const cfg=JSON.parse(readFileSync(preferencesFile(),'utf8')); return cfg && typeof cfg==='object'?cfg:{}; }
  catch { return {}; }
}
export function diagnosticStatus() { return { enabled:process.env.PIC_DIAGNOSTICS!=='0'&&settings().enabled!==false,dir:diagnosticsDir(),retentionDays,maxBytes}; }
export function diagnosticEnabled() {return diagnosticStatus().enabled;}
export function configureDiagnostics(enabled) {
  const dir=secureDir(); const temp=join(dir,'.prefs-'+randomUUID());
  writeFileSync(temp,JSON.stringify({enabled:!!enabled})+'\n',{mode:0o600,flag:'wx'});
  renameSync(temp,preferencesFile()); chmodSync(preferencesFile(),0o600);
}
function safeData(data) {
  const result={};
  if(!data||typeof data!=='object')return result;
  for(const [k,v] of Object.entries(data)) {
    if(!SAFE_KEYS.has(k))continue;
    if((k==='availableTargets'||k==='choiceCount'||k==='selectionCount'||k==='elapsedMs'||k==='stepCount'||k==='attempt')
      &&typeof v==='number'&&Number.isFinite(v)) {result[k]=Math.min(86_400_000,Math.max(0,Math.round(v)));continue;}
    if(k==='linked'||k==='hasResult'||k==='configured') { if(typeof v==='boolean')result[k]=v;continue; }
    if(ENUM.has(k)&&typeof v==='string'&&token.test(v)) result[k]=v;
  }
  return result;
}
function retention() {
  const dir=diagnosticsDir(); if(!existsSync(dir))return;
  const cutoff=Date.now()-retentionDays*86400_000;
  for(const name of readdirSync(dir)) {
    if(!/^events-\d{4}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/.test(name))continue;
    try {if(statSync(join(dir,name)).mtimeMs<cutoff)unlinkSync(join(dir,name));}catch{}
  }
}
function fileName(date) {return 'events-'+date.toISOString().slice(0,10)+'.jsonl';}
function eventPath() {
  const dir=secureDir(); const date=new Date();
  const path=join(dir,fileName(date));
  try {if(statSync(path).size>=maxBytes)return join(dir,'events-'+date.toISOString().slice(0,10)+'-'+Math.floor(Date.now()/1000)+'.jsonl');}catch{}
  return path;
}
function safeId(value) {
  if(value===undefined||value===null||value==='')return undefined;
  // IDs never leave this process as raw Pi IDs, names, branch refs or paths.
  // The per-install secret lets journeys be correlated without exposing values.
  const keyPath=join(secureDir(),'identity.key');
  let key;
  try { key=readFileSync(keyPath); }
  catch { key=randomBytes(32); try {writeFileSync(keyPath,key,{mode:0o600,flag:'wx'});}catch{ key=readFileSync(keyPath); } }
  return createHmac('sha256',key).update(String(value)).digest('hex').slice(0,20);
}
/**
 * No arbitrary strings, prompts, tool payloads, paths, tmux IDs, project names or
 * session IDs enter the event file. All data keys and category values are allowlisted.
 */
export function diagnosticEvent(event,{source='unknown',flowId,run=runId,outcome='unknown',data={},taskId,sessionId,projectId}={}) {
  if(!diagnosticEnabled()||!VALID.has(event))return;
  try {
    const row={
      schemaVersion:SCHEMA_VERSION,timestamp:new Date().toISOString(),
      runId:run,flowId:flowId||randomUUID(),event,
      source:SOURCES.has(source)?source:'unknown',
      outcome:OUTCOMES.has(outcome)?outcome:'unknown',
      data:safeData(data),
      ...(safeId(taskId)?{taskKey:safeId(taskId)}:{}),
      ...(safeId(sessionId)?{sessionKey:safeId(sessionId)}:{}),
      ...(safeId(projectId)?{projectKey:safeId(projectId)}:{})
    };
    const path=eventPath();
    appendFileSync(path,JSON.stringify(row)+'\n',{mode:0o600,flag:'a'});
    retention();
  }catch{/* Diagnostics are best-effort and may never block launching an agent. */}
}
export function startFlow(event,details={}) {
  const flowId=randomUUID();const started=Date.now();
  diagnosticEvent(event,{...details,flowId});
  return {flowId,started};
}
export function finishFlow(flow,event,details={}) {
  diagnosticEvent(event,{...details,flowId:flow?.flowId, data:{...details.data,elapsedMs:flow?Date.now()-flow.started:0}});
}
export function diagnosticFlowId() {return randomUUID();}
/** Bounded, schema-validated reader. Never follow file names other than events-*.jsonl */
export function readDiagnosticEvents({days=7}={}) {
  const span=Math.min(30,Math.max(1,Math.floor(Number(days)||7)));
  const dir=diagnosticsDir();if(!existsSync(dir))return [];
  const cutoff=Date.now()-span*86400_000;const rows=[];
  const names=readdirSync(dir).filter(n=>/^events-\d{4}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/.test(n)).sort();
  for(const name of names) {
    try {
      if(statSync(join(dir,name)).mtimeMs<cutoff)continue;
      for(const line of readFileSync(join(dir,name),'utf8').split('\n')) {
        if(rows.length>=20000)break;
        if(!line||line.length>2500)continue;
        const row=JSON.parse(line);
        if(row?.schemaVersion!==1||!VALID.has(row.event)||!SOURCES.has(row.source)||!OUTCOMES.has(row.outcome)||Number.isNaN(Date.parse(row.timestamp)))continue;
        if(Date.parse(row.timestamp)<cutoff)continue;
        rows.push({schemaVersion:1,timestamp:row.timestamp,runId:typeof row.runId==='string'&&/^[0-9a-f-]{36}$/.test(row.runId)?row.runId:'',
          flowId:typeof row.flowId==='string'&&/^[0-9a-f-]{36}$/.test(row.flowId)?row.flowId:'',event:row.event,source:row.source,outcome:row.outcome,
          data:safeData(row.data),...(typeof row.taskKey==='string'?{taskKey:row.taskKey}:{}),
          ...(typeof row.sessionKey==='string'?{sessionKey:row.sessionKey}:{}),
          ...(typeof row.projectKey==='string'?{projectKey:row.projectKey}:{})});
      }
    }catch{}
  }
  return rows.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
}
const rate=(n,d)=>d?Number((n/d*100).toFixed(1)):null;
const count=(rows,event,outcome)=>rows.filter(x=>x.event===event&&(!outcome||x.outcome===outcome)).length;
const percentile=(xs,q)=>xs.length?xs.sort((a,b)=>a-b)[Math.min(xs.length-1,Math.ceil(xs.length*q)-1)]:null;
export function analyzeDiagnostics(events) {
  const byEvent=Object.fromEntries([...new Set(events.map(e=>e.event))].sort().map(k=>[k,events.filter(e=>e.event===k).length]));
  const durations=(event)=>events.filter(e=>e.event===event&&e.data?.elapsedMs!==undefined).map(e=>e.data.elapsedMs);
  const launchStarted=count(events,'launch.started'),launchSuccess=count(events,'launch.finished','success');
  const navOpen=count(events,'navigation.opened'),navCancel=events.filter(e=>e.event==='navigation.finished'&&e.outcome==='cancelled'&&e.data?.reason==='no_selection').length;
  const navSelected=count(events,'navigation.selected'),switchReq=count(events,'switch.started'),switchOk=count(events,'switch.finished','success');
  const sessionsOpen=count(events,'sessions.opened'),sessionsOk=count(events,'sessions.finished','success');
  const handoff=count(events,'handoff.finished','success'),verify=count(events,'verify.finished','success');
  const observed=events.length>0;
  return {
    schemaVersion:1,observedEvents:events.length,byEvent,
    metrics:{
      delegation:{started:launchStarted,dispatchSucceeded:launchSuccess,dispatchSuccessPercent:rate(launchSuccess,launchStarted),
        childPiLinked:count(events,'launch.agent_linked','success'),
        cancellationPercent:rate(count(events,'launch.finished','cancelled'),launchStarted),
        failures:count(events,'launch.finished','failure'),
        durationMsP50:percentile(durations('launch.finished'),.5),
        durationMsP90:percentile(durations('launch.finished'),.9)},
      navigation:{opened:navOpen,selected:navSelected,noSelectionExitPercent:rate(navCancel,navOpen),
        selectedToOpenPercent:rate(navSelected,navOpen),durationMsP50:percentile(durations('navigation.finished'),.5)},
      switching:{started:switchReq,completed:switchOk,failurePercent:rate(count(events,'switch.finished','failure'),switchReq)},
      sessions:{opened:sessionsOpen,completed:sessionsOk,successPercent:rate(sessionsOk,sessionsOpen)},
      result:{handoffCreated:handoff,verifyExecuted:verify,reportOpened:count(events,'result.opened')},
      commands:{routes:Object.fromEntries([...new Set(events.filter(e=>e.event==='command.entered').map(e=>e.data?.route))].filter(Boolean).map(r=>[r,events.filter(e=>e.event==='command.entered'&&e.data?.route===r).length])),invalid:count(events,'command.invalid')},
      setup:{attempts:count(events,'setup.started'),failures:count(events,'setup.finished','failure'),
        missingComponents:count(events,'setup.component','unavailable')}
    },
    facts:observed?[
      'Counts and durations include only instrumented Compose commands/tools in the selected time range.',
      'Missing events do not prove the user did not notice or need a feature.',
      'Successful launch dispatch is not evidence of a running Pi session; childPiLinked is a distinct observation.',
    ]:['No recorded events in the selected period. Metrics are not interpretable.'],
    hypotheses:observed?[
      'Frequent cancelled navigation might indicate poor discoverability OR harmless inspection; correlate with follow-up actions.',
      'Repeated launch cancellations might indicate confusing choices OR intentional safety checks.',
      'A fast reverse switch could indicate misnavigation OR deliberate comparison; requires actual paired switch events.',
    ]:[],
    limitations:[
      'Commands unknown to Pi Compose cannot be counted. Command non-use is not command unawareness.',
      'Cannot observe attention, reading, task intent, external terminal/project switching, Git merge, or workmux internal navigation.',
      'A launched tmux process does not prove that its Pi model ran or that implementation completed.',
      'No automatic comparison to Claude Code or other products without equivalent instrumented events.',
    ]
  };
}
export function exportDiagnostics({days=7,output}={}) {
  const events=readDiagnosticEvents({days});
  const report={kind:'pi-compose-ux-diagnostics',schemaVersion:1,generatedAt:new Date().toISOString(),
    periodDays:Math.min(30,Math.max(1,Number(days)||7)),summary:analyzeDiagnostics(events),events};
  if(output) {
    const dest=resolve(output);const parent=dirname(dest);
    if(!existsSync(parent))throw new Error('Output directory does not exist: '+parent);
    writeFileSync(dest,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
    return {path:dest,report};
  }
  return {report};
}
export function clearDiagnostics() {
  const dir=diagnosticsDir();if(!existsSync(dir))return 0;let n=0;
  for(const file of readdirSync(dir)) {
    if(/^events-\d{4}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/.test(file)) {
      try{unlinkSync(join(dir,file));n++;}catch{}
    }
  }
  const exported=join(dir,'exports');
  if(existsSync(exported))for(const file of readdirSync(exported)) {
    if(/^pi-compose-ux-[0-9TZ.-]+\.json$/.test(file)) {try{unlinkSync(join(exported,file));n++;}catch{}}
  }
  return n;
}
