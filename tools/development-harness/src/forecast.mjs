const levels=['p30','p50','p80'];
function validTriplet(obj){return obj && levels.every((k,i)=>Number.isFinite(obj[k])&&obj[k]>=0&&(i===0||obj[levels[i-1]]<=obj[k]));}
export function chooseForecast(tasks, {agent,kind,seed}){
  const records=Object.values(tasks).filter(t=>['completed','delivered-unverified'].includes(t.status)&&t.agent===agent&&t.kind===kind&&t.actual?.activeMinutes!=null);
  const times=records.map(t=>t.actual.activeMinutes).filter(Number.isFinite);
  // Only observed, non-missing event receipts enter the token cohort. Even these
  // are provider-observed lower bounds, not independently audited invoice totals.
  const tokens=records.filter(t=>t.actual.coverage==='observed-hooks-only' &&
    t.tokenUsage?.missingEvents===0).map(t=>t.actual.tokens).filter(Number.isFinite);
  if(times.length>=8 && tokens.length>=8){
    const quantile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
    const triplet=vals=>Object.fromEntries(levels.map((k,i)=>[k,Math.ceil(quantile(vals,[.3,.5,.8][i]))]));
    return {minutes:triplet(times),tokens:triplet(tokens),provenance:'historical-delivery-observed',
      sampleBasis:'technical-delivery; functional-AC may be unverified; tokens are provider-observed lower bounds',
      calibrated:false,samples:{time:times.length,tokens:tokens.length}};
  }
  if(seed && validTriplet(seed.minutes)&&validTriplet(seed.tokens))
    return {...structuredClone(seed),provenance:'configured-uncalibrated-prior',calibrated:false,samples:{time:times.length,tokens:tokens.length}};
  // Never invent P30/P50/P80. A missing estimate is an observable setup gap.
  return {minutes:null,tokens:null,provenance:'unavailable',calibrated:false,samples:{time:times.length,tokens:tokens.length}};
}
