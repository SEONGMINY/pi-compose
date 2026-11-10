import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Text, matchesKey } from '@earendil-works/pi-tui';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { listProductHandoffSessions, findParentMainSessionId } from '../src/product-sessions.ts';
import { prepareManualHandoffCandidates } from './handoff-candidates.ts';
import { createSelectedHandoffPackage, verifyWorkSource, type HandoffPackage } from '../src/handoff/package.ts';
import { contextReviewUnits, selectContextPackage, type ContextReviewUnit } from '../src/handoff/context-review.ts';
import { putHandoff, readHandoff } from '../src/handoff/store.ts';

type ReviewAction =
  | {type:'cancel'}
  | {type:'note';selected:string[];focus:number}
  | {type:'send';selected:string[];note:string};

type ReviewState = {selected:string[];focus:number;note:string};

function verificationText(value:ContextReviewUnit['verification']):string {
  switch(value) {
    case 'execution-evidenced':return '실행 증거 연결됨 (성공 여부 별도 확인)';
    case 'source-supported':return '근거 원문 확인됨 (실제 사실 보증 아님)';
    case 'reported-only':return 'Work 보고 · 독립 검증 전';
    case 'unknown':return '검증 불명';
  }
}

/**
 * One temporary TUI review, not a chain of model-only ask_user questions.
 * The selected claim and all of its necessary WHY/scope/evidence stay together.
 * The actual package body is previewed *before* the final Enter approval.
 */
async function showContextReview(
  ctx:ExtensionContext, pkg:HandoffPackage, initial:ReviewState,
):Promise<ReviewAction> {
  const units=contextReviewUnits(pkg);
  return ctx.ui.custom<ReviewAction>((tui,theme,_keys,done)=>{
    const selected=new Set(initial.selected);
    let focus=Math.min(Math.max(0,initial.focus),units.length-1);
    let note=initial.note;
    let page:'review'|'sources'|'preview'='review';
    let scroll=0;
    let maximum=0;
    let preview:HandoffPackage|undefined;

    function makePreview() {
      return selectContextPackage(pkg,[...selected],pkg.source.forkLeafId+'-'+pkg.source.workReportEntryId,note);
    }
    function lines():string[] {
      const current=units[focus];
      if (page==='preview') {
        return [
          'WORK → MAIN · 전송 전 최종 확인',
          '',
          '대상 Main: '+pkg.targetMainSessionId,
          '전송할 컨텍스트: '+selected.size+'건',
          ...(pkg.contextAssessment==='unavailable'
            ? ['⚠ 필수 맥락 검색을 확인하지 못했습니다. 불완전한 보고임을 명시합니다.',''] : []),
          '',
          '━━━━ 실제 전송할 본문 ━━━━',
          preview?.finalMessage ?? '',
        ];
      }
      if (page==='sources') {
        return [
          '원문 근거 · '+(current?.title??''),
          '',
          ...(current?.evidence.flatMap(e=>[
            '['+e.id+'] '+e.role+' · Entry '+e.entryId,
            e.quote,'',
          ])??[]),
          ...(current?.requiredContext.flatMap(c=>[
            '['+c.reason+'] '+c.whyNeeded,'원문: '+c.quote,'',
          ])??[]),
        ];
      }
      return [
        'WORK → MAIN · Context Review',
        '전달할 컨텍스트를 선택하세요. 선택 항목의 필수 맥락은 항상 함께 전송됩니다.',
        '',
        ...units.map((unit,i)=>{
          const pointer=i===focus?'›':' ';
          const checked=selected.has(unit.id)?'[x]':'[ ]';
          return pointer+' '+checked+' '+unit.title+
            ' · '+unit.kind+(unit.requiredContext.length?' · 필수 맥락 '+unit.requiredContext.length+'건':'');
        }),
        '',
        '━━━━ 선택한 항목의 맥락 ━━━━',
        current?.title??'',
        current?.summary??'',
        '',
        '실제 Work/Fork 원문: '+(current?.statement??''),
        '검증: '+(current?verificationText(current.verification):''),
        ...(current?.requiredContext.length?[
          '',
          '함께 전달되는 필수 맥락:',
          ...current.requiredContext.flatMap(c=>[
            '• '+c.reason+' · '+c.whyNeeded,
            '  '+c.quote,
          ]),
        ]:[]),
        ...(pkg.contextAssessment==='unavailable'
          ? ['','⚠ 관련 WHY·조건 검색 결과를 확인하지 못했습니다. 누락 가능성이 있습니다.'] : []),
        '',
        '전송할 항목: '+selected.size+' / '+units.length,
        ...(note?['사용자 메모: '+note]:[]),
      ];
    }
    function footer():string {
      if(page==='preview')return 'Enter 전송 승인   Esc 선택으로 돌아가기   ↑↓ 스크롤';
      if(page==='sources')return 'Esc 선택으로 돌아가기   ↑↓ 스크롤';
      return '↑↓ 항목 이동   Space 포함/제외   E 원문   N 메모   Enter 미리보기   Esc 취소';
    }
    return {
      render(width){
        const text=new Text(lines().join('\n'),1,0);
        const body=text.render(Math.max(20,width));
        const available=Math.max(3,tui.terminal.rows-5);
        maximum=Math.max(0,body.length-available);
        scroll=Math.min(scroll,maximum);
        return [
          ...body.slice(scroll,scroll+available),
          theme.fg('dim',footer()),
        ];
      },
      handleInput(key){
        if(matchesKey(key,'escape')){
          if(page==='review')return done({type:'cancel'});
          page='review';scroll=0;preview=undefined;tui.requestRender();return;
        }
        if(page==='review') {
          if(matchesKey(key,'up')){focus=Math.max(0,focus-1);scroll=0;}
          else if(matchesKey(key,'down')){focus=Math.min(units.length-1,focus+1);scroll=0;}
          else if(matchesKey(key,'space')||key===' '){
            const id=units[focus]?.id;
            if(id){if(selected.has(id))selected.delete(id);else selected.add(id);}
          }
          else if(matchesKey(key,'e')){page='sources';scroll=0;}
          else if(matchesKey(key,'n'))return done({type:'note',selected:[...selected],focus});
          else if(matchesKey(key,'return')||matchesKey(key,'enter')) {
            if(selected.size>0){
              try{preview=makePreview();page='preview';scroll=0;}catch{return;}
            }
          }
        }else {
          if(matchesKey(key,'up'))scroll=Math.max(0,scroll-1);
          else if(matchesKey(key,'down'))scroll=Math.min(maximum,scroll+1);
          else if(page==='preview'&&(matchesKey(key,'return')||matchesKey(key,'enter'))&&preview) {
            return done({type:'send',selected:[...selected],note});
          }
        }
        tui.requestRender();
      },
      invalidate(){/* Rebuild Text from current selection at render time. */}
    };
  });
}

export async function openWorkContextReview(
  pi:ExtensionAPI, ctx:ExtensionContext, announce:(pkg:HandoffPackage)=>void,
  targetMainSessionId?:string,
):Promise<void> {
  if(!ctx.hasUI||ctx.mode!=='tui')return;
  if(!ctx.isIdle()){
    ctx.ui.notify('Work 응답이 끝난 뒤 컨텍스트 검토를 열 수 있습니다.','warning');
    return;
  }
  const source=readAgentRelationship(ctx.sessionManager.getSessionId(),ctx.sessionManager.getEntries());
  if(source?.role!=='work'||!source.forkSourceSessionId||!source.forkSourceLeafId){
    ctx.ui.notify('정확한 Fork 출처를 가진 Work에서만 Main Handoff를 보낼 수 있습니다.','warning');
    return;
  }
  let sessions:Awaited<ReturnType<typeof listProductHandoffSessions>>;
  try {sessions=await listProductHandoffSessions(source.product);}
  catch {ctx.ui.notify('현재 프로젝트의 Main 목록을 확인할 수 없습니다.','warning');return;}
  const recipients=sessions.filter(item=>item.role==='main'&&item.id!==source.sessionId);
  const preferred=findParentMainSessionId(sessions,source.sessionId);
  let target=targetMainSessionId?
    recipients.find(item=>item.id===targetMainSessionId):
    recipients.find(item=>item.id===preferred);
  if(targetMainSessionId&&!target) {
    ctx.ui.notify('요청한 Main의 정확한 세션 ID를 확인하지 못했습니다.','warning');return;
  }
  if(!target){
    if(!recipients.length) {ctx.ui.notify('이 프로젝트에서 수신할 Main을 찾지 못했습니다.','warning');return;}
    const labels=recipients.map(item=>item.name+' ['+item.id+']');
    const chosen=await ctx.ui.select('결과를 받을 Main',labels);
    if(!chosen)return;
    target=recipients[labels.indexOf(chosen)];
  }
  if(!target)return;
  const reportLeaf=ctx.sessionManager.getLeafId();
  const reportSession=ctx.sessionManager.getSessionId();
  const candidateResult=await prepareManualHandoffCandidates(ctx);
  if(candidateResult.status!=='prepared'){
    ctx.ui.notify('공유할 Work 보고를 준비하지 못했습니다: '+candidateResult.status+
      '. 작업 결과를 Work에 보고한 뒤 다시 시도해주세요.','warning');
    return;
  }
  if(ctx.sessionManager.getSessionId()!==reportSession||
     ctx.sessionManager.getLeafId()!==reportLeaf)return;
  const draft=candidateResult.draft;
  const ids=draft.candidates.map((_c,i)=>'HC'+(i+1));
  ctx.ui.notify('필수 제약과 원문 근거를 연결하고 있습니다. 전송은 아직 시작하지 않았습니다.','info');
  let full:HandoffPackage;
  try{
    full=await createSelectedHandoffPackage(ctx,source,draft,{
      ids,reviewEntryId:draft.sourceLeafId,reviewCreatedAt:draft.createdAt,
    },target.id);
    verifyWorkSource(ctx,full);
  }catch(error){
    ctx.ui.notify('컨텍스트와 원문 근거 준비 실패: '+String(error)+'. 전송하지 않았습니다.','warning');
    return;
  }
  let review:ReviewState={selected:ids.length===1?[ids[0]!]:[],
    focus:0,note:''};
  while(true){
    if(ctx.sessionManager.getSessionId()!==reportSession||
       ctx.sessionManager.getLeafId()!==reportLeaf||!ctx.isIdle()){
      ctx.ui.notify('검토 중 Work 분기가 변경됐습니다. 다시 검토해주세요.','warning');
      return;
    }
    const action=await showContextReview(ctx,full,review);
    if(action.type==='cancel')return;
    if(action.type==='note'){
      review={selected:action.selected,focus:action.focus,note:review.note};
      const edited=await ctx.ui.editor('Main에 전할 사용자 의견 (선택 사항, 원문 사실과 분리)',review.note);
      if(edited!==undefined)review.note=edited.slice(0,1200);
      continue;
    }
    if(!action.selected.length)return;
    let final:HandoffPackage;
    try {
      final=selectContextPackage(full,action.selected,
        full.source.forkLeafId+'-'+full.source.workReportEntryId,action.note);
      verifyWorkSource(ctx,final);
    }catch(error){ctx.ui.notify('전송 본문 검증 실패: '+String(error),'warning');return;}
    if(full.contextAssessment==='unavailable'){
      const agree=await ctx.ui.confirm('필수 맥락 미확인',
        '관련 WHY·조건 검색을 완전히 확인하지 못했습니다. 불확실성을 포함한 Work 원문 보고로만 전달할까요?');
      if(!agree){
        review={selected:action.selected,focus:review.focus,note:action.note};
        continue;
      }
    }
    if(ctx.sessionManager.getSessionId()!==reportSession||
       ctx.sessionManager.getLeafId()!==reportLeaf||!ctx.isIdle()){
      ctx.ui.notify('전송 전 Work 분기가 변경됐습니다. 다시 검토해주세요.','warning');return;
    }
    try{
      // Stable id prevents replaying a saved payload after a process restart.
      let existing:HandoffPackage|undefined;
      try{existing=await readHandoff(target.id,final.id);}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(existing){
        ctx.ui.notify('동일한 Work 결과와 선택 범위가 이미 Main에 보관돼 있습니다.','info');return;
      }
      await putHandoff(final);
      pi.appendEntry('compose_context_review_sent',{
        packageId:final.id,mainId:target.id,reportEntryId:draft.reportEntryId,
        selectedIds:action.selected,bodyHash:final.finalMessageHash,
      });
      announce(final);
      ctx.ui.notify('선택한 컨텍스트를 Main에 저장했습니다. Main은 수신 알림에서 확인할 수 있습니다.','info');
    }catch(error){
      ctx.ui.notify('Handoff 저장 실패: '+String(error)+'. 성공으로 표시하지 않았습니다.','error');
    }
    return;
  }
}
