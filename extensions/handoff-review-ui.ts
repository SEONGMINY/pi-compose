/**
 * Work Handoff selector.
 *
 * Reference interactions (not an independent UI pattern):
 * - pi-ask-user v0.17.2: bounded prompt, selectable options,
 *   collapse/expand context, searchable list, Esc clear/back/cancel.
 * - pi-intercom v0.18.1: explicit review before sending.
 *
 * Uses Pi's published TUI primitives rather than calling ask_user as a
 * model tool. ask_user does not export its dialog as a public extension API.
 * UI only: package contents and provenance are unchanged.
 */
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  Text, fuzzyFilter, matchesKey, decodeKittyPrintable,
  isKeyRelease, isKeyRepeat, truncateToWidth, visibleWidth,
} from '@earendil-works/pi-tui';
import type { OverlayHandle } from '@earendil-works/pi-tui';
import type { HandoffPackage } from '../src/handoff/package.ts';
import {contextReviewUnits,selectContextPackage} from '../src/handoff/context-review.ts';

export type ReviewAction =
  | {type:'cancel'}
  | {type:'note';selected:string[];focus:number}
  | {type:'send';selected:string[];note:string};
export type ReviewState={selected:string[];focus:number;note:string};

export function showReferenceContextReview(
  ctx:ExtensionContext,pkg:HandoffPackage,initial:ReviewState,
  controls?:{onToggleZoom?:()=>Promise<string>;zoomState?:()=>string},
):Promise<ReviewAction> {
  const units=contextReviewUnits(pkg);
  let overlayHandle:OverlayHandle|undefined;
  return ctx.ui.custom<ReviewAction>((tui,theme,_keys,done)=>{
    const chosen=new Set(initial.selected);
    let index=Math.max(0,Math.min(initial.focus,units.length-1));
    let mode:'choose'|'evidence'|'preview'|'archive'='choose';
    let expanded=false;
    let search=false;
    let query='';
    let scroll=0;
    let maxScroll=0;
    let detailScroll=0;
    let detailMax=0;
    let wideLayout=false;
    let error='';
    let note=initial.note;
    let preview:HandoffPackage|undefined;
    let inputConnected=false;
    let disposed=false;
    let zoomNotice='';
    const filtered=()=>query?fuzzyFilter(units,query,u=>u.title+' '+u.summary):units;
    const current=()=>filtered()[index];
    const selected=()=>units.filter(u=>chosen.has(u.id)).map(u=>u.id);
    const evidence=()=>{
      const u=current();
      return u?[
        '원문 · '+u.title,
        '',
        ...u.evidence.flatMap(e=>[
          e.role+' · Pi Entry '+e.entryId,
          e.quote,'',
        ]),
        ...u.requiredContext.flatMap(c=>[
          '['+c.reason+'] '+c.whyNeeded,
          c.quote,'',
        ]),
      ]:['원문을 선택할 수 없습니다.'];
    };
    function draft():HandoffPackage {
      return selectContextPackage(pkg,selected(),
        pkg.source.forkLeafId+'-'+pkg.source.workReportEntryId,note);
    }
    function previewLines():string[]{
      if(mode==='archive')return [
        '감사용 원문 기록 (Main 전송문이 아님)','',
        preview?.finalMessage??'',
      ];
      return [
        'Work → Main · 전송 전 최종 확인',
        '아래 본문이 Main에 그대로 전달됩니다.',
        '',
        preview?.approvedMainBrief??'Brief를 준비하지 못했습니다.',
      ];
    }
    function approvedText():string {
      if(!chosen.size)return '전달 예정 항목이 없습니다. Space로 전송할 결과를 선택하세요.';
      try{return draft().approvedMainBrief??'전달문 생성 실패';}
      catch(error){return '전달문 검증 실패: '+String(error);}
    }
    function briefPreview(maxLines:number):string[]{
      const body=approvedText().split('\n');
      return [
        '──── Main에 전달할 실제 본문 ────',
        ...body.slice(0,maxLines),
        ...(body.length>maxLines?[
          '… 남은 본문 '+(body.length-maxLines)+'줄 · Enter로 전체 확인',
        ]:[]),
      ];
    }
    function compactContext():string[]{
      const u=current();
      if(!u)return ['일치하는 항목이 없습니다. Esc로 검색을 지우세요.'];
      const points=u.requiredContext;
      const summary=[
        '선택 항목: '+u.title,
        '요약: '+u.summary,
        '검증: '+u.verification+' (보고 원문을 따로 확인하세요)',
      ];
      if(!points.length)return [...summary,'관련 제약·WHY: 추가로 연결된 항목 없음'];
      if(!expanded)return [
        ...summary,
        '관련 제약·WHY '+points.length+'건 · Ctrl+E로 펼치기',
      ];
      return [
        ...summary,
        '관련 제약·WHY · Ctrl+E로 접기',
        ...points.flatMap(p=>['• '+p.whyNeeded,p.quote]),
      ];
    }
    function choiceLines():string[]{
      const visible=filtered();
      const page=Math.max(3,Math.min(7,Math.floor((tui.terminal.rows-12)/3)));
      const start=Math.max(0,Math.min(index-Math.floor(page/2),visible.length-page));
      const options=visible.slice(start,start+page);
      const chosenClaims=pkg.claims.filter(c=>chosen.has(c.candidateId));
      const linked=pkg.context.filter(c=>
        c.requiredByClaimIds.some(id=>chosen.has(id)));
      return [
        'Work → Main · Handoff Brief',
        '현재 선택으로 Main에 전달되는 내용 · Space로 포함/제외',
        '전달할 결과 '+chosenClaims.length+'건 · 연결된 WHY·제약 '+linked.length+'건',
        ...chosenClaims.map(c=>'- '+c.title+': '+c.summary),
        '',
        ...briefPreview(7),
        '',
        '선택 '+chosen.size+' / '+units.length+' · 현재 후보 '+(index+1)+' / '+filtered().length+
          (search?'  검색: '+(query||'입력 중…'):'  / 검색'),
        '',
        ...options.flatMap((u,j)=>[
          (index===start+j?'› ':'  ')+(chosen.has(u.id)?'[x] ':'[ ] ')+u.title,
          '   '+(u.summary.length>95?u.summary.slice(0,92)+'…':u.summary),
        ]),
        ...(visible.length>page?['  '+(index+1)+'/'+visible.length+' · ↑↓로 항목 이동']:[]),
        ...(!visible.length?['검색 결과가 없습니다. Esc로 검색을 지우세요.']:[]),
        '',
        '──── 선택 항목 맥락 ────',
        ...compactContext(),
        ...(pkg.contextAssessment==='unavailable'
          ?['⚠ 이전 WHY·조건 검색이 완전하지 않습니다.']:[]),
        ...(note?['추가 의견: '+note]:[]),
        ...(error?['안내: '+error]:[]),
        ...(zoomNotice?['Ghostty: '+zoomNotice]:[]),
      ];
    }
    function help():string {
      if(mode==='preview')return 'Enter 승인·전송 · Tab 상세 원문 · PgUp/PgDn 스크롤 · Alt+Z 확대 · Esc 뒤로';
      if(mode==='archive')return 'Tab 승인 본문 · PgUp/PgDn 스크롤 · Alt+Z 확대 · Esc 뒤로';
      if(mode==='evidence')return 'PgUp/PgDn 스크롤 · Alt+Z 확대 · Esc 돌아가기';
      return search
        ?'입력하여 검색 · ↑↓ 이동 · Esc 검색 초기화/종료 · Alt+Z 확대'
        :'↑↓ 이동 · Space 선택 · / 검색 · Ctrl+E 맥락 · PgUp/PgDn 상세 · E 근거 · N 의견 · Enter 검토 · Esc 취소' +
         (inputConnected?' · 키보드 입력 연결됨':'')+' · Alt+Z 확대 · Alt+O 숨기기';
    }
    function body():string[]{
      if(mode==='choose')return choiceLines();
      if(mode==='evidence')return evidence();
      return previewLines();
    }
    /**
     * pi-ask-user's responsive split-pane pattern: the current choice list
     * stays in sight while its description and related WHY are inspected.
     * Evidence stays behind E so a large task never floods the first screen.
     */
    function wideChoice(width:number,rows:number):string[]{
      const inner=Math.max(22,width-2);
      const leftWidth=Math.max(28,Math.floor((inner-3)*0.39));
      const rightWidth=Math.max(20,inner-leftWidth-3);
      const visible=filtered();
      const page=Math.max(3,Math.min(9,rows-6));
      const start=Math.max(0,Math.min(index-Math.floor(page/2),visible.length-page));
      const left=[
        '전달할 컨텍스트 · 선택 '+chosen.size+' / '+units.length+' · 현재 후보 '+(index+1)+' / '+visible.length,
        (search?'검색: '+(query||'입력 중…'):' / 검색 · Space 선택'),
        '',
        ...visible.slice(start,start+page).flatMap((unit,i)=>[
          (index===start+i?'› ':'  ')+(chosen.has(unit.id)?'[x] ':'[ ] ')+unit.title,
        ]),
        ...(!visible.length?['일치하는 항목 없음']:[]),
        ...(visible.length>page?['', (index+1)+'/'+visible.length+' · ↑↓ 이동']:[]),
      ];
      const currentUnit=current();
      const connected=currentUnit?.requiredContext??[];
      // Show the same deterministic approved Brief used by final send.
      // No separately paraphrased preview: selecting/unselecting a claim
      // recalculates this EXACT Main-facing text.
      const right=[
        'Main에 전달할 실제 본문 · 선택에 따라 즉시 갱신',
        '',
        ...approvedText().split('\n'),
        '',
        '──── 현재 커서 항목의 관련 근거 ────',
        currentUnit?.title??'검색 결과 없음',
        '검증: '+(currentUnit?.verification??'해당 없음'),
        ...(expanded
          ?connected.flatMap(c=>['• '+c.whyNeeded,c.quote,''])
          :connected.map(c=>'• '+c.whyNeeded)),
        ...(connected.length&&!expanded?['Ctrl+E로 원문 펼치기']:[]),
        'E: 출처·원문 확인',
        ...(error?['안내: '+error]:[]),
        ...(zoomNotice?['Ghostty: '+zoomNotice]:[]),
      ];
      const leftRows=new Text(left.join('\n'),0,0).render(leftWidth);
      const rightRows=new Text(right.join('\n'),0,0).render(rightWidth);
      detailMax=Math.max(0,rightRows.length-rows);
      detailScroll=Math.max(0,Math.min(detailScroll,detailMax));
      maxScroll=detailMax;
      const rendered:string[]=[];
      for(let i=0;i<Math.min(rows,Math.max(leftRows.length,rightRows.length-detailScroll));i++){
        const leftLine=leftRows[i]??'';
        const rightLine=rightRows[i+detailScroll]??'';
        rendered.push(leftLine+' '.repeat(Math.max(0,leftWidth-visibleWidth(leftLine)))+
          ' │ '+rightLine);
      }
      return rendered;
    }
    function print(width:number):string[]{
      const maxRows=Math.max(4,Math.min(48,tui.terminal.rows-7));
      const wide=mode==='choose'&&width>=108;
      wideLayout=wide;
      const full=wide?[]:new Text(body().join('\n'),1,0).render(Math.max(18,width-2));
      if(!wide){
        maxScroll=Math.max(0,full.length-maxRows);
        scroll=Math.max(0,Math.min(scroll,maxScroll));
      }
      const part=wide?wideChoice(width,maxRows):full.slice(scroll,scroll+maxRows);
      const inner=Math.max(4,width-2);
      const title=mode==='choose'?'Handoff 선택':mode==='evidence'?'근거 확인':'전송 전 확인';
      const wrap=(line:string)=> {
        const trimmed=truncateToWidth(line,inner,'');
        return theme.fg('accent','│')+trimmed+
          ' '.repeat(Math.max(0,inner-visibleWidth(trimmed)))+theme.fg('accent','│');
      };
      return [
        theme.fg('accent','╭'+'─'.repeat(inner)+'╮'),
        wrap(theme.bold(title)),
        ...part.map(wrap),
        ...(wide
          ?(detailMax?[wrap('상세 ↕ '+(detailScroll+1)+' / '+(detailMax+maxRows))]:[])
          :(scroll>0||scroll<maxScroll?[wrap('↕ '+(scroll+1)+'–'+Math.min(full.length,scroll+maxRows)+' / '+full.length)]:[])),
        wrap(theme.fg('dim',help())),
        theme.fg('accent','╰'+'─'.repeat(inner)+'╯'),
      ];
    }
    const component={
      render(width:number){return print(width);},
      handleInput(key:string){
        if(isKeyRepeat(key)||isKeyRelease(key))return;
        if(matchesKey(key,'escape')){
          if(mode==='choose'&&search&&query){query='';index=0;scroll=0;}
          else if(mode==='choose'&&search){search=false;}
          else if(mode==='choose')return done({type:'cancel'});
          else {mode='choose';scroll=0;preview=undefined;}
          tui.requestRender();return;
        }
        if(mode==='choose'){
          if(matchesKey(key,'up')||matchesKey(key,'down')){
            const count=filtered().length;
            if(count)index=(index+(matchesKey(key,'up')?-1:1)+count)%count;
            scroll=0;detailScroll=0;error='';
          }else if(matchesKey(key,'pageUp')||matchesKey(key,'pageDown')){
            if(wideLayout){
              detailScroll=Math.max(0,Math.min(detailMax,detailScroll+
                (matchesKey(key,'pageUp')?-5:5)));
            }else{
              scroll=Math.max(0,Math.min(maxScroll,scroll+
                (matchesKey(key,'pageUp')?-5:5)));
            }
          }else if(matchesKey(key,'space')&&!search){
            const u=current();
            if(u){if(chosen.has(u.id))chosen.delete(u.id);else chosen.add(u.id);}
            error='';
          }else if(matchesKey(key,'ctrl+e')){
            expanded=!expanded;scroll=0;
          }else if(matchesKey(key,'e')&&!search){
            mode='evidence';scroll=0;
          }else if(matchesKey(key,'n')&&!search){
            return done({type:'note',selected:selected(),focus:Math.max(0,units.findIndex(u=>u.id===current()?.id))});
          }else if(matchesKey(key,'return')||matchesKey(key,'enter')){
            if(!chosen.size)error='Space로 전달할 맥락을 하나 이상 선택해주세요.';
            else try{
              preview=draft();mode='preview';scroll=0;error='';
            }catch(ex){
              error='전송문 검증 실패: '+String(ex);
            }
          }else if(key==='/'&&!search){
            search=true;query='';index=0;scroll=0;
          }else if(search&&matchesKey(key,'backspace')){
            query=[...query].slice(0,-1).join('');index=0;
          }else if(search){
            const ch=decodeKittyPrintable(key)??(key.length===1?key:undefined);
            if(ch&&ch.charCodeAt(0)>=32){
              query+=ch;index=0;scroll=0;
            }
          }
        }else if(mode==='evidence'){
          if(matchesKey(key,'pageUp')||matchesKey(key,'up'))
            scroll=Math.max(0,scroll-4);
          else if(matchesKey(key,'pageDown')||matchesKey(key,'down'))
            scroll=Math.min(maxScroll,scroll+4);
        }else{
          if(matchesKey(key,'tab')){
            mode=mode==='preview'?'archive':'preview';scroll=0;
          }else if(matchesKey(key,'pageUp')||matchesKey(key,'up'))
            scroll=Math.max(0,scroll-4);
          else if(matchesKey(key,'pageDown')||matchesKey(key,'down'))
            scroll=Math.min(maxScroll,scroll+4);
          else if((mode==='preview'||mode==='archive')&&
            (matchesKey(key,'return')||matchesKey(key,'enter'))&&preview)
            return done({type:'send',selected:selected(),note});
        }
        tui.requestRender();
      },
      invalidate(){},
      dispose(){disposed=true;removeInput();}
    };
    // Pi 1.4.0 terminal listener runs before the native focused component.
    // Consume only review shortcuts; no model or editor input is intercepted.
    const names=['escape','up','down','space','ctrl+e','e','n','enter',
      'pageUp','pageDown','tab','backspace'] as const;
    const removeInput=ctx.ui.onTerminalInput(key=>{
      if(matchesKey(key,'alt+z')&&controls?.onToggleZoom){
        if(!isKeyRelease(key)&&!isKeyRepeat(key)){
          zoomNotice='Ghostty Split 화면 전환 중…';
          tui.requestRender();
          void controls.onToggleZoom().then(message=>{
            if(!disposed){zoomNotice=message;tui.requestRender();}
          }).catch(error=>{
            if(!disposed){zoomNotice='화면 전환 실패: '+String(error);tui.requestRender();}
          });
        }
        return {consume:true};
      }
      // Same toggle as pi-ask-user's default overlay. Hiding does not submit
      // or mutate the selection, and remains reversible while hidden.
      if(matchesKey(key,'alt+o')&&overlayHandle){
        if(!isKeyRelease(key)&&!isKeyRepeat(key)){
          const nextHidden=!overlayHandle.isHidden();
          overlayHandle.setHidden(nextHidden);
          if(nextHidden)ctx.ui.notify('Handoff 검토를 숨겼습니다 · Alt+O로 다시 열기','info');
        }
        return {consume:true};
      }
      if(overlayHandle?.isHidden())return undefined;
      const recognized=names.some(k=>matchesKey(key,k))||
        (mode==='choose'&&(!search&&key==='/'||search&&
          (decodeKittyPrintable(key)!==undefined||key.length===1)));
      if(!recognized)return undefined;
      if(!isKeyRelease(key)&&!isKeyRepeat(key)){
        inputConnected=true;
        component.handleInput(key);
      }
      return {consume:true};
    });
    return component;
  },{
    overlay:true,
    overlayOptions:{
      anchor:'center',
      width:'92%',
      minWidth:40,
      maxHeight:'85%',
      margin:1,
    },
    onHandle:handle=>{overlayHandle=handle;},
  });
}
