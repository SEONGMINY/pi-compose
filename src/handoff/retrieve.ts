/**
 * Source selection for a long Work Fork branch.
 *
 * Do not assume the latest N entries contain the defining requirements.
 * Choose relevant source records from the entire active ancestry, retain
 * early user decisions as anchors, and include recent changes. Returning
 * bounded contiguous excerpts avoids sending the full conversation to
 * another model while retaining exact original quotes for verification.
 */
export type HistorySource = {
  id: string;
  role: 'user' | 'assistant' | 'toolResult';
  text: string;
};
export type HistoryExcerpt = HistorySource & { order: number };

function terms(source: string): string[] {
  return [...new Set(source.toLocaleLowerCase()
    .match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])]
    .filter(term => !/^(the|and|for|with|that|from|this|have|only|source|work|main|report|unknown|reported)$/.test(term))
    .sort((a,b) => b.length-a.length);
}
function score(text: string, termsList: string[]): number {
  const lower=text.toLocaleLowerCase();
  return termsList.reduce((sum,term)=>sum+(lower.includes(term)?1:0),0);
}
function excerpt(text:string, termsList:string[], maxLength:number): string {
  if(text.length<=maxLength)return text;
  const lower=text.toLocaleLowerCase();
  let bestIndex=-1, longest=0;
  for(const term of termsList){
    const at=lower.indexOf(term);
    if(at!==-1&&term.length>longest){bestIndex=at;longest=term.length;}
  }
  // Source is still one contiguous substring, so the model cannot
  // accidentally quote across two fragments of unrelated source text.
  const start=Math.max(0,Math.min(text.length-maxLength,
    bestIndex<0?0:bestIndex-Math.floor(maxLength/4)));
  return text.slice(start,start+maxLength);
}

/**
 * Returns at most limit chronological entries, not a synthetic new history.
 * Mandatory early user anchors consume a bounded budget, and lexical ranking
 * is only a retrieval heuristic (not proof of relevance or completeness).
 */
export function selectForkHistory(
  history:readonly HistorySource[], focus:string,
  limit=36, maxExcerpt=1600,
):HistoryExcerpt[] {
  if(!Number.isSafeInteger(limit)||limit<1||maxExcerpt<1)throw Error('invalid-history-budget');
  const query=terms(focus).slice(0,90);
  const all=history.filter(item=>item.text.trim()).map((item,order)=>({
    ...item,order,weight:score(item.text,query),
  }));
  if(all.length<=limit)return all.map(({weight,...item})=>({
    ...item,text:excerpt(item.text,query,maxExcerpt),
  }));
  const chosen=new Map<number,(typeof all)[number]>();
  const firstUser=all.filter(item=>item.role==='user').slice(0,Math.min(5,Math.floor(limit/4)));
  const recent=all.slice(-Math.min(7,Math.floor(limit/4)));
  for(const item of [...firstUser,...recent])chosen.set(item.order,item);
  const ranked=[...all].sort((a,b)=>b.weight-a.weight||b.order-a.order);
  for(const item of ranked){
    if(chosen.size>=limit)break;
    chosen.set(item.order,item);
  }
  return [...chosen.values()].sort((a,b)=>a.order-b.order)
    .map(({weight,...item})=>({...item,text:excerpt(item.text,query,maxExcerpt)}));
}
