import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { DECISION_ENTRY, REVIEW_ENTRY, couldBeApproval, decisionId,
  textParts, containsSensitivePolicyText, branchDecisions,
  selfContainedApprovedPolicyQuote, type PolicyDecision } from '../src/policy/decisions.ts';
import { makePolicySnapshot, writePolicySnapshot } from '../src/policy/store.ts';
import { latestPolicyReviews, resolvedApprovalIds, hasBeenInspected,
  POLICY_REVIEW_VERSION } from '../src/policy/reviews.ts';

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
  const branch=ctx.sessionManager.getBranch();
  const reviewed=resolvedApprovalIds(branch);
  const unresolved=recentMessages(ctx).filter(x=>x.role==='user' &&
    couldBeApproval(x.text)&&!reviewed.has(x.id)).map(x=>x.id);
  const snapshot=makePolicySnapshot(owner.sessionId,owner.product,leaf,
    branch,unresolved);
  await writePolicySnapshot(snapshot);
}

type Msg = {id:string;role:string;text:string};
export function recentMessages(ctx:ExtensionContext):Msg[]{
  // Pi projection follows active Compaction and ContextEdit. An edited-away
  // or compacted option must not be silently revived as a new user policy.
  return ctx.sessionManager.buildSessionProjection().entries.flatMap(projected=>{
    const source=projected.sourceEntry;
    if(source.type!=='message')return [];
    const message=source.message;
    // AgentMessage also contains BashExecutionMessage and other non-chat
    // variants that do not expose content. Narrow by the role discriminator.
    if(message.role!=='user'&&message.role!=='assistant')return [];
    const original=textParts(message.content).trim();
    const visible=projected.messages.flatMap(m=>{
      if(m.role!=='user'&&m.role!=='assistant')return [];
      if(m.role!==message.role)return [];
      return [textParts(m.content).trim()];
    });
    // Do not attribute a rewritten ContextEdit fragment to the original quote.
    if(!original||visible.length!==1||visible[0]!==original)return [];
    return [{id:source.id,role:message.role,text:original}];
  });
}

/**
 * Keep the reference for "B안" even when the proposal is older than the
 * most recent turns. This is lexical retrieval, not approval classification.
 */

/** A source may be the approving user when their message states the full rule. */
export function resolveApprovedSource(
  approval:Msg, earlier:readonly Msg[], sourceEntryId:string, sourceQuote:string,
):{source:Msg;quote:string}|undefined{
  const quote=sourceQuote.trim();
  const source=[...earlier,approval].find(x=>x.id===sourceEntryId);
  const selfContained=selfContainedApprovedPolicyQuote(approval.text);
  const reference=/(?:[A-Z가-힣]\s*안(?:으로|을|이|은|에|$|\s)|\boption\s+[A-Z]\b)/i.test(approval.text);
  // The user's explicit, complete rule outranks an earlier assistant option.
  // A revised B option must not silently revert to the older proposed wording.
  if(reference&&selfContained)return {source:approval,quote:selfContained};
  if(source&&quote.length>=10&&quote.length<=1600&&source.text.includes(quote)){
    if(source.id!==approval.id||!reference)return {source,quote};
  }
  if(selfContained)return {source:approval,quote:selfContained};
}

/** Deterministic recovery for explicit USER approvals with full policy wording. */
export function explicitApprovalFallback(
  approval:Msg,active:readonly PolicyDecision[],
):z.infer<typeof extraction>|undefined{
  const quote=selfContainedApprovedPolicyQuote(approval.text);
  if(!quote)return;
  const subject=quote.match(/^(.{2,80}?)(?:은|는|:)/)?.[1]?.trim()||'사용자 확정 정책';
  // Do not blindly replace an already-approved policy in the same subject.
  if(active.some(d=>d.subject===subject))return;
  return {status:'approved',sourceEntryId:approval.id,sourceQuote:quote,
    subject,reason:'',effective:'now',supersedesId:null};
}

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
      'If the user says B option, find the earlier B option where available. Never guess what B stands for.',
      'If the approving USER explicitly restates the full policy after B option, the USER entry itself is a valid source. Return its exact literal policy sentence as sourceQuote and approvalEntryId as sourceEntryId.',
      'Choosing documentation instead of code implementation through ask_user is a delivery-mode choice, not a new product policy and does not revoke the previously approved policy.',
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

export function registerPolicyMain(pi:ExtensionAPI):{
  openReview:(ctx:ExtensionContext)=>Promise<void>;
}{
  // Never mutate the original Pi JSONL outside the owning live Pi API.
  let publishing=Promise.resolve();
  const queuePublish=(ctx:ExtensionContext)=>{
    publishing=publishing.catch(()=>{}).then(async()=>{
      if(!mainOwner(ctx))return;
      try{await publishSnapshot(ctx);}
      catch(error){if(ctx.hasUI)ctx.ui.notify('정책 변경 인덱스 저장 실패: '+String(error),'warning');}
    });
  };
  const REVIEW_VERSION=POLICY_REVIEW_VERSION;
  let inspecting=false;
  async function inspect(ctx:ExtensionContext):Promise<void>{
    if(!mainOwner(ctx)){queuePublish(ctx);return;}
    if(inspecting){queuePublish(ctx);return;}
    inspecting=true;
    try{
      const all=recentMessages(ctx);
      const branch=ctx.sessionManager.getBranch();
      const active=branchDecisions(branch,ctx.sessionManager.getSessionId());
      const inspected=new Set([...latestPolicyReviews(branch)]
        .filter(([,record])=>hasBeenInspected(record,REVIEW_VERSION))
        .map(([id])=>id));
      // Recover previously missed explicit approvals on restart, bounded per settle.
      const candidates=all.filter(x=>x.role==='user'&&!inspected.has(x.id)&&couldBeApproval(x.text));
      for(const approval of candidates.slice(-3)){
        const owner=mainOwner(ctx);
        if(!owner||!ctx.isIdle())break;
        const startLeaf=ctx.sessionManager.getLeafId();
        const index=all.findIndex(x=>x.id===approval.id);
        const earlier=all.slice(0,index);
        try{
          // The actual approving USER can provide the entire policy even
          // if the earlier assistant proposal was compacted or not quoted.
          const fallback=explicitApprovalFallback(approval,active);
          let parsed:Awaited<ReturnType<typeof inspectApproval>>;
          try{parsed=await inspectApproval(ctx,approval,earlier,active);}
          catch(error){
            if(!fallback)throw error;
            parsed=undefined;
          }
          if(parsed?.status!=='approved' && fallback)parsed=fallback;
          if(!parsed)break;
          if(ctx.sessionManager.getLeafId()!==startLeaf||!ctx.isIdle())break;
          let record:PolicyDecision|undefined;
          let failureReason='승인 대상 또는 원문을 모델이 확정하지 못함';
          if(parsed.status==='approved'){
            const evidence=resolveApprovedSource(approval,earlier,
              parsed.sourceEntryId,parsed.sourceQuote);
            const source=evidence?.source;
            const quote=evidence?.quote??'';
            const text=approval.text;
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
              source.text.includes(quote);
            if(!source)failureReason='승인한 정책의 실제 원문을 찾지 못함';
            else if(!validSupersession)failureReason='대체 대상 정책 ID가 유효하지 않음';
            else if(overlapping && parsed.supersedesId===null)
              failureReason='이전 확정 정책을 대체할지 확인 필요';
            else if(!broadStop)failureReason='전체 Work 중단 지시의 범위가 불명확함';
            else if(containsSensitivePolicyText(quote)||
                    containsSensitivePolicyText(approval.text))
              failureReason='민감한 내용이 포함되어 자동 전파하지 않음';
            else if(!validSource)failureReason='승인 원문의 길이·출처 검증에 실패함';
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
              '정책 승인 후보 ['+approval.id.slice(0,8)+'] 전파 보류: '+failureReason+'. 원문은 보관됩니다.',
              'warning');
          }
          pi.appendEntry(REVIEW_ENTRY,{approvalEntryId:approval.id,
            reviewVersion:REVIEW_VERSION,
            status:record?'published':parsed.status==='not-a-decision'?'ignored':'ambiguous',
            ...(record||parsed.status==='not-a-decision'?{}:{reason:failureReason})});
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
  async function openReview(ctx:ExtensionContext):Promise<void>{
    const owner=mainOwner(ctx);
    if(!owner||!ctx.hasUI||ctx.mode!=='tui'){
      if(ctx.hasUI)ctx.ui.notify('정책 후보 판정은 소유 Main에서만 가능합니다. Main에서 >p를 입력하세요.','warning');
      return;
    }
    if(!ctx.isIdle()){
      ctx.ui.notify('Main 응답이 끝난 뒤 >p로 승인 후보를 검토해주세요.','warning');
      return;
    }
    const branch=ctx.sessionManager.getBranch();
    const reviews=latestPolicyReviews(branch);
    const resolved=resolvedApprovalIds(branch);
    const pending=recentMessages(ctx).filter(x=>x.role==='user' &&
      couldBeApproval(x.text)&&!resolved.has(x.id));
    if(!pending.length){
      ctx.ui.notify('미해결 Main 승인 후보가 없습니다. 정책 최신성 인덱스를 갱신합니다.','info');
      queuePublish(ctx);
      return;
    }
    const originalLeaf=ctx.sessionManager.getLeafId();
    const labels=pending.map((m,i)=>{
      const reason=reviews.get(m.id)?.reason??'정책 승인 여부 확인 전';
      return String(i+1)+'. '+m.text.replace(/\s+/g,' ').slice(0,75)+
        ' ['+m.id.slice(0,8)+'] · '+reason.slice(0,55);
    });
    const chosen=await ctx.ui.select('Main 미해결 정책 승인 후보 '+pending.length+'건',labels);
    if(!chosen)return;
    const candidate=pending[labels.indexOf(chosen)];
    if(!candidate)return;
    const action=await ctx.ui.select('승인 후보 처리',[
      '이미 확정한 정책에 포함됨 · 기존 결정 연결',
      '정책 확정이 아닌 발화 · 후보에서 제외',
      '나중에 확인 · 변경하지 않음',
    ]);
    if(!action||action.startsWith('나중에'))return;
    const common={approvalEntryId:candidate.id,reviewVersion:REVIEW_VERSION,
      userReviewed:true as const};
    let result:{
      approvalEntryId:string;reviewVersion:number;userReviewed:true;
      status:'ignored'|'resolved';resolution:'not-policy'|'covered-by-decision';
      coveredByDecisionId?:string;
    };
    if(action.startsWith('이미')){
      const decisions=branchDecisions(branch,owner.sessionId);
      if(!decisions.length){
        ctx.ui.notify('선택 가능한 기존 확정 정책이 없습니다. 먼저 Main에서 실제 정책을 확정해주세요.','warning');
        return;
      }
      const options=decisions.map((d,i)=>String(i+1)+'. '+d.subject+' · '+
        d.decision.replace(/\s+/g,' ').slice(0,95)+' ['+d.id.slice(0,8)+']');
      const selected=await ctx.ui.select('어떤 확정 정책에 포함됐나요?',options);
      if(!selected)return;
      const matched=decisions[options.indexOf(selected)];
      if(!matched)return;
      result={...common,status:'resolved',resolution:'covered-by-decision',
        coveredByDecisionId:matched.id};
    }else{
      const confirm=await ctx.ui.confirm('정책 후보에서 제외하시겠습니까?',
        '다음 발화를 승인된 정책으로 전파하지 않습니다. 실제 정책 확정이 아니었나요?\n\n'+
        candidate.text.slice(0,500));
      if(!confirm)return;
      result={...common,status:'ignored',resolution:'not-policy'};
    }
    // Never attach the review to a different Main active branch after a modal.
    if(ctx.sessionManager.getSessionId()!==owner.sessionId||
       ctx.sessionManager.getLeafId()!==originalLeaf||!ctx.isIdle()){
      ctx.ui.notify('선택 중 Main 세션·분기가 변경됐습니다. 다시 >p를 실행해주세요.','warning');
      return;
    }
    pi.appendEntry(REVIEW_ENTRY,result);
    queuePublish(ctx);
    ctx.ui.notify('승인 후보의 처리 결과를 Main 원본에 기록했습니다. Work의 최신성 경고가 자동 갱신됩니다.','info');
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
  return {openReview};
}
