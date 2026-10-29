import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useNow } from '@/hooks/use-now'
import DashboardAgentRow from '@/components/dashboard/DashboardAgentRow'
import { CompactAgentRow } from '../sidebar/worktree-card-compact-agents'
import { useWorktreeAgentRows } from '../sidebar/useWorktreeAgentRows'
import { useFocusedAgentPaneKey } from '../sidebar/focused-agent-row-highlight'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { activateStructuredAgentSessionTab } from '@/lib/agent-session/structured-agent-session-tab-activation'
import type { DashboardAgentRow as NativeAgentRow } from '@/components/dashboard/useDashboardData'
import type { PiComposeListRecord } from '../../../../preload/api/pi-compose-bridge'

export type LinkedNativeWorkRef = Pick<PiComposeListRecord,
  'id' | 'title' | 'parentMainId' | 'orcaSessionId' | 'orcaWorktreeId' | 'role'>

/**
 * A read-only reference to an Orca-owned Agent row in another Worktree.
 * No synthetic AgentStatus, fake paneKey, or replacement renderer.
 */
export function usePiComposeCrossWorktreeAgentRefs(
  worktreeId: string,
  agents: readonly NativeAgentRow[]
): ReadonlyMap<string, LinkedNativeWorkRef[]> {
  const cwd = useAppStore(state => state.getKnownWorktreeById(worktreeId)?.path ?? '')
  const tabs = useAppStore(state => state.unifiedTabsByWorktree[worktreeId])
  const [snapshot,setSnapshot] = useState<{cwd:string;records:PiComposeListRecord[]}>({
    cwd:'',records:[]
  })
  useEffect(() => {
    if (!cwd || agents.length === 0) return
    let alive = true
    const reload = () => void window.api.piCompose.list(cwd).then(records => {
      if (alive) setSnapshot({cwd,records})
    }).catch(() => {
      if (alive) setSnapshot({cwd,records:[]})
    })
    reload()
    window.addEventListener('pi-compose:changed',reload)
    return () => {
      alive = false
      window.removeEventListener('pi-compose:changed',reload)
    }
  }, [cwd,worktreeId,agents.length])
  return useMemo(() => {
    const byPane = new Map<string,LinkedNativeWorkRef[]>()
    if (!tabs || cwd !== snapshot.cwd) return byPane
    const sessionByTabId = new Map(tabs.filter(tab =>
      tab.contentType === 'agent-session' && tab.agentSessionAgent === 'pi'
    ).map(tab => [tab.id,tab.entityId]))
    const rootRecords = snapshot.records.filter(record =>
      record.role === 'main' && record.orcaWorktreeId === worktreeId &&
      Boolean(record.orcaSessionId)
    )
    for (const main of rootRecords) {
      const parent = agents.find(agent =>
        sessionByTabId.get(agent.tab.id) === main.orcaSessionId &&
        agent.rowSource !== 'subagent'
      )
      if (!parent) continue
      const linked = snapshot.records.filter(record =>
        record.role === 'work' && record.parentMainId === main.id &&
        record.orcaSessionId && record.orcaWorktreeId &&
        record.orcaWorktreeId !== worktreeId && !record.hiddenFromMainAt
      ).slice(0,20)
      if (linked.length) byPane.set(parent.paneKey,linked)
    }
    return byPane
  },[agents,cwd,snapshot,tabs,worktreeId])
}

/**
 * Render Orca's original Agent row, with native status sourced from its actual
 * Worktree. Activation routes to the real owner; dismissal only hides this
 * linked view, never stops or deletes the native Agent.
 */
export function PiComposeCrossWorktreeAgentRef({
  refRecord, cwd, mainId, compact
}:{
  refRecord:LinkedNativeWorkRef
  cwd:string
  mainId:string
  compact:boolean
}):React.JSX.Element|null {
  const worktreeId=refRecord.orcaWorktreeId ?? ''
  const rows=useWorktreeAgentRows(worktreeId, Boolean(worktreeId))
  const tabs=useAppStore(state=>state.unifiedTabsByWorktree[worktreeId])
  const focused=useFocusedAgentPaneKey(worktreeId)
  const now=useNow(30_000)
  const selected=useMemo(()=>{
    const sessionTab=tabs?.find(tab =>
      tab.contentType==='agent-session' && tab.agentSessionAgent==='pi' &&
      tab.entityId===refRecord.orcaSessionId
    )
    return sessionTab ? rows.find(row => row.tab.id === sessionTab.id &&
      row.rowSource !== 'subagent') : undefined
  },[rows,tabs,refRecord.orcaSessionId])
  const activate=useCallback((tabId:string)=>{
    if (activateAndRevealWorkspace(worktreeId)===false) {
      toast.error('Work의 원래 Orca 작업 공간을 열 수 없습니다.')
      return
    }
    if (!activateStructuredAgentSessionTab({worktreeId,tabId})) {
      toast.error('Orca Work 대화가 닫혀 있습니다. 원래 작업 공간의 History에서 다시 열어 주세요.')
    }
  },[worktreeId])
  const dismiss=useCallback(()=>{
    void window.api.piCompose.setWorkMainVisibility(cwd,mainId,refRecord.id,true).then(()=>{
      window.dispatchEvent(new Event('pi-compose:changed'))
    }).catch(error=>toast.error(error instanceof Error?error.message:'Work 숨김 실패'))
  },[cwd,mainId,refRecord.id])
  if (!selected) return null
  return compact
    ? <CompactAgentRow agent={selected} now={now}
        onActivate={(tabId)=>activate(tabId)}
        onDismiss={dismiss}
        hasParentAgent
        isFocusedPane={focused===selected.paneKey} />
    : <DashboardAgentRow agent={selected} now={now}
        onDismiss={dismiss}
        onActivate={(tabId)=>activate(tabId)}
        isFocusedPane={focused===selected.paneKey}
        stateDotSize="sm"
        hideExpand hideLineageConnectors />
}
