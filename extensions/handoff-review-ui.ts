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
import type { HandoffPackage } from '../src/handoff/package.ts';
import {contextReviewUnits,selectContextPackage} from '../src/handoff/context-review.ts';

export type ReviewAction =
  | {type:'cancel'}
  | {type:'note';selected:string[];focus:number}
  | {type:'send';selected:string[];note:string};
export type ReviewState={selected:string[];focus:number;note:string};

export function showReferenceContextReview(
  ctx:ExtensionContext,pkg:HandoffPackage,initial:ReviewState,
):Promise<ReviewAction> {
  const units=contextReviewUnits(pkg);
  return ctx.ui.custom<ReviewAction>((tui,theme,_keys,done)=>{
    const chosen=new Set(initial.selected);
    let index=Math.max(0,Math.min(initial.focus,units.length-1));
    let mode:'choose'|'evidence'|'preview'|'archive'='choose';
    let expanded=false;
    let search=false;
    let query='';
    let scroll=0;
    let maxScroll=0;
    let error='';
    let note=initial.note;
    let preview:HandoffPackage|undefined;
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
        '감사용 근거 (Main 전송문이 아님)','',
        preview?.finalMessage??'',
      ];
      return [
        'Work → Main · 전송 전 확인',
        '아래 본문이 Main에 그대로 전달됩니다.',
        '',
        preview?.approvedMainBrief??'Brief를 준비하지 못했습니다.',
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
      return [
        'Work → Main · Handoff Brief',
        '전달할 맥락을 선택하세요. 출처·WHY는 연결된 채 보존됩니다.',
        '',
        '선택 '+chosen.size+'/'+units.length+
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
      ];
    }
    function help():string {
      if(mode==='preview')return 'Enter 승인·전송 · Tab 상세 원문 · PgUp/PgDn 스크롤 · Esc 뒤로';
      if(mode==='archive')return 'Tab 승인 본문 · PgUp/PgDn 스크롤 · Esc 뒤로';
      if(mode==='evidence')return 'PgUp/PgDn 스크롤 · Esc 돌아가기';
      return search
        ?'입력하여 검색 · ↑↓ 이동 · Space 선택 · Esc 검색 해제'
        :'↑↓ 이동 · Space 선택 · / 검색 · Ctrl+E 맥락 · E 근거 · N 의견 · Enter 검토 · Esc 취소';
    }
    function body():string[]{
      if(mode==='choose')return choiceLines();
      if(mode==='evidence')return evidence();
      return previewLines();
    }
    function print(width:number):string[]{
      const full=new Text(body().join('\n'),1,0).render(Math.max(18,width));
      const maxRows=Math.max(4,Math.min(25,tui.terminal.rows-7));
      maxScroll=Math.max(0,full.length-maxRows);
      scroll=Math.max(0,Math.min(scroll,maxScroll));
      const part=full.slice(scroll,scroll+maxRows);
      const inner=Math.max(4,width-2);
      const title=mode==='choose'?'Handoff 선택':mode==='evidence'?'근거 확인':'전송 전 확인';
      const border=theme.fg('accent','─'.repeat(Math.max(0,inner)));
      const wrap=(line:string)=> {
        const trimmed=truncateToWidth(line,inner,'');
        return theme.fg('accent','│')+trimmed+
          ' '.repeat(Math.max(0,inner-visibleWidth(trimmed)))+theme.fg('accent','│');
      };
      return [
        theme.fg('accent','╭'+border.slice(0,Math.max(0,inner))+'╮'),
        wrap(theme.bold(title)),
        ...part.map(wrap),
        ...(scroll>0||scroll<maxScroll?[wrap('↕ '+(scroll+1)+'–'+Math.min(full.length,scroll+maxRows)+' / '+full.length)]:[]),
        wrap(theme.fg('dim',help())),
        theme.fg('accent','╰'+'─'.repeat(inner)+'╯'),
      ];
    }
    const component={
      render(width:number){return print(width);},
      handleInput(key:string){
        if(isKeyRepeat(key)||isKeyRelease(key))return;
        if(matchesKey(key,'escape')){
          if(search&&query){query='';index=0;scroll=0;}
          else if(search){search=false;}
          else if(mode==='choose')return done({type:'cancel'});
          else {mode='choose';scroll=0;preview=undefined;}
          tui.requestRender();return;
        }
        if(mode==='choose'){
          if(matchesKey(key,'up')||matchesKey(key,'down')){
            const count=filtered().length;
            if(count)index=(index+(matchesKey(key,'up')?-1:1)+count)%count;
            scroll=0;error='';
          }else if(matchesKey(key,'space')){
            const u=current();
            if(u){if(chosen.has(u.id))chosen.delete(u.id);else chosen.add(u.id);}
            error='';
          }else if(matchesKey(key,'ctrl+e')){
            expanded=!expanded;scroll=0;
          }else if(matchesKey(key,'e')&&!search){
            mode='evidence';scroll=0;
          }else if(matchesKey(key,'n')&&!search){
            return done({type:'note',selected:selected(),focus:index});
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
            if(ch&&ch!==' '&&ch.charCodeAt(0)>=32){
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
          else if(mode==='preview'&&(matchesKey(key,'return')||matchesKey(key,'enter'))&&preview)
            return done({type:'send',selected:selected(),note});
        }
        tui.requestRender();
      },
      invalidate(){},
      dispose(){removeInput();}
    };
    // Pi 1.4.0 terminal listener runs before the native focused component.
    // Consume only review shortcuts; no model or editor input is intercepted.
    const names=['escape','up','down','space','ctrl+e','e','n','enter',
      'pageUp','pageDown','tab','backspace'];
    const removeInput=ctx.ui.onTerminalInput(key=>{
      const recognized=names.some(k=>matchesKey(key,k))||
        (mode==='choose'&&(!search&&key==='/'||search&&
          (decodeKittyPrintable(key)!==undefined||key.length===1)));
      if(!recognized)return undefined;
      if(!isKeyRelease(key)&&!isKeyRepeat(key))component.handleInput(key);
      return {consume:true};
    });
    return component;
  });
}
