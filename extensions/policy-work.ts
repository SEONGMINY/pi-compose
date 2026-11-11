import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { POLICY_MESSAGE, policyDelta, renderPolicyDelta, workKnownDecisionIds,
  type PolicyDecision } from '../src/policy/decisions.ts';
import { resolvePolicyMain } from '../src/policy/owners.ts';
import { readPolicySnapshot, watchPolicySnapshot } from '../src/policy/store.ts';

export type WorkPolicyStatus = {
  status:'checked'|'delivered'|'pending'|'unavailable';
  mainSessionId?:string;
  revision?:string;
  pendingDecisionIds:string[];
  withdrawnDecisionIds:string[];
};
type Change = {
  mainId:string;
  content:string;
  details:{
    mainSessionId:string;
    snapshotRevision:string;
    activeDecisionIds:string[];
    addedDecisionIds:string[];
    withdrawnDecisionIds:string[];
  };
};
function workOwner(ctx:ExtensionContext){
  const rel=readAgentRelationship(ctx.sessionManager.getSessionId(),ctx.sessionManager.getEntries());
  return rel?.role==='work'?rel:undefined;
}
async function check(ctx:ExtensionContext,mainId:string):Promise<{
  status:WorkPolicyStatus;change?:Change;
}> {
  const work=workOwner(ctx);
  if(!work)return {status:{status:'unavailable',pendingDecisionIds:[],withdrawnDecisionIds:[]}};
  const snapshot=await readPolicySnapshot(mainId);
  if(!snapshot||snapshot.product!==work.product)
    return {status:{status:'unavailable',mainSessionId:mainId,
      pendingDecisionIds:[],withdrawnDecisionIds:[]}};
  const branch=ctx.sessionManager.getBranch();
  const known=workKnownDecisionIds(branch,mainId);
  const delta=policyDelta(snapshot.decisions,known,work.sessionId);
  const eligible=snapshot.decisions.filter(d=>
    d.scope==='owner-main'||d.targetWorkIds.includes(work.sessionId));
  const pending=delta.added.length>0||delta.withdrawn.length>0;
  // A durable update message can be recorded *after* the last Work turn.
  // Do not report it as reviewed or applied until another Work response exists.
  const lastReceipt=branch.reduce((found,e,index)=>e.type==='custom_message' &&
    e.customType===POLICY_MESSAGE &&
    e.details&&typeof e.details==='object'&&!Array.isArray(e.details) &&
    (e.details as {mainSessionId?:string}).mainSessionId===mainId?index:found,-1);
  const answeredAfter=lastReceipt<0 || branch.slice(lastReceipt+1).some(e=>
    e.type==='message'&&e.message.role==='assistant'&&e.message.stopReason==='stop');
  const status:WorkPolicyStatus={
    status:pending?'pending':answeredAfter?'checked':'delivered',
    mainSessionId:mainId,revision:snapshot.revision,
    pendingDecisionIds:delta.added.map(d=>d.id),
    withdrawnDecisionIds:delta.withdrawn,
  };
  if(!pending)return {status};
  // One delivery contains only a bounded batch; receipts never mark unseen
  // decisions as delivered. Later requests drain the rest.
  const added=delta.added.slice(0,4);
  const withdrawn=delta.withdrawn.slice(0,25);
  const next=new Set(known);
  for(const id of withdrawn)next.delete(id);
  for(const d of added)next.add(d.id);
  const details={
    mainSessionId:mainId,snapshotRevision:snapshot.revision,
    activeDecisionIds:[...next],
    addedDecisionIds:added.map(d=>d.id),withdrawnDecisionIds:withdrawn,
  };
  return {status,change:{
    mainId,content:renderPolicyDelta(mainId,added,withdrawn),details,
  }};
}

export async function getWorkPolicyStatus(
  ctx:ExtensionContext,mainId?:string,
):Promise<WorkPolicyStatus>{
  const owner=workOwner(ctx);
  if(!owner)return {status:'unavailable',pendingDecisionIds:[],withdrawnDecisionIds:[]};
  const main=mainId??await resolvePolicyMain(owner);
  if(!main)return {status:'unavailable',pendingDecisionIds:[],withdrawnDecisionIds:[]};
  return (await check(ctx,main)).status;
}

/**
 * No second agent run. A new policy is included before the next already-planned
 * model call; work performed before that safe boundary cannot be retroactively undone.
 */
export function registerPolicyWork(pi:ExtensionAPI):void{
  let sessionId:string|undefined;
  let mainId:string|undefined;
  let stopWatch:(()=>void)|undefined;
  const reset=()=>{stopWatch?.();stopWatch=undefined;sessionId=undefined;mainId=undefined;};
  async function resolve(ctx:ExtensionContext):Promise<string|undefined>{
    const owner=workOwner(ctx);
    if(!owner)return;
    if(sessionId===owner.sessionId&&mainId)return mainId;
    const found=await resolvePolicyMain(owner);
    if(found){sessionId=owner.sessionId;mainId=found;}
    return found;
  }
  const notify=async(ctx:ExtensionContext)=>{
    const main=await resolve(ctx);
    if(!main)return;
    try{
      const result=await check(ctx,main);
      if(ctx.hasUI)ctx.ui.setStatus('pi-compose/policy-sync',
        result.status.status==='pending'
          ?'Main 정책 변경 '+(result.status.pendingDecisionIds.length+
            result.status.withdrawnDecisionIds.length)+'건 확인 필요'
          :result.status.status==='unavailable'?'Main 정책 최신성 미확인':
          result.status.status==='delivered'?'Main 정책 알림 수신 · Work 검토 미확인':undefined);
    }catch(error){
      if(ctx.hasUI)ctx.ui.setStatus('pi-compose/policy-sync','Main 정책 조회 실패');
    }
  };
  async function start(ctx:ExtensionContext){
    reset();
    const owner=workOwner(ctx);
    if(!owner)return;
    const main=await resolve(ctx);
    if(!main){
      if(ctx.hasUI)ctx.ui.setStatus('pi-compose/policy-sync','정책 소유 Main 불명확');
      return;
    }
    try{
      stopWatch=await watchPolicySnapshot(main,()=>{void notify(ctx);});
    }catch{/* Session resume/next run still does an authoritative read. */}
    await notify(ctx);
  }
  pi.on('session_start',(_event,ctx)=>{void start(ctx);});
  pi.on('session_tree',(_event,ctx)=>{void notify(ctx);});
  pi.on('session_shutdown',()=>reset());

  pi.on('before_agent_start',async(_event,ctx)=>{
    const main=await resolve(ctx);
    if(!main)return;
    const {change}=await check(ctx,main);
    if(!change)return;
    return {message:{customType:POLICY_MESSAGE,content:change.content,
      display:true,details:change.details}};
  });
  // An already-running Work may see changes between model requests.
  pi.on('context',async(event,ctx)=>{
    const main=await resolve(ctx);
    if(!main)return;
    const {change}=await check(ctx,main);
    if(!change)return;
    if(event.messages.some(m=>m.role==='custom' &&
       m.customType===POLICY_MESSAGE &&
       (m.details as {snapshotRevision?:string}|undefined)?.snapshotRevision===
         change.details.snapshotRevision))return;
    return {messages:[...event.messages,{
      role:'custom' as const,customType:POLICY_MESSAGE,
      content:change.content,display:false,details:change.details,timestamp:Date.now(),
    }]};
  });
  // Persist the exact batch after a run if it was delivered only through the
  // ephemeral context hook. This is a receipt, not evidence of code changes.
  pi.on('agent_settled',async(event,ctx)=>{
    if(event.aborted)return;
    const main=await resolve(ctx);
    if(!main)return;
    try{
      const {change}=await check(ctx,main);
      if(change)pi.sendMessage({customType:POLICY_MESSAGE,content:change.content,
        display:true,details:change.details},{triggerTurn:false});
      await notify(ctx);
    }catch(error){
      if(ctx.hasUI)ctx.ui.notify('정책 변경 기록 복구 실패: '+String(error),'warning');
    }
  });
}
