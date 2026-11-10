import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Text, matchesKey, visibleWidth } from '@earendil-works/pi-tui';
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
    let focusArea:'list'|'details'='list';
    let note=initial.note;
    let page:'review'|'sources'|'preview'|'raw'='review';
    let scroll=0;
    let maximum=0;
    let preview:HandoffPackage|undefined;
    let previewError:string|undefined;

    function makePreview() {
      return selectContextPackage(pkg,[...selected],pkg.source.forkLeafId+'-'+pkg.source.workReportEntryId,note);
    }
    function lines():string[] {
      const current=units[focus];
      // An immutable snapshot remains narrowed inside flatMap callbacks.
      const previewSnapshot=preview;
      if(page==='raw')return [
        'WORK → MAIN · 정확한 전송 원문',
        '',
        preview?.finalMessage??'',
      ];
      if (page==='preview') {
        return [
          'WORK → MAIN · 전송 전 최종 확인',
          '대상 Main: '+pkg.targetMainSessionId,
          '선택한 컨텍스트: '+selected.size+'건',
          '',
          ...(previewSnapshot ? previewSnapshot.claims.flatMap((claim,i)=>[
            (i+1)+'. '+claim.title,
            '  '+claim.summary,
            '  검증 수준: '+claim.verification,
            ...previewSnapshot.context.filter(c=>c.requiredByClaimIds.includes(claim.candidateId))
              .map(c=>'  함께 보내는 '+c.reason+': '+c.whyNeeded+' — '+c.quote),
            '',
          ]) : []),
          ...(note?['사용자 추가 의견 (검증된 Work 사실 아님): '+note,'']:[]),
          ...(pkg.contextAssessment==='unavailable'
            ? ['⚠ 필수 과거 WHY·제약 검색 미확인. 제한된 원문 보고로 전송합니다.',''] : []),
          '각 항목의 실제 원문 인용·Pi Entry ID도 함께 보관됩니다.',
          'Tab을 누르면 미리보기에서 생성된 정확한 전체 전송문을 볼 수 있습니다.',
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
        ...(previewError?['⚠ 전송문 생성 실패: '+previewError,'선택 또는 메모를 수정한 뒤 다시 시도해주세요.']:[]),
        ...(note?['사용자 메모: '+note]:[]),
      ];
    }
    function wideReview(width:number):string[] {
      const current=units[focus];
      const leftWidth=Math.max(27,Math.floor(width*0.36));
      const rightWidth=Math.max(20,width-leftWidth-3);
      const left=[
        'WORK → MAIN · Context Review',
        '선택할 컨텍스트',
        '',
        ...units.map((unit,i)=>
          (i===focus?'› ':'  ')+(selected.has(unit.id)?'[x] ':'[ ] ')+
          unit.title+(unit.requiredContext.length?' · 맥락 '+unit.requiredContext.length:'')
        ),
        '',
        '선택 '+selected.size+' / '+units.length,
      ];
      const right=[
        '현재 항목의 의미와 연결 근거',
        '',
        current?.title??'',
        current?.summary??'',
        '',
        '원문: '+(current?.statement??''),
        '검증: '+(current?verificationText(current.verification):''),
        ...(current?.requiredContext.length?[
          '',
          '필수 제약·WHY·상태:',
          ...current.requiredContext.flatMap(c=>[
            '• '+c.reason+' · '+c.whyNeeded,'  '+c.quote,
          ]),
        ]:[]),
        ...(pkg.contextAssessment==='unavailable'
          ? ['','⚠ 필요한 과거 맥락을 충분히 확인하지 못했습니다.']:[]),
        ...(note?['','사용자 메모: '+note]:[]),
        ...(previewError?['','⚠ '+previewError]:[]),
      ];
      const leftLines=new Text(left.join('\n'),0,0).render(leftWidth);
      const rightLines=new Text(right.join('\n'),0,0).render(rightWidth);
      const height=Math.max(3,tui.terminal.rows-5);
      maximum=Math.max(0,rightLines.length-height);
      scroll=Math.min(scroll,maximum);
      const rows:string[]=[];
      const length=Math.min(height,Math.max(leftLines.length,rightLines.length-scroll));
      for(let i=0;i<length;i++){
        const leftLine=leftLines[i]??'';
        const rightLine=rightLines[i+scroll]??'';
        rows.push(leftLine+' '.repeat(Math.max(0,leftWidth-visibleWidth(leftLine)))+' │ '+rightLine);
      }
      return [...rows,theme.fg('dim',footer())];
    }
    function footer():string {
      if(page==='preview')return 'Tab 전체 전송 원문   ↑↓ 스크롤   Enter 승인·전송   Esc 돌아가기';
      if(page==='raw')return 'Tab 요약으로 돌아가기   ↑↓ 스크롤   Enter 승인·전송   Esc 돌아가기';
      if(page==='sources')return 'Esc 선택으로 돌아가기   ↑↓ 스크롤';
      return 'Tab 목록/상세   ↑↓ 이동/스크롤   Space 선택   E 원문   N 의견·근거 보완   Enter 미리보기   Esc 취소';
    }
    return {
      render(width){
        if(page==='review'&&width>=104)return wideReview(width);
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
          if(matchesKey(key,'tab')){
            focusArea=focusArea==='list'?'details':'list';
            scroll=focusArea==='details'
              ?(tui.terminal.columns>=104?0:Math.min(maximum,units.length+5)):0;
          }
          else if(matchesKey(key,'up')){
            if(focusArea==='list'){focus=Math.max(0,focus-1);scroll=0;}
            else scroll=Math.max(0,scroll-1);
          }
          else if(matchesKey(key,'down')){
            if(focusArea==='list'){focus=Math.min(units.length-1,focus+1);scroll=0;}
            else scroll=Math.min(maximum,scroll+1);
          }
          else if((matchesKey(key,'space')||key===' ')&&focusArea==='list'){
            const id=units[focus]?.id;
            if(id){if(selected.has(id))selected.delete(id);else selected.add(id);}
          }
          else if(matchesKey(key,'e')){page='sources';scroll=0;}
          else if(matchesKey(key,'n'))return done({type:'note',selected:[...selected],focus});
          else if(matchesKey(key,'return')||matchesKey(key,'enter')) {
            if(selected.size>0){
              try{preview=makePreview();previewError=undefined;page='preview';scroll=0;}
              catch(error){previewError=error instanceof Error?error.message:'본문 검증 실패';}
            }
          }
        }else {
          if(matchesKey(key,'tab')&&(page==='preview'||page==='raw')){
            page=page==='preview'?'raw':'preview';scroll=0;
          }
          else if(matchesKey(key,'up'))scroll=Math.max(0,scroll-1);
          else if(matchesKey(key,'down'))scroll=Math.min(maximum,scroll+1);
          else if((page==='preview'||page==='raw')&&
            (matchesKey(key,'return')||matchesKey(key,'enter'))&&preview) {
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
  targetMainSessionId?:string, recipientQuery?:string,
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
  const search=recipientQuery?.trim().toLocaleLowerCase();
  const matching=search?
    recipients.filter(item=>
      item.id.toLocaleLowerCase().includes(search) ||
      item.name.toLocaleLowerCase().includes(search))
    :recipients;
  let target=targetMainSessionId?
    recipients.find(item=>item.id===targetMainSessionId):
    recipientQuery?.trim()?(matching.length===1?matching[0]:undefined):
    recipients.find(item=>item.id===preferred);
  if(targetMainSessionId&&!target) {
    ctx.ui.notify('요청한 Main의 정확한 세션 ID를 확인하지 못했습니다.','warning');return;
  }
  if(!target){
    if(!matching.length) {ctx.ui.notify('이 프로젝트에서 일치하는 Main을 찾지 못했습니다.','warning');return;}
    const labels=matching.map(item=>item.name+' ['+item.id+']');
    const chosen=await ctx.ui.select('결과를 받을 Main',labels);
    if(!chosen)return;
    target=matching[labels.indexOf(chosen)];
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
      const feedback=await ctx.ui.editor(
        '현재 컨텍스트 보완 요청 또는 Main에 전달할 사용자 의견', '');
      if(!feedback?.trim())continue;
      const type=await ctx.ui.select('이 의견을 어떻게 사용할까요?',[
        '선택한 컨텍스트의 근거·WHY를 추가로 찾아보기',
        'Main에 사용자 메모로 첨부',
      ]);
      if(!type)continue;
      if(type==='Main에 사용자 메모로 첨부'){
        review.note=feedback.trim().slice(0,1200);
        continue;
      }
      if(!ctx.model){
        ctx.ui.notify('모델을 사용할 수 없어 추가 근거 검색을 수행하지 못했습니다. 기존 선택은 유지됩니다.','warning');
        continue;
      }
      try{
        const refined=await createSelectedHandoffPackage(ctx,source,draft,{
          ids,reviewEntryId:draft.sourceLeafId,reviewCreatedAt:draft.createdAt,
          note:feedback.trim().slice(0,1200),
        },target.id);
        verifyWorkSource(ctx,refined);
        const preserved=full.context.every(before=>
          refined.context.some(after=>after.quote===before.quote &&
            after.reason===before.reason &&
            before.requiredByClaimIds.every(id=>after.requiredByClaimIds.includes(id))));
        if(refined.contextAssessment==='unavailable'||!preserved){
          ctx.ui.notify('추가 근거 검색이 불완전하거나 기존 필수 맥락을 유지하지 못했습니다. 이전 검토 내용을 그대로 보존합니다.','warning');
        }else{
          full=refined;
          ctx.ui.notify('근거 검색 결과를 갱신했습니다. 선택한 범위는 그대로 유지됩니다.','info');
        }
      }catch(error){
        ctx.ui.notify('근거 보완에 실패했습니다: '+String(error)+'. 기존 선택을 보존합니다.','warning');
      }
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
