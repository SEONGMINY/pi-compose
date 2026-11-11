import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { DECISION_ENTRY, REVIEW_ENTRY, couldBeApproval, decisionId,
  textParts, type PolicyDecision } from '../src/policy/decisions.ts';
import { makePolicySnapshot, writePolicySnapshot } from '../src/policy/store.ts';

const extraction = z.object({
  status: z.enum(['approved','not-a-decision','ambiguous']),
  sourceEntryId: z.string(),
  sourceQuote: z.string(),
  subject: z.string(),
  reason: z.string(),
  effective: z.enum(['now','next-task','stop']),
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
 * The lexical gate saves extra model calls on ordinary conversation.
 * The semantic check extracts a verbatim supporting quote, never an invented policy.
 */
async function inspectApproval(ctx:ExtensionContext, approval:Msg,
  earlier:readonly Msg[]):Promise<z.infer<typeof extraction>|undefined>{
  if(!ctx.model)return;
  const excerpts=[...earlier.slice(-18),approval].map(x=>({
    id:x.id,role:x.role,text:x.text.slice(0,1700),
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
      'Output JSON only: {"status":"approved|not-a-decision|ambiguous","sourceEntryId":"...",',
      '"sourceQuote":"...","subject":"...","reason":"","effective":"now|next-task|stop"}',
    ].join(' '),
    messages:[{role:'user',content:JSON.stringify({approvalEntryId:approval.id,excerpts}),
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
  pi.on('session_start',(_event,ctx)=>queuePublish(ctx));
  pi.on('session_tree',(_event,ctx)=>queuePublish(ctx));

  let inspecting=false;
  pi.on('agent_settled',async(event,ctx)=>{
    if(event.aborted||!mainOwner(ctx)){queuePublish(ctx);return;}
    if(inspecting){queuePublish(ctx);return;}
    inspecting=true;
    try{
      const all=recentMessages(ctx);
      const branch=ctx.sessionManager.getBranch();
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
          const parsed=await inspectApproval(ctx,approval,earlier);
          if(!parsed)break;
          if(ctx.sessionManager.getLeafId()!==startLeaf||!ctx.isIdle())break;
          let record:PolicyDecision|undefined;
          if(parsed.status==='approved'){
            const source=[...earlier,approval].find(x=>x.id===parsed.sourceEntryId);
            const quote=parsed.sourceQuote.trim();
            const text=approval.text;
            const pointer=/\b[A-Z]\s*(?:안|option)\b|\b[가-힣]\s*안\b/i.test(text);
            const validSource=source && quote.length>=10 &&
              source.text.includes(quote) &&
              (!pointer || source.id!==approval.id);
            if(validSource){
              record={
                id:decisionId(owner.sessionId,approval.id,source.id,quote),
                mainSessionId:owner.sessionId,approvalEntryId:approval.id,
                sourceEntryId:source.id,approvalQuote:approval.text.slice(0,1200),
                sourceQuote:quote.slice(0,1600),
                subject:parsed.subject.slice(0,140)||'Main 확정 결정',
                decision:quote.slice(0,1600),
                reason:parsed.reason.slice(0,800),
                scope:'owner-main',targetWorkIds:[],effective:parsed.effective,
              };
            }
          }
          if(record){
            // Idempotent across recovery and multiple extension callbacks.
            if(!ctx.sessionManager.getBranch().some(e=>e.type==='custom' &&
                e.customType===DECISION_ENTRY && (e.data as {id?:string})?.id===record.id)){
              pi.appendEntry(DECISION_ENTRY,record);
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
  });
}
