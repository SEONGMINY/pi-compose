import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { DECISION_ENTRY, REVIEW_ENTRY, couldBeApproval, decisionId,
  textParts, containsSensitivePolicyText, branchDecisions, type PolicyDecision } from '../src/policy/decisions.ts';
import { makePolicySnapshot, writePolicySnapshot } from '../src/policy/store.ts';

const extraction = z.object({
  status: z.enum(['approved','not-a-decision','ambiguous']),
  sourceEntryId: z.string(),
  sourceQuote: z.string(),
  subject: z.string(),
  reason: z.string(),
  effective: z.enum(['now','next-task','stop']),
  supersedesId: z.string().nullable(),
});

/** Only current-branch user approvals have authority; assistant proposals do not. */
function mainOwner(ctx: ExtensionContext) {
  const owner=readAgentRelationship(ctx.sessionManager.getSessionId(),ctx.sessionManager.getEntries());
  return owner?.role==='main'?owner:undefined;
}
async function publishSnapshot(ctx:ExtensionContext):Promise<void>{
  const owner=mainOwner(ctx);
  if(!owner)return;
  const leaf=ctx.sessionManager.getLeafId();
  if(!leaf)return;
  const snapshot=makePolicySnapshot(owner.sessionId,owner.product,leaf,
    ctx.sessionManager.getBranch());
  await writePolicySnapshot(snapshot);
}

type Msg = {id:string;role:string;text:string};
function recentMessages(ctx:ExtensionContext):Msg[]{
  return ctx.sessionManager.getBranch().flatMap(e=>{
    if(e.type!=='message'||!['user','assistant'].includes(e.message.role))return [];
    const text=textParts(e.message.content).trim();
    return text?[{id:e.id,role:e.message.role,text}]:[];
  });
}

/**
 * Keep the reference for "B안" even when the proposal is older than the
 * most recent turns. This is lexical retrieval, not approval classification.
 */
export function selectApprovalEvidence(approval:Msg,earlier:readonly Msg[]):Msg[]{
  const selected=new Map<string,Msg>();
  const label=approval.text.match(/([A-Z가-힣])\s*안/i)?.[1];
  const option=label?new RegExp(label+'\\s*안','i'):undefined;
  if(option){
    for(const item of earlier.filter(x=>x.role==='assistant'&&option.test(x.text)).slice(-4)){
      const match=item.text.search(option);
      selected.set(item.id,{...item,text:item.text.slice(Math.max(0,match-250),match+2300)});
    }
  }
  for(const item of earlier.slice(-16))if(!selected.has(item.id)){
    selected.set(item.id,{...item,text:item.text.slice(0,1700)});
  }
  return [...selected.values()].sort((a,b)=>earlier.findIndex(x=>x.id===a.id)-
    earlier.findIndex(x=>x.id===b.id)).slice(-20);
}

/**
 * The lexical gate saves extra model calls on ordinary conversation.
 * The semantic check extracts a verbatim supporting quote, never an invented policy.
 */
async function inspectApproval(ctx:ExtensionContext, approval:Msg,
  earlier:readonly Msg[], active:readonly PolicyDecision[]):Promise<z.infer<typeof extraction>|undefined>{
  if(!ctx.model)return;
  const excerpts=[...selectApprovalEvidence(approval,earlier),approval].map(x=>({
    id:x.id,role:x.role,text:x.text.slice(0,2500),
  }));
  const reply=await ctx.modelRegistry.streamSimple(ctx.model,{
    systemPrompt:[
      'You are a strict parser of explicit USER policy decisions, NOT a policy maker.',
      'Use only the supplied chronological Main conversation excerpts.',
      'The final USER entry is the approval candidate. Other assistant text is proposals, not approval.',
      'Return approved ONLY if that user clearly decides, confirms, revises or stops a concrete policy or work constraint.',
      'A request to do ordinary coding work is NOT itself a newly approved policy.',
      'If the user says B option, find the exact earlier B option. Never guess what B stands for.',
      'For approved, sourceEntryId must be the ID of the entry containing the policy text;',
      'sourceQuote must be a verbatim contiguous substring of that entry giving the actual decision, not just the words B option.',
      'Do not include secret credentials. If no complete source quote, return ambiguous.',
      'If the user is evaluating possibilities or the referenced proposal is missing, return ambiguous or not-a-decision.',
      'Do not invent WHY; reason must be grounded by supplied text, otherwise empty.',
      'Use now unless the user specifically says next task; use stop only for an explicit stop instruction.',
      'activeDecisions are previously user-approved policies on this branch.',
      'When the approved change replaces a listed active policy, supersedesId must be the exact existing id.',
      'When no previous decision is replaced, supersedesId must be null.',
      'When replacement is obvious but the target cannot be identified, return ambiguous; never leave contradictory policies active.',
      'Output JSON only: {"status":"approved|not-a-decision|ambiguous","sourceEntryId":"...",',
      '"sourceQuote":"...","subject":"...","reason":"","effective":"now|next-task|stop","supersedesId":null}',
    ].join(' '),
    messages:[{role:'user',content:JSON.stringify({approvalEntryId:approval.id,excerpts,
      activeDecisions:active.map(d=>({id:d.id,subject:d.subject,decision:d.decision.slice(0,650)}))}),
      timestamp:Date.now()}],
  },{reasoning:'low',maxTokens:1100,signal:AbortSignal.timeout(25000)}).result();
  if(reply.stopReason!=='stop')throw Error('policy-extraction-model-incomplete');
  const raw=textParts(reply.content).trim().replace(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i,'$1');
  return extraction.parse(JSON.parse(raw));
}

export function registerPolicyMain(pi:ExtensionAPI):void{
  // Never mutate the original Pi JSONL outside the owning live Pi API.
  let publishing=Promise.resolve();
  const queuePublish=(ctx:ExtensionContext)=>{
    publishing=publishing.catch(()=>{}).then(async()=>{
      if(!mainOwner(ctx))return;
      try{await publishSnapshot(ctx);}
      catch(error){if(ctx.hasUI)ctx.ui.notify('정책 변경 인덱스 저장 실패: '+String(error),'warning');}
    });
  };
  let inspecting=false;
  async function inspect(ctx:ExtensionContext):Promise<void>{
    if(!mainOwner(ctx)){queuePublish(ctx);return;}
    if(inspecting){queuePublish(ctx);return;}
    inspecting=true;
    try{
      const all=recentMessages(ctx);
      const branch=ctx.sessionManager.getBranch();
      const active=branchDecisions(branch,ctx.sessionManager.getSessionId());
      const inspected=new Set(branch.flatMap(e=>
        e.type==='custom'&&e.customType===REVIEW_ENTRY &&
        e.data&&typeof e.data==='object'&&'approvalEntryId' in e.data &&
        typeof e.data.approvalEntryId==='string'?[e.data.approvalEntryId]:[]));
      // Recover previously missed explicit approvals on restart, bounded per settle.
      const candidates=all.filter(x=>x.role==='user'&&!inspected.has(x.id)&&couldBeApproval(x.text));
      for(const approval of candidates.slice(-3)){
        const owner=mainOwner(ctx);
        if(!owner||!ctx.isIdle())break;
        const startLeaf=ctx.sessionManager.getLeafId();
        const index=all.findIndex(x=>x.id===approval.id);
        const earlier=all.slice(0,index);
        try{
          const parsed=await inspectApproval(ctx,approval,earlier,active);
          if(!parsed)break;
          if(ctx.sessionManager.getLeafId()!==startLeaf||!ctx.isIdle())break;
          let record:PolicyDecision|undefined;
          if(parsed.status==='approved'){
            const source=[...earlier,approval].find(x=>x.id===parsed.sourceEntryId);
            const quote=parsed.sourceQuote.trim();
            const text=approval.text;
            const pointer=/(?:[A-Z가-힣]\s*안(?:으로|을|이|은|에|$|\s)|\boption\s+[A-Z]\b)/i.test(text);
            const validSupersession=parsed.supersedesId===null ||
              active.some(d=>d.id===parsed.supersedesId);
            const overlapping=active.some(d=>d.subject===parsed.subject);
            // A broad stop impacts every sibling Work. Only publish it when
            // the user's exact instruction explicitly names that broad scope.
            const broadStop=parsed.effective!=='stop'||
              /(?:모든|전체|전부)\s*(?:Work|워크|에이전트)|(?:all|every)\s+(?:Work|workers|agents)/i.test(text);
            const validSource=broadStop && validSupersession &&
              (!overlapping || parsed.supersedesId!==null) &&
              quote.length<=1600 && approval.text.length<=1200 &&
              source && quote.length>=10 &&
              source.text.includes(quote) &&
              (!pointer || source.id!==approval.id);
            if(validSource && !containsSensitivePolicyText(quote) &&
               !containsSensitivePolicyText(approval.text)){
              record={
                id:decisionId(owner.sessionId,approval.id,source.id,quote),
                mainSessionId:owner.sessionId,approvalEntryId:approval.id,
                sourceEntryId:source.id,approvalQuote:approval.text.slice(0,1200),
                sourceQuote:quote.slice(0,1600),
                subject:parsed.subject.slice(0,140)||'Main 확정 결정',
                decision:quote.slice(0,1600),
                reason:parsed.reason && [...earlier,approval].some(x=>x.text.includes(parsed.reason))
                  ?parsed.reason.slice(0,800):'',
                scope:'owner-main',targetWorkIds:[],effective:parsed.effective,
                ...(parsed.supersedesId?{supersedesId:parsed.supersedesId}:{}),
              };
            }
          }
          if(record){
            // Idempotent across recovery and multiple extension callbacks.
            if(!ctx.sessionManager.getBranch().some(e=>e.type==='custom' &&
                e.customType===DECISION_ENTRY && (e.data as {id?:string})?.id===record.id)){
              pi.appendEntry(DECISION_ENTRY,record);
              active.splice(0,active.length,...active.filter(d=>d.id!==record.supersedesId),record);
              if(ctx.hasUI)ctx.ui.notify('확정된 Main 결정이 Work 동기화 기록에 반영됐습니다.','info');
            }
          }else if(parsed.status==='ambiguous'||parsed.status==='approved'){
            if(ctx.hasUI)ctx.ui.notify(
              '정책 결정의 정확한 대상·원문을 확인하지 못해 자동 전파하지 않았습니다. Main에서 명확히 결정해 주세요.',
              'warning');
          }
          pi.appendEntry(REVIEW_ENTRY,{approvalEntryId:approval.id,
            status:record?'published':parsed.status==='not-a-decision'?'ignored':'ambiguous'});
        }catch(error){
          if(ctx.hasUI)ctx.ui.notify(
            '자동 정책 결정 확인 실패 (전파하지 않음, 다음 실행에 재시도): '+String(error),'warning');
          break;
        }
      }
    }finally{
      inspecting=false;
      queuePublish(ctx);
    }
  }
  // Recovery scans only uninspected explicit approval candidates on the active
  // branch. It does not require the user to repeat a policy registration.
  pi.on('session_start',(_event,ctx)=>{
    queuePublish(ctx);
    if(ctx.isIdle())void inspect(ctx).catch(error=>{
      if(ctx.hasUI)ctx.ui.notify('정책 결정 재조회 실패: '+String(error),'warning');
    });
  });
  pi.on('session_tree',(_event,ctx)=>{
    queuePublish(ctx);
    if(ctx.isIdle())void inspect(ctx).catch(error=>{
      if(ctx.hasUI)ctx.ui.notify('정책 결정 재조회 실패: '+String(error),'warning');
    });
  });
  pi.on('agent_settled',async(event,ctx)=>{
    if(event.aborted){queuePublish(ctx);return;}
    await inspect(ctx);
  });
}
