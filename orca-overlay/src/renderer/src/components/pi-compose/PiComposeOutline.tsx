import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, GitFork, MessageSquare, Plus, RefreshCcw } from 'lucide-react'
import { useAppStore } from '@/store'
import { createNewTerminalTab } from '@/components/terminal/terminal-tab-create'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import {
  canMoveTabToNewPaneColumn,
  moveTabToNewPaneColumn
} from '@/components/tab-bar/tab-move-to-pane-column'
import type { PiComposeListRecord } from '../../../../preload/api/pi-compose-bridge'
import { openPreparedWorkNativeChat } from './PiComposeNativeChat'
import { appendToNativeChatComposerDraft, structuredAgentSessionDraftScopeKey,
  nativeChatComposerDraftWriteSettled } from '@/components/native-chat/native-chat-composer-draft-store'

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
export function PiComposeOutline({ projectCwd, projectWorktreeId }: {
  projectCwd: string
  projectWorktreeId: string
}): React.JSX.Element | null {
  const worktreeId = projectWorktreeId
  // React to Orca tab moves/closes without restarting the underlying Pi process.
  useAppStore(s => s.unifiedTabsByWorktree)
  const [agents, setAgents] = useState<PiComposeListRecord[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [isLoading, setLoading] = useState(true)
  const cwd = projectCwd
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
  const prepareSupportDraftForWork = async (support: PiComposeListRecord) => {
    if (!cwd || busyId || !support.relatedWorkId) return
    setBusyId(support.id)
    setError('')
    try {
      // Read an actual completed Pi response. Do not infer test pass/fail from
      // terminal status, or automatically summarize unseen output.
      const result = await window.api.piCompose.supportResult(cwd, support.id)
      const work = agents.find(agent =>
        agent.id === result.relatedWorkId && agent.role === 'work')
      if (!work || !work.orcaSessionId || !work.orcaWorktreeId) {
        throw new Error('먼저 연결된 Work를 Orca Native Chat에서 열어 주세요. Support 결과는 보존됩니다.')
      }
      const text = [
        '[Support 결과 · ' + result.supportTitle + ']',
        result.text,
        result.truncated ? '(긴 응답의 일부만 포함됨. Support 원본 대화에서 전체 내용 확인)' : '',
        'Support 세션: ' + result.sessionId,
        '필요한 부분을 검토하고 수정 지시를 작성해 주세요.'
      ].filter(Boolean).join('\n\n')
      const scope = structuredAgentSessionDraftScopeKey(work.orcaSessionId)
      const appended = appendToNativeChatComposerDraft(scope, { text })
      const persisted = await nativeChatComposerDraftWriteSettled(scope)
      if (!appended || !persisted) {
        throw new Error('Work 입력 초안을 저장하지 못했습니다. 결과를 복사해 직접 전달해 주세요.')
      }
      if (activateAndRevealWorkspace(work.orcaWorktreeId) === false) {
        throw new Error('Work 초안은 저장됐지만 작업 공간을 열 수 없습니다. 해당 Work에서 직접 확인해 주세요.')
      }
      const tab = (useAppStore.getState().unifiedTabsByWorktree[work.orcaWorktreeId] ?? [])
        .find(item => item.contentType === 'agent-session' &&
          item.entityId === work.orcaSessionId)
      if (!tab) throw new Error('Work 초안은 저장됐지만 Native Chat 탭을 찾지 못했습니다.')
      useAppStore.getState().activateTab(tab.id, { worktreeId: work.orcaWorktreeId })
      // No agentSession.send, terminal.send or prompt submission. The user owns Send.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyId(null)
    }
  }
  const openCreate = (detail: { role?: 'main' | 'work' | 'support'; mainId?: string; relatedWorkId?: string }) => {
    window.dispatchEvent(new CustomEvent('pi-compose:new', {
      detail: { ...detail, projectCwd: cwd, projectWorktreeId }
    }))
  }
  const renderRow = (agent: PiComposeListRecord, depth: number): React.JSX.Element => {
    const isWork = agent.role === 'work'
    const isSupport = agent.role === 'support'
    const connectionFailed = isWork && agent.state === 'connection-error'
    const title = [
      agent.role === 'main' ? 'Main' : isWork ? 'Work' : 'Support',
      agent.title,
      ...(agent.workspace === 'worktree' ? ['별도 Worktree'] : [])
    ].join(' · ')
    return <div key={agent.id} className="group flex min-w-0 items-center gap-1 rounded-md py-1 hover:bg-worktree-sidebar-foreground/10"
      style={{ paddingLeft: depth * 14 }}>
      {agent.role === 'main' ? <MessageSquare className="size-3 shrink-0 text-muted-foreground"/>
        : isWork ? <GitFork className="size-3 shrink-0 text-muted-foreground"/>
          : <span className="shrink-0 text-[10px] text-muted-foreground">S</span>}
      <button type="button"
        className="min-w-0 flex-1 truncate text-left text-[11px] hover:underline"
        title={title}
        onClick={() => void showAgent(agent,false)}>
        {agent.title}
        {connectionFailed ? <span className="ml-1 text-destructive">(연결 실패)</span> : null}
      </button>
      {!isSupport ? <button type="button" title="Agent 추가"
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-worktree-sidebar-foreground/10 hover:text-foreground"
        onClick={() => openCreate(agent.role === 'main'
          ? { role: 'work', mainId: agent.id }
          : { role: 'support', mainId: agent.parentMainId ?? undefined, relatedWorkId: agent.id })}>
        + Agent
      </button> : null}
      {isSupport && agent.relatedWorkId ? <button type="button"
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] hover:bg-worktree-sidebar-foreground/10 disabled:opacity-30"
        title="완료된 Support 결과를 Work 입력 초안에 추가 (전송 안 함)"
        disabled={busyId!==null}
        onClick={() => void prepareSupportDraftForWork(agent)}>보내기</button> : null}
    </div>
  }
  // Render inside Orca's real project checkout row rather than a duplicate
  // "Pi Compose" panel. Logical parent is always Main, never the Git worktree.
  return <div className="px-2 pb-1 pt-1" data-pi-compose-context="" aria-label="프로젝트의 Main Work Support Agent"
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onPointerDown={event => event.stopPropagation()}
    onDragStart={event => event.stopPropagation()}>
    {error ? <div role="alert" className="my-1 rounded border border-destructive/40 p-2 text-[11px] text-destructive">{error}</div> : null}
    {isLoading && !agents.length ? <div className="py-1 text-[11px] text-muted-foreground">Agent 확인 중…</div> : null}
    {mains.map(main => {
      const works = agents.filter(a => a.role === 'work' && a.parentMainId === main.id)
      const support = agents.filter(a => a.role === 'support' && a.parentMainId === main.id)
      const expanded = collapsed[main.id] !== true
      return <div key={main.id}>
        <div className="flex min-w-0 items-center gap-0.5">
          <button type="button" title={expanded ? '접기' : '펼치기'}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-worktree-sidebar-foreground/10"
            onClick={() => setCollapsed(prev => ({...prev, [main.id]: !prev[main.id]}))}>
            {expanded ? <ChevronDown className="size-3"/> : <ChevronRight className="size-3"/>}
          </button>
          <div className="min-w-0 flex-1">{renderRow(main, 0)}</div>
        </div>
        {expanded ? <div className="pl-4">
          {works.map(work => <React.Fragment key={work.id}>
            {renderRow(work, 1)}
            {support.filter(s => s.relatedWorkId === work.id).map(s => renderRow(s,2))}
          </React.Fragment>)}
          {support.filter(s => !s.relatedWorkId || !works.some(w => w.id === s.relatedWorkId))
            .map(s => renderRow(s,1))}
        </div> : null}
      </div>
    })}
    {mains.length===0 && !isLoading ? <button type="button"
      className="rounded px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-worktree-sidebar-foreground/10"
      onClick={() => openCreate({ role: 'main' })}>+ Agent</button> : null}
  </div>
}
