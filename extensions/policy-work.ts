import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { POLICY_MESSAGE, policyDelta, renderPolicyDelta, workKnownDecisionIds,
  type PolicyDecision } from '../src/policy/decisions.ts';
import { resolvePolicyMain } from '../src/policy/owners.ts';
import { readPolicySnapshot, watchPolicySnapshot } from '../src/policy/store.ts';
import { isSnapshotCurrentAtHandoff } from '../src/policy/verification.ts';
import { policyNotice, policyNoticeLine, type PolicyIndicatorState } from '../src/policy/status-widget.ts';

export type WorkPolicyStatus = {
  status:'checked'|'delivered'|'pending'|'unavailable';
  mainSessionId?:string;
  revision?:string;
  pendingDecisionIds:string[];
  withdrawnDecisionIds:string[];
  unreviewedApprovalCount?:number;
  pendingSubject?:string;
  hasStop?:boolean;
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
    status:snapshot.unreviewedApprovalEntryIds.length?'unavailable':
      pending?'pending':answeredAfter?'checked':'delivered',
    mainSessionId:mainId,revision:snapshot.revision,
    unreviewedApprovalCount:snapshot.unreviewedApprovalEntryIds.length,
    pendingSubject:delta.added[0]?.subject,
    hasStop:eligible.some(d=>d.effective==='stop'),
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
  const raw=(await check(ctx,main)).status;
  if(raw.status==='unavailable')return raw;
  // This expensive read runs only from the explicit Work Handoff reviewer.
  // A stale local snapshot never silently claims policy freshness.
  try{
    const snapshot=await readPolicySnapshot(main);
    if(!snapshot||!(await isSnapshotCurrentAtHandoff(snapshot)))
      return {...raw,status:'unavailable' as const};
  }catch{return {...raw,status:'unavailable' as const};}
  return raw;
}

/**
 * No second agent run. A new policy is included before the next already-planned
 * model call; work performed before that safe boundary cannot be retroactively undone.
 */
const POLICY_UI_KEY='pi-compose/policy-sync';

/** Keep the built-in model/token/cost footer; use a single editor-adjacent row. */
export function clearPolicyIndicator(ctx:ExtensionContext):void{
  if(!ctx.hasUI)return;
  ctx.ui.setStatus(POLICY_UI_KEY,undefined);
  ctx.ui.setWidget(POLICY_UI_KEY,undefined,{placement:'aboveEditor'});
}
export function renderPolicyIndicator(ctx:ExtensionContext,state:PolicyIndicatorState):void{
  if(!ctx.hasUI)return;
  // Clear the former footer slot even when a saved extension session resumes.
  ctx.ui.setStatus(POLICY_UI_KEY,undefined);
  const notice=policyNotice(state);
  ctx.ui.setWidget(POLICY_UI_KEY,notice
    ? (_tui,theme)=>({
      render(width:number):string[]{
        return [' '+theme.fg(notice.tone,policyNoticeLine(notice,width-1))];
      },
      invalidate():void{},
    })
    :undefined,{placement:'aboveEditor'});
}

export function registerPolicyWork(pi:ExtensionAPI):void{
  let sessionId:string|undefined;
  let mainId:string|undefined;
  let stopWatch:(()=>void)|undefined;
  let renderRevision=0;
  let sessionEpoch=0;
  const reset=()=>{
    sessionEpoch++;
    renderRevision++;
    stopWatch?.();stopWatch=undefined;sessionId=undefined;mainId=undefined;
  };
  async function resolve(ctx:ExtensionContext):Promise<string|undefined>{
    const owner=workOwner(ctx);
    if(!owner)return;
    if(sessionId===owner.sessionId&&mainId)return mainId;
    const found=await resolvePolicyMain(owner);
    if(found){sessionId=owner.sessionId;mainId=found;}
    return found;
  }
  const notify=async(ctx:ExtensionContext)=>{
    // Watch callbacks can complete out of order after a session/branch switch.
    // Only the newest read for the same live Work may change its widget.
    const revision=++renderRevision;
    const owner=workOwner(ctx);
    const observedSession=ctx.sessionManager.getSessionId();
    if(!owner){clearPolicyIndicator(ctx);return;}
    const main=await resolve(ctx);
    if(revision!==renderRevision||ctx.sessionManager.getSessionId()!==observedSession)return;
    if(!main){
      renderPolicyIndicator(ctx,{status:'unavailable',pendingCount:0,unavailableReason:'owner'});
      return;
    }
    try{
      const result=await check(ctx,main);
      if(revision!==renderRevision||ctx.sessionManager.getSessionId()!==observedSession)return;
      const s=result.status;
      renderPolicyIndicator(ctx,{
        status:s.status,pendingCount:s.pendingDecisionIds.length+s.withdrawnDecisionIds.length,
        subject:s.pendingSubject,stop:s.hasStop,
        unreviewedApprovalCount:s.unreviewedApprovalCount,
      });
    }catch{
      if(revision!==renderRevision||ctx.sessionManager.getSessionId()!==observedSession)return;
      renderPolicyIndicator(ctx,{status:'unavailable',pendingCount:0,unavailableReason:'read'});
    }
  };
  async function start(ctx:ExtensionContext){
    reset();
    clearPolicyIndicator(ctx);
    const owner=workOwner(ctx);
    if(!owner)return;
    const epoch=sessionEpoch;
    const main=await resolve(ctx);
    if(epoch!==sessionEpoch||ctx.sessionManager.getSessionId()!==owner.sessionId)return;
    if(!main){
      renderPolicyIndicator(ctx,{status:'unavailable',pendingCount:0,unavailableReason:'owner'});
      return;
    }
    try{
      const close=await watchPolicySnapshot(main,()=>{
        if(epoch===sessionEpoch&&ctx.sessionManager.getSessionId()===owner.sessionId)
          void notify(ctx);
      });
      if(epoch!==sessionEpoch||ctx.sessionManager.getSessionId()!==owner.sessionId){
        close();
        return;
      }
      stopWatch=close;
    }catch{/* Session resume/next run still does an authoritative read. */}
    if(epoch===sessionEpoch&&ctx.sessionManager.getSessionId()===owner.sessionId)
      await notify(ctx);
  }
  pi.on('session_start',(_event,ctx)=>{void start(ctx);});
  pi.on('session_tree',(_event,ctx)=>{void notify(ctx);});
  pi.on('session_before_switch',(_event,ctx)=>{reset();clearPolicyIndicator(ctx);});
  pi.on('session_shutdown',(_event,ctx)=>{reset();clearPolicyIndicator(ctx);});

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
  // A user-confirmed global stop must protect the next mutating tool call,
  // even if this Work was already running before the change arrived. The model
  // receives the actual decision on its next normal prompt boundary.
  pi.on('tool_call',async(event,ctx)=>{
    const work=workOwner(ctx);
    if(!work)return;
    const main=await resolve(ctx);
    if(!main)return;
    let snapshot;
    try{snapshot=await readPolicySnapshot(main);}
    catch{ return; } // Technical failures are surfaced at the Work model boundary.
    if(!snapshot||snapshot.product!==work.product)return;
    const hasStop=snapshot.decisions.some(d=>d.effective==='stop' &&
      (d.scope==='owner-main'||d.targetWorkIds.includes(work.sessionId)));
    if(!hasStop)return;
    const readOnly=new Set(['read','grep','find','ls','glob']);
    if(readOnly.has(event.toolName))return;
    renderPolicyIndicator(ctx,{status:'pending',pendingCount:0,stop:true});
    return {block:true,reason:
      'Current Main has an explicit stop-work decision. Do not modify files or invoke tools until that decision is resolved with the user.'};
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
