import { constants } from 'node:fs';
import { mkdir, lstat, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type HandoffMetric={
  stage:'work-prepare'|'main-compare';
  outcome:'ok'|'fallback'|'unavailable'|'cache-hit'|'error';
  durationMs:number;
  modelId?:string;
  inputTokens?:number;
  outputTokens?:number;
  cacheReadTokens?:number;
  cacheWriteTokens?:number;
  totalTokens?:number;
  providerCostUsd?:number;
};
export type MetricSink=(metric:HandoffMetric)=>Promise<void>;

/** Report only REAL provider usage, never inferred tokens or fabricated costs. */
export function measuredHandoffCall(
  stage:HandoffMetric['stage'],outcome:HandoffMetric['outcome'],
  startMs:number,modelId:string|undefined,
  response?:unknown,
):HandoffMetric {
  const durationMs=Math.max(0,Math.round(performance.now()-startMs));
  const metric:HandoffMetric={stage,outcome,durationMs,...(modelId?{modelId}:{})};
  if(!response||typeof response!=='object'||!('usage' in response))return metric;
  const usage=response.usage;
  if(!usage||typeof usage!=='object')return metric;
  const fields=[
    ['input','inputTokens'],['output','outputTokens'],
    ['cacheRead','cacheReadTokens'],['cacheWrite','cacheWriteTokens'],
    ['totalTokens','totalTokens'],
  ] as const;
  for(const [from,to] of fields){
    const value=(usage as Record<string,unknown>)[from];
    if(typeof value==='number'&&Number.isFinite(value)&&value>=0)
      (metric as unknown as Record<string,unknown>)[to]=value;
  }
  const cost=(usage as {cost?:{total?:unknown}}).cost?.total;
  if(typeof cost==='number'&&Number.isFinite(cost)&&cost>=0)
    metric.providerCostUsd=cost;
  return metric;
}

/**
 * Local, append-only metrics. No prompts, quotes, evidence or session names.
 * A write failure is non-fatal and is NOT reported as successful telemetry.
 * The log is outside Pi's conversation tree and never changes its leaf.
 */
export async function recordHandoffMetric(metric:HandoffMetric):Promise<void> {
  const home=await realpath(homedir());
  const pi=join(home,'.pi');
  const compose=join(pi,'compose');
  for(const dir of [pi,compose]){
    await mkdir(dir,{recursive:true,mode:0o700});
    const stat=await lstat(dir);
    if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||
       (typeof process.getuid==='function'&&stat.uid!==process.getuid()))
      throw Error('unsafe-handoff-metrics-directory');
  }
  const path=join(compose,'handoff-cost-metrics.jsonl');
  const handle=await open(path,constants.O_WRONLY|constants.O_APPEND|
    constants.O_CREAT|constants.O_NOFOLLOW,0o600);
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||(stat.mode&0o077)!==0||
       (typeof process.getuid==='function'&&stat.uid!==process.getuid()))
      throw Error('unsafe-handoff-metrics-file');
    const line=JSON.stringify({at:new Date().toISOString(),...metric})+'\n';
    await handle.write(Buffer.from(line,'utf8'));
  }finally{
    await handle.close();
  }
}
