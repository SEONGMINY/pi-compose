/**
 * Exception-only Main Handoff preview.
 * Interaction reference: pi-intercom v0.18.1 ui/inline-message.ts,
 * with its collapsed summary, detail expansion and received-message framing.
 *
 * Uses native Pi custom UI and select dialog; does not invent a second
 * approval for the normal Work-to-Main path.
 */
import type {ExtensionContext} from '@earendil-works/pi-coding-agent';
import {Text,matchesKey,truncateToWidth,visibleWidth} from '@earendil-works/pi-tui';
import type {HandoffPackage} from '../src/handoff/package.ts';
import type {MainComparison} from '../src/handoff/compare.ts';

export function showReferenceReceived(
  ctx:ExtensionContext,
  pkg:HandoffPackage,
  comparison:MainComparison|undefined,
  error:string|undefined,
  importText:string|undefined,
):Promise<boolean>{
  return ctx.ui.custom<boolean>((tui,theme,_keys,done)=>{
    let expanded=false;
    let tab:'message'|'sources'|'import'='message';
    let scroll=0;
    let maxScroll=0;
    const warnings=[
      ...(error?['현재 Main과 비교할 수 없습니다: '+error]:[]),
      ...(!comparison?['자동 확인을 완료하지 못했습니다.']:[]),
      ...(comparison?.items.filter(i=>i.status==='conflict'||i.status==='insufficient')
        .map(i=>'• '+i.status+': '+i.explanation)??[]),
      ...(pkg.contextAssessment==='unavailable'
        ?['과거 WHY·조건을 모두 확인하지 못했습니다.']:[]),
    ];
    const preview=pkg.claims.map(c=>c.title).join(' / ');
    const sourceLines=()=>{
      return [
        '출처 · Work '+pkg.source.workSessionId.slice(0,8),
        ...pkg.evidence.flatMap(e=>[
          '',
          e.role+' · Entry '+e.entryId,
          e.quote,
        ]),
      ];
    };
    const lines=():string[]=>{
      if(tab==='sources')return sourceLines();
      if(tab==='import')return [
        '사용자가 명시적으로 선택할 경우 Main에 들어갈 본문',
        '이미 자동 반영된 정보가 아닙니다.',
        '',
        importText??'반영할 내용이 없습니다.',
      ];
      return [
        'Main · 확인이 필요한 Work 결과',
        '출처: Work '+pkg.source.workSessionId.slice(0,8),
        '',
        ...warnings,
        ...(warnings.length?['']:[]),
        '요약: '+preview,
        ...pkg.claims.slice(0,expanded?pkg.claims.length:2)
          .map(c=>'• '+c.summary),
        ...(pkg.claims.length>2&&!expanded
          ?['다른 결과 '+(pkg.claims.length-2)+'건 · Ctrl+E로 펼치기']:[]),
        ...(expanded?[
          '',
          'Work에서 승인한 정확한 Brief:',
          pkg.approvedMainBrief??pkg.finalMessage,
        ]:['','Ctrl+E로 전체 Work 보고와 필수 WHY 확인']),
        '',
        '이 내용은 Work의 보고입니다. Main의 기존 정책을 변경하지 않습니다.',
      ];
    };
    const foot=():string=>tab==='message'
      ?'Ctrl+E 펼치기/접기 · Tab 근거/본문 · Enter 처리 선택 · Esc 나중에'
      :'Tab 다음 보기 · PgUp/PgDn 스크롤 · Enter 처리 선택 · Esc 돌아가기';
    const render=(width:number)=>{
      const full=new Text(lines().join('\n'),1,0).render(Math.max(20,width-2));
      const visible=Math.max(3,Math.min(24,tui.terminal.rows-7));
      maxScroll=Math.max(0,full.length-visible);
      scroll=Math.min(scroll,maxScroll);
      const inner=Math.max(5,width-2);
      const wrap=(raw:string)=>{
        const t=truncateToWidth(raw,inner,'');
        return theme.fg('accent','│')+t+
          ' '.repeat(Math.max(0,inner-visibleWidth(t)))+theme.fg('accent','│');
      };
      return [
        theme.fg('accent','╭'+'─'.repeat(inner)+'╮'),
        wrap(theme.bold('Work Handoff · 예외 검토')),
        ...full.slice(scroll,scroll+visible).map(wrap),
        ...(maxScroll?[wrap('↕ '+(scroll+1)+'–'+(scroll+visible)+' / '+full.length)]:[]),
        wrap(theme.fg('dim',foot())),
        theme.fg('accent','╰'+'─'.repeat(inner)+'╯'),
      ];
    };
    return {
      render,
      handleInput(key:string){
        if(matchesKey(key,'escape')){
          if(tab!=='message'){tab='message';scroll=0;}
          else done(false);
        }else if(matchesKey(key,'ctrl+e')&&tab==='message'){
          expanded=!expanded;scroll=0;
        }else if(matchesKey(key,'tab')){
          tab=tab==='message'?'sources':tab==='sources'?'import':'message';
          scroll=0;
        }else if(matchesKey(key,'up')||matchesKey(key,'pageUp'))
          scroll=Math.max(0,scroll-4);
        else if(matchesKey(key,'down')||matchesKey(key,'pageDown'))
          scroll=Math.min(maxScroll,scroll+4);
        else if(matchesKey(key,'enter')||matchesKey(key,'return'))done(true);
        tui.requestRender();
      },
      invalidate(){},
    };
  });
}
