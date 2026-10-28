import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, GitFork, MessageSquare, Plus, RefreshCcw } from 'lucide-react'
import { useAppStore } from '@/store'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import type { PiComposeListRecord } from '../../../../preload/api/pi-compose-bridge'
import { openPreparedPiNativeChat, reopenPiNativeChat } from './PiComposeNativeChat'
import { activateStructuredAgentSessionById } from '@/lib/agent-session/structured-agent-session-tab-activation'
import { refreshLocalStructuredSessionWorktreeTabs } from '@/runtime/local-structured-session-tabs-sync/inventory-refresh'
import { appendToNativeChatComposerDraft, structuredAgentSessionDraftScopeKey,
  nativeChatComposerDraftWriteSettled } from '@/components/native-chat/native-chat-composer-draft-store'

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
  const tabCatalog = useAppStore(s => s.unifiedTabsByWorktree)
  const activeTabIdByWorktree = useAppStore(s => s.activeTabIdByWorktree)
  const activeWorktreeId = useAppStore(s => s.activeWorktreeId)
  const [agents, setAgents] = useState<PiComposeListRecord[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [isLoading, setLoading] = useState(true)
  const cwd = projectCwd
  const refresh = useCallback(async () => {
    if (!cwd) { setAgents([]); return }
    setLoading(true)
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
  const showAgent = async (agent: PiComposeListRecord) => {
    if (!cwd || !worktreeId || busyId) return
    setBusyId(agent.id)
    setError('')
    try {
      let targetId = agent.orcaWorktreeId || worktreeId
      if (agent.workspace === 'worktree') {
        await useAppStore.getState().fetchAllWorktrees({ hydrationPurge: 'defer' })
        const target = useAppStore.getState().allWorktrees().find(item => item.path === agent.cwd)
        if (!target) throw new Error('Agent의 Git 작업 폴더가 Orca에 등록되지 않았습니다. Pi 대화는 보존됩니다.')
        targetId = target.id
      }
      if (activateAndRevealWorkspace(targetId) === false) {
        throw new Error('작업 공간을 열지 못했습니다. 기존 Pi 기록은 그대로 보존됩니다.')
      }

      if (!agent.sessionFile) {
        throw new Error('Pi 원본 파일을 확인할 수 없어 Native Chat을 연결할 수 없습니다.')
      }
      let orcaSessionId = agent.orcaSessionId
      if (orcaSessionId) {
        // A closed tab is not proof that its Orca host record is gone.
        // Reveal first; re-adopt only when that host confirms it is gone.
        const reopened = await reopenPiNativeChat(targetId, agent.sessionId, orcaSessionId)
        orcaSessionId = reopened.sessionId
        if (reopened.replacedClosed) {
          await window.api.piCompose.attachChat(cwd, agent.id, orcaSessionId, targetId, agent.sessionId, agent.sessionFile, true)
          window.dispatchEvent(new Event('pi-compose:changed'))
        }
      } else {
        const legacyTerminal = agent.orcaTabId &&
          (useAppStore.getState().unifiedTabsByWorktree[targetId] ?? []).some(tab =>
            tab.id === agent.orcaTabId && tab.contentType === 'terminal')
        if (legacyTerminal) {
          throw new Error('기존 Pi TUI가 아직 Orca 터미널에 열려 있습니다. 해당 Pi에서 /exit 후 탭을 닫고 다시 선택하면 Native Chat으로 전환합니다.')
        }
        // Existing legacy TUI Main/Support is never launched a second time
        // behind the user's back. Pi/Orca will refuse a second active writer.
        orcaSessionId = await openPreparedPiNativeChat(targetId, agent.sessionId)
        await window.api.piCompose.attachChat(cwd, agent.id, orcaSessionId, targetId, agent.sessionId, agent.sessionFile)
        window.dispatchEvent(new Event('pi-compose:changed'))
      }

      // A session's host owns its tab. Let Orca synchronize the host-published
      // tab rather than creating our own tab or another Pi session.
      if (!activateStructuredAgentSessionById({ worktreeId: targetId, sessionId: orcaSessionId })) {
        await refreshLocalStructuredSessionWorktreeTabs(targetId)
        if (!activateStructuredAgentSessionById({ worktreeId: targetId, sessionId: orcaSessionId })) {
          throw new Error('기존 Chat은 보존됐지만 탭 표시를 복원하지 못했습니다. Orca 세션 목록을 새로고침해 주세요.')
        }
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      if (!agent.orcaSessionId) {
        await window.api.piCompose.connectionFailed(cwd, agent.id, message).catch(() => {})
        window.dispatchEvent(new Event('pi-compose:changed'))
      }
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
    const owner = agent.orcaWorktreeId || worktreeId
    const activeTab = activeWorktreeId === owner
      ? (tabCatalog[owner] ?? []).find(tab => tab.id === activeTabIdByWorktree[owner]) ??
        useAppStore.getState().getActiveTab(owner)
      : null
    const selected = Boolean(activeTab && (
      (agent.orcaSessionId && activeTab.contentType === 'agent-session' && activeTab.entityId === agent.orcaSessionId) ||
      (agent.orcaTabId && activeTab.id === agent.orcaTabId)
    ))
    const isWork = agent.role === 'work'
    const isSupport = agent.role === 'support'
    const connectionFailed = agent.state === 'connection-error'
    const title = [
      agent.role === 'main' ? 'Main' : isWork ? 'Work' : 'Support',
      agent.title,
      ...(agent.workspace === 'worktree' ? ['별도 Worktree'] : [])
    ].join(' · ')
    return <div key={agent.id} aria-current={selected ? 'page' : undefined}
      className={'group flex min-w-0 items-center gap-1 rounded-md py-1 hover:bg-worktree-sidebar-foreground/10 ' +
        (selected ? 'bg-worktree-sidebar-accent font-medium text-worktree-sidebar-accent-foreground ring-1 ring-worktree-sidebar-ring/40' : '')}
      style={{ paddingLeft: depth * 14 }}>
      {agent.role === 'main' ? <MessageSquare className="size-3 shrink-0 text-muted-foreground"/>
        : isWork ? <GitFork className="size-3 shrink-0 text-muted-foreground"/>
          : <span className="shrink-0 text-[10px] text-muted-foreground">S</span>}
      <button type="button"
        className="min-w-0 flex-1 truncate text-left text-[11px] hover:underline"
        title={title}
        onClick={() => void showAgent(agent)}>
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
