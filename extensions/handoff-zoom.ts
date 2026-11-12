import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { toggleFocusedGhosttySplitZoom } from '../src/ghostty-native.ts';

type ToggleResult='toggled'|'not-focused'|'single-terminal'|'unavailable';
type Toggle=(terminalId:string)=>Promise<ToggleResult>;

/**
 * Ghostty has an exact-target toggle action but NO read-only zoom state.
 * Do not blindly zoom on <; an already zoomed user split would be unzoomed.
 *
 * One explicit Alt+Z toggles the focused Compose-owned split. We only try
 * restoring if OUR toggle completed successfully and the dialog is closing.
 * If focus moves elsewhere, Ghostty refuses the action (no surprise jump).
 * No osascript / window action is required for normal Handoff operation.
 */
export function createHandoffZoomController(
  terminalId:string|undefined,
  toggle:Toggle=toggleFocusedGhosttySplitZoom,
):{
  toggle:()=>Promise<string>;
  close:()=>Promise<string|undefined>;
  state:()=>string;
}{
  let owned=false;
  let closing=false;
  let running:Promise<string>|undefined;
  let state=terminalId?'Alt+Z: Ghostty Split 확대/복원':'Split 확대 사용 불가 · 기존 검토 화면 유지';
  async function perform():Promise<string>{
    if(!terminalId)return state;
    const result=await toggle(terminalId);
    if(result==='toggled'){
      owned=!owned;
      return owned
        ?'Ghostty Split 전환 완료 · 종료 시 되돌리기 시도'
        :'Ghostty Split 원래 상태로 전환됨';
    }
    if(result==='not-focused')return '현재 Work/Main Split에 포커스가 없어 변경하지 않았습니다.';
    if(result==='single-terminal')return '현재 탭에 Split이 한 개뿐이어서 확대하지 않았습니다.';
    return 'Ghostty에서 확대를 지원하지 않아 기존 화면을 사용합니다.';
  }
  return {
    state:()=>state,
    toggle(){
      if(closing)return Promise.resolve('검토를 종료하는 중이라 화면을 변경하지 않습니다.');
      if(running)return running;
      const pending=perform().catch(error=>
        'Ghostty 화면 전환 실패 · 기존 검토 유지: '+String(error));
      running=pending.then(message=>{
        state=message;
        return message;
      }).finally(()=>{running=undefined;});
      return running;
    },
    async close(){
      closing=true;
      if(running)await running;
      if(!owned||!terminalId)return undefined;
      // Only a successful, exact-focus action can undo OUR earlier toggle.
      // A user switching tabs/windows never causes another surface to zoom.
      try{
        const result=await toggle(terminalId);
        if(result==='toggled'){owned=false;return undefined;}
        return '검토 종료 후 Split 복원 필요: Ghostty에서 해당 화면으로 돌아가 확대를 해제해주세요.';
      }catch{
        return '검토 종료 후 Split 복원 필요: Ghostty에서 해당 화면으로 돌아가 확대를 해제해주세요.';
      }
    },
  };
}

export function zoomForAgent(ctx:ExtensionContext){
  const identity=readAgentRelationship(
    ctx.sessionManager.getSessionId(),ctx.sessionManager.getEntries());
  return createHandoffZoomController(identity?.terminalId);
}
