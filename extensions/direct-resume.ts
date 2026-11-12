import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { getFocusedGhosttyTerminalId } from '../src/ghostty-native.ts';
import {
  inspectNativeWorkResume, resumeNativeWorkFromTerminal,
} from '../src/native-agent-launch.ts';
import {
  listProductWorkResumeSessions, searchProductWorkResumeSessions,
  type WorkResumeCandidate,
} from '../src/product-sessions.ts';

export type WorkResumeShortcut={ query:string };

/**
 * >r           Select a previous Work from the same product
 * >r @Work     Filter saved Work sessions by label, task or partial ID
 * >r @<id>     Choose the exact previous Work and resume (NOT Fork)
 */
export function parseWorkResumeShortcut(text:string):WorkResumeShortcut|undefined{
  if(text.trim()==='>r')return {query:''};
  const match=/^>r[ \t]+@(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s]*))[ \t]*$/.exec(text);
  if(!match)return;
  return {query:match[1]??match[2]??match[3]??''};
}

async function selectSavedWork(
  ctx:ExtensionContext,product:string,query:string,
):Promise<WorkResumeCandidate|undefined>{
  const matches=searchProductWorkResumeSessions(
    await listProductWorkResumeSessions(product),query);
  if(!matches.length){
    ctx.ui.notify('해당 프로젝트에서 재개할 기존 Work 세션을 찾지 못했습니다.','warning');
    return;
  }
  const labels=matches.map((item,i)=>[
    String(i+1)+'. '+item.name+' ['+item.id.slice(0,12)+']',
    item.recentTask.slice(0,68),item.cwd,
  ].join(' · '));
  const chosen=await ctx.ui.select('기존 Work 세션 선택 · Fork하지 않고 재개',labels);
  if(!chosen)return;
  return matches[labels.indexOf(chosen)];
}

export function registerWorkResumeAutocomplete(pi:ExtensionAPI):void{
  let registered=false;
  pi.on('session_start',(_event,ctx)=>{
    if(!ctx.hasUI||registered)return;
    registered=true;
    ctx.ui.addAutocompleteProvider(previous=>({
      ...previous,
      triggerCharacters:[...new Set([...(previous.triggerCharacters||[]),'@'])],
      async getSuggestions(lines,cursorLine,cursorCol,options){
        const before=(lines[cursorLine]||'').slice(0,cursorCol);
        const match=/^>r[ \t]+(@[^\s]*)$/.exec(before);
        if(!match||cursorLine!==0||options.signal.aborted)
          return previous.getSuggestions(lines,cursorLine,cursorCol,options);
        const owner=readAgentRelationship(ctx.sessionManager.getSessionId(),
          ctx.sessionManager.getEntries());
        if(!owner)return null;
        const found=searchProductWorkResumeSessions(
          await listProductWorkResumeSessions(owner.product),match[1].slice(1));
        if(options.signal.aborted||!found.length)return null;
        return {prefix:match[1],items:found.slice(0,20).map(item=>({
          value:item.id,label:item.name+' ['+item.id.slice(0,12)+']',
          description:'기존 Work · '+item.recentTask.slice(0,64)+' · '+item.cwd,
        }))};
      },
      shouldTriggerFileCompletion(lines,cursorLine,cursorCol){
        return previous.shouldTriggerFileCompletion?.(lines,cursorLine,cursorCol)??false;
      },
      applyCompletion(lines,cursorLine,cursorCol,item,prefix){
        if(!prefix.startsWith('@')||!/^\s*>r\s+@/.test(lines[0]||''))
          return previous.applyCompletion(lines,cursorLine,cursorCol,item,prefix);
        const before=lines[cursorLine].slice(0,cursorCol-prefix.length);
        const after=lines[cursorLine].slice(cursorCol);
        const next=[...lines];
        next[cursorLine]=before+'@'+item.value+after;
        return {lines:next,cursorLine,cursorCol:before.length+item.value.length+1};
      },
    }));
  });
}

export function registerDirectWorkResume(pi:ExtensionAPI):void{
  let inFlight=false;
  pi.on('input',async(event,ctx)=>{
    if(event.source!=='interactive')return {action:'continue'};
    const shortcut=parseWorkResumeShortcut(event.text);
    if(!shortcut&&!/^>r(?:$|\s)/.test(event.text))return {action:'continue'};
    const restore=(reason:string)=>{
      if(ctx.hasUI){ctx.ui.setEditorText(event.text);ctx.ui.notify(reason,'warning');}
      return {action:'handled' as const};
    };
    if(!ctx.hasUI)return {action:'handled'};
    if(!shortcut)return restore('사용법: >r 또는 >r @기존Work · 추가 작업 프롬프트 없음');
    if(inFlight)return restore('기존 Work 세션 선택 또는 재개가 진행 중입니다.');
    if(event.images?.length||event.streamingBehavior)
      return restore('현재 응답이 끝난 뒤, 이미지 없이 Work 재개 명령만 입력해주세요.');
    inFlight=true;
    try{
      const callerId=ctx.sessionManager.getSessionId();
      const leaf=ctx.sessionManager.getLeafId();
      const owner=readAgentRelationship(callerId,ctx.sessionManager.getEntries());
      if(!owner)return restore('확인된 Pi Compose Agent 세션에서만 기존 Work를 선택할 수 있습니다.');
      const candidate=await selectSavedWork(ctx,owner.product,shortcut.query);
      if(!candidate)return {action:'handled'};
      if(ctx.sessionManager.getSessionId()!==callerId||
         ctx.sessionManager.getLeafId()!==leaf)
        return restore('선택 중 호출한 세션/분기가 변경됐습니다. 다시 실행해주세요.');
      const preview=await inspectNativeWorkResume({
        sessionFile:candidate.file,sessionId:candidate.id,product:owner.product,
      });
      if(preview.state==='process-observed')
        return restore('기존 Work 프로세스가 실행 중입니다. 같은 Pi 세션을 중복 실행할 수 없습니다.');
      let allowUnconfirmedProcess=false;
      if(preview.state==='unconfirmed'){
        const approved=await ctx.ui.confirm(
          '기존 Work 실행 여부 확인 필요',
          '이전 Work의 실행 중인 OS 프로세스를 확인할 수 없습니다. 다른 터미널에서 같은 세션이 실행 중이지 않은지 확인한 경우에만 재개하세요.\n\n세션: '+
          candidate.id.slice(0,16)+'\n작업 위치: '+preview.cwd);
        if(!approved)return {action:'handled'};
        allowUnconfirmedProcess=true;
      }
      if(ctx.sessionManager.getSessionId()!==callerId||
         ctx.sessionManager.getLeafId()!==leaf)
        return restore('세션/분기가 변경돼 Work 재개를 중단했습니다.');
      const anchorTerminalId=await getFocusedGhosttyTerminalId();
      const receipt=await resumeNativeWorkFromTerminal({
        sessionFile:candidate.file,sessionId:candidate.id,product:owner.product,
        anchorTerminalId,allowUnconfirmedProcess,
      });
      if(receipt.mode==='existing-surface-focused'){
        ctx.ui.notify('기존 Work가 열려 있는 Ghostty 터미널로 이동했습니다. 새 Pi를 실행하지 않았습니다.','info');
      }else{
        ctx.ui.notify('기존 Work ['+receipt.sessionId.slice(0,8)+
          ']를 Ghostty Split에서 재개하도록 요청했습니다. Pi 기동 여부는 아직 확인되지 않았습니다.','info');
      }
      return {action:'handled'};
    }catch(error){
      return restore('기존 Work 재개 실패 · 원래 세션 보존: '+String(error));
    }finally{inFlight=false;}
  });
}
