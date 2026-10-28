import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, GitFork, Layers3, Plus, RefreshCcw } from 'lucide-react'
import { useAppStore } from '@/store'
import { useActiveWorktree } from '@/store/selectors'
import { createNewTerminalTab } from '@/components/terminal/terminal-tab-create'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import {
  canMoveTabToNewPaneColumn,
  moveTabToNewPaneColumn
} from '@/components/tab-bar/tab-move-to-pane-column'
import type { PiComposeListRecord } from '../../../../preload/api/pi-compose-bridge'
import { openPreparedWorkNativeChat } from './PiComposeNativeChat'

function quote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}
function label(agent: PiComposeListRecord): string {
  return (agent.role === 'main' ? 'Main' : agent.role === 'work' ? 'Work' : 'Support') +
    ' · ' + agent.title.slice(0, 70)
}
function existingTab(agent: PiComposeListRecord) {
  if (!agent.orcaWorktreeId || !agent.orcaTabId) return null
  const state = useAppStore.getState()
  return (state.unifiedTabsByWorktree[agent.orcaWorktreeId] ?? [])
    .find(tab => tab.id === agent.orcaTabId && tab.contentType === 'terminal') ?? null
}

/**
 * An additional project-context section in Orca's EXISTING workspace sidebar.
 * It reads Pi Compose provenance, never guesses completion from the presence of a tab.
 * No parallel custom terminal renderer or custom worktree hierarchy is created.
 */
export function PiComposeOutline(): React.JSX.Element | null {
  const active = useActiveWorktree()
  const worktreeId = useAppStore(s => s.activeWorktreeId)
  // React to Orca tab moves/closes without restarting the underlying Pi process.
  useAppStore(s => s.unifiedTabsByWorktree)
  const [agents, setAgents] = useState<PiComposeListRecord[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [isLoading, setLoading] = useState(true)
  const cwd = active?.path ?? ''
  const refresh = useCallback(async () => {
    if (!cwd) { setAgents([]); return }
    setLoading(true)
    setAgents([])
    try {
      setAgents(await window.api.piCompose.list(cwd))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [cwd])
  useEffect(() => {
    void refresh()
    const changed = () => { void refresh() }
    window.addEventListener('pi-compose:changed', changed)
    return () => window.removeEventListener('pi-compose:changed', changed)
  }, [refresh])

  const mains = useMemo(() => agents.filter(a => a.role === 'main'), [agents])
  const showAgent = async (agent: PiComposeListRecord, split: boolean) => {
    if (!cwd || !worktreeId || busyId) return
    setBusyId(agent.id)
    setError('')
    try {
      if (agent.role === 'work') {
        let targetId = agent.orcaWorktreeId || worktreeId
        if (agent.workspace === 'worktree') {
          await useAppStore.getState().fetchAllWorktrees({ hydrationPurge: 'defer' })
          const target = useAppStore.getState().allWorktrees().find(item => item.path === agent.cwd)
          if (!target) throw new Error('Work의 Git Worktree가 Orca에 등록되지 않았습니다. 해당 폴더를 등록한 뒤 다시 열어주세요.')
          targetId = target.id
        }
        if (split && targetId !== worktreeId) throw new Error('다른 Worktree의 Native Chat을 현재 화면으로 분할할 수 없습니다.')
        if (activateAndRevealWorkspace(targetId) === false) throw new Error('Orca 작업 공간을 열 수 없습니다.')
        let orcaSessionId = agent.orcaSessionId
        if (!orcaSessionId) {
          // A failed prior Native Chat launch preserves the prepared Pi fork.
          // Recover by adopting it, never creating another Pi fork.
          orcaSessionId = await openPreparedWorkNativeChat(targetId, agent.sessionId)
          await window.api.piCompose.attachChat(cwd, agent.id, orcaSessionId, targetId)
          await refresh()
        }
        const chat = (useAppStore.getState().unifiedTabsByWorktree[targetId] ?? []).find(item =>
          item.contentType === 'agent-session' && item.entityId === orcaSessionId)
        if (!chat) throw new Error('연결된 Native Chat 탭이 보이지 않습니다. 중복 세션을 만들지 않고 Orca 세션 복원을 확인해 주세요.')
        useAppStore.getState().activateTab(chat.id, { worktreeId: targetId })
        if (split) {
          if (!canMoveTabToNewPaneColumn(chat.id, chat.groupId) ||
              !moveTabToNewPaneColumn({unifiedTabId: chat.id, groupId: chat.groupId, direction:'right'})) {
            throw new Error('이 Native Chat을 현재 레이아웃에서 분할할 수 없습니다.')
          }
        }
        return
      }
      let tab = existingTab(agent)
      let owningWorktree = agent.orcaWorktreeId
      if (!tab) {
        if (!agent.launcher || !agent.cwd) {
          throw new Error('이 Agent의 실행 정보가 없습니다. 기존 세션을 삭제하지 않았습니다.')
        }
        let targetId = worktreeId
        if (agent.workspace === 'worktree') {
          await useAppStore.getState().fetchAllWorktrees({ hydrationPurge: 'defer' })
          const target = useAppStore.getState().allWorktrees().find(item => item.path === agent.cwd)
          if (!target) {
            throw new Error('이 Agent의 실제 Git Worktree가 Orca 목록에 없습니다. 프로젝트에서 해당 폴더를 가져온 뒤 다시 열어주세요. 세션은 그대로 보존됩니다.')
          }
          targetId = target.id
        }
        if (activateAndRevealWorkspace(targetId) === false) {
          throw new Error('Orca 작업 공간을 열 수 없습니다. Pi 세션은 보존됩니다.')
        }
        // Launch the SAME Pi session (with the prepared script's one-shot guard),
        // never fork a second time when opening a row from the sidebar.
        const started = await new Promise<boolean>(resolve => {
          createNewTerminalTab(targetId,undefined,{
            startupCwd:agent.cwd,
            command:'sh ' + quote(agent.launcher!),
            onSettled:resolve
          })
        })
        if (!started) throw new Error('Orca 탭을 열지 못했습니다. Pi 세션은 보존됩니다.')
        owningWorktree=targetId
        tab=useAppStore.getState().getActiveTab(targetId)
        if (!tab || tab.contentType !== 'terminal') {
          throw new Error('열린 터미널의 식별자를 확인할 수 없습니다.')
        }
        useAppStore.getState().setTabCustomLabel(tab.id,label(agent))
        await window.api.piCompose.attach(cwd,agent.id,tab.id,targetId)
        await refresh()
      }
      if (!owningWorktree || !tab) throw new Error('기존 터미널 연결을 확인할 수 없습니다.')
      if (agent.workspace === 'worktree' &&
          !useAppStore.getState().allWorktrees().some(item =>
            item.id === owningWorktree && item.path === agent.cwd)) {
        throw new Error('이전 버전에서 Agent 탭이 다른 작업 공간에 연결됐습니다. 기존 탭은 유지하되 새 Pi 프로세스를 중복 시작하지 않습니다.')
      }
      if (split && owningWorktree !== worktreeId) {
        throw new Error('다른 Orca Worktree의 탭은 현재 화면으로 직접 옮길 수 없습니다. 먼저 해당 작업 공간으로 이동하세요.')
      }
      if (activateAndRevealWorkspace(owningWorktree) === false) {
        throw new Error('Orca 작업 공간을 열 수 없습니다. Pi 세션은 보존됩니다.')
      }
      useAppStore.getState().activateTab(tab.id,{worktreeId:owningWorktree})
      if (split) {
        const groupId=tab.groupId
        if (!canMoveTabToNewPaneColumn(tab.id,groupId) ||
            !moveTabToNewPaneColumn({unifiedTabId:tab.id,groupId,direction:'right'})) {
          throw new Error('이 탭은 현재 레이아웃에서 바로 분할할 수 없습니다. 다른 터미널을 연 뒤 탭 메뉴의 Move Tab to Split을 사용하세요.')
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyId(null)
    }
  }
  if (!cwd) return null
  return <section className="mx-2 mb-2 rounded-lg border border-worktree-sidebar-border bg-worktree-sidebar-foreground/4"
    aria-label="Pi Compose 프로젝트 Agent">
    <div className="flex items-center gap-1 border-b border-worktree-sidebar-border/60 px-2 py-2">
      <Layers3 className="size-3.5 text-worktree-sidebar-foreground/70"/>
      <strong className="min-w-0 flex-1 truncate text-xs">Pi Compose</strong>
      <button type="button" title="Agent 목록 다시 읽기" aria-label="Agent 새로고침"
        className="rounded p-1 hover:bg-worktree-sidebar-foreground/10"
        onClick={() => void refresh()} disabled={isLoading}><RefreshCcw className="size-3"/></button>
      <button type="button" title="새 Main, Work 또는 Support 만들기" aria-label="새 Agent 만들기"
        className="rounded p-1 hover:bg-worktree-sidebar-foreground/10"
        onClick={() => window.dispatchEvent(new Event('pi-compose:new'))}><Plus className="size-3.5"/></button>
    </div>
    {error && <div role="alert" className="mx-2 my-2 rounded-md border border-destructive/30 p-2 text-[11px] leading-relaxed text-destructive">{error}</div>}
    {isLoading && <p role="status" className="px-3 py-3 text-[11px] text-muted-foreground">Agent 목록 확인 중…</p>}
    {!isLoading && !error && mains.length===0 && <div className="px-3 py-3 text-[11px] leading-relaxed text-muted-foreground">
      <p>먼저 Main Agent에서 요구사항과 설계를 논의하세요.</p>
      <button type="button" className="mt-2 rounded-md border border-worktree-sidebar-border px-2 py-1.5 text-worktree-sidebar-foreground hover:bg-worktree-sidebar-foreground/10"
        onClick={() => window.dispatchEvent(new Event('pi-compose:new'))}>Main Agent 만들기</button>
    </div>}
    <div className="max-h-64 overflow-y-auto p-1">
      {mains.map(main=>{
        const children=agents.filter(agent=>agent.parentMainId===main.id)
        const expanded=collapsed[main.id] !== true
        return <div key={main.id} className="my-1 rounded-md border border-worktree-sidebar-border/60">
          <div className="flex min-w-0 items-center gap-1 px-1 py-1">
            <button type="button" className="rounded p-1" aria-label={expanded?'접기':'펼치기'}
              onClick={()=>setCollapsed(v=>({...v,[main.id]:!v[main.id]}))}>
              {expanded?<ChevronDown className="size-3"/>:<ChevronRight className="size-3"/>}
            </button>
            <button type="button" title={main.title}
              className="min-w-0 flex-1 truncate text-left text-xs font-semibold hover:underline"
              onClick={()=>void showAgent(main,false)}>
              {main.title}
            </button>
            <button type="button" className="shrink-0 rounded border border-worktree-sidebar-border px-1.5 py-0.5 text-[10px] hover:bg-worktree-sidebar-foreground/10"
              title="이 Main의 컨텍스트로 Work 준비"
              onClick={() => window.dispatchEvent(new CustomEvent('pi-compose:new', { detail: { role: 'work', mainId: main.id } }))}>Work 만들기</button>
            <span className="text-[10px] text-muted-foreground">Main</span>
          </div>
          {expanded && <div className="pb-1 pl-4 pr-1">
            {children.map(child=><div key={child.id} className="group flex items-center gap-1 rounded-md py-1 hover:bg-worktree-sidebar-foreground/10">
              <span title={child.role==='work'?'정확한 Main Fork':'독립 Pi 세션'} className="shrink-0 text-[10px] text-muted-foreground">
                {child.role==='work'?<GitFork className="size-3"/>:'S'}
              </span>
              <button type="button" title={child.relatedWorkId ? child.title + ' · Work 연결됨' : child.title}
                className="min-w-0 flex-1 truncate text-left text-[11px]"
                onClick={()=>void showAgent(child,false)}>
                {child.title}
              </button>
              {child.role === 'work' && <button type="button"
                className="shrink-0 rounded border border-worktree-sidebar-border px-1.5 py-0.5 text-[10px] hover:bg-worktree-sidebar-foreground/10"
                title="이 Work를 돕는 독립 Support 준비"
                onClick={() => window.dispatchEvent(new CustomEvent('pi-compose:new', {
                  detail: { role: 'support', mainId: main.id, relatedWorkId: child.id }
                }))}>Support</button>}
              <button type="button" className="shrink-0 rounded border border-worktree-sidebar-border px-1.5 py-0.5 text-[10px] opacity-80 hover:opacity-100 disabled:opacity-30"
                title={child.orcaWorktreeId===worktreeId && existingTab(child) &&
                  canMoveTabToNewPaneColumn(child.orcaTabId!, existingTab(child)!.groupId)
                  ? '실행 중인 기존 탭을 오른쪽으로 분할'
                  : '이 작업 공간의 탭을 둘 이상 연 뒤, Orca 탭을 드래그하거나 분할 메뉴를 사용하세요'}
                onClick={()=>void showAgent(child,true)}
                disabled={busyId===child.id || child.orcaWorktreeId!==worktreeId ||
                  !existingTab(child) ||
                  !canMoveTabToNewPaneColumn(child.orcaTabId!,existingTab(child)!.groupId)}>분할</button>
            </div>)}
            {children.length===0 && <p className="p-1 text-[10px] text-muted-foreground">Work/Support 없음 · +에서 만들기</p>}
          </div>}
        </div>
      })}
    </div>
    <p className="px-2 pb-2 text-[10px] leading-relaxed text-muted-foreground">
      Main은 원본 대화 · Work는 완료 지점 Fork · Support는 독립 세션
    </p>
  </section>
}
