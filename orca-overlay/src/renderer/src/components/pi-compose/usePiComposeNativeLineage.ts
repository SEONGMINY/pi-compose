import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import type { PiComposeListRecord } from '../../../../preload/api/pi-compose-bridge'

/**
 * Pi context ancestry is separate from Orca's worktree and orchestration ancestry.
 * Only project the relation when BOTH genuine Pi sessions have visible native
 * Agent rows in the SAME Orca worktree. Never invent status rows, pane keys,
 * or a different execution/activation target.
 */
export function usePiComposeNativeLineage(
  worktreeId: string,
  agents: readonly DashboardAgentRow[]
): ReadonlyMap<string, string> {
  const cwd = useAppStore(s => s.getKnownWorktreeById(worktreeId)?.path ?? '')
  const tabs = useAppStore(s => s.unifiedTabsByWorktree[worktreeId])
  const [snapshot, setSnapshot] = useState<{
    cwd: string
    records: PiComposeListRecord[]
  }>({ cwd: '', records: [] })

  useEffect(() => {
    if (!cwd || agents.length < 2) return
    let alive = true
    const refresh = () => {
      void window.api.piCompose.list(cwd).then(records => {
        if (alive) setSnapshot({ cwd, records })
      }).catch(() => {
        // Bad/unavailable relations must leave every native Orca row unchanged.
        if (alive) setSnapshot({ cwd, records: [] })
      })
    }
    refresh()
    window.addEventListener('pi-compose:changed', refresh)
    return () => {
      alive = false
      window.removeEventListener('pi-compose:changed', refresh)
    }
  }, [cwd, worktreeId, agents.length])

  return useMemo(() => {
    const parents = new Map<string, string>()
    if (snapshot.cwd !== cwd || !tabs || agents.length < 2) return parents

    const sessionByTabId = new Map<string, string>()
    for (const tab of tabs) {
      if (tab.contentType === 'agent-session' &&
          tab.agentSessionAgent === 'pi' && tab.entityId) {
        sessionByTabId.set(tab.id, tab.entityId)
      }
    }
    const paneBySessionId = new Map<string, string>()
    for (const agent of agents) {
      // Synthetic subagent rows are part of Orca's own tool execution tree.
      if (agent.rowSource === 'subagent') continue
      const sessionId = sessionByTabId.get(agent.tab.id)
      if (sessionId && !paneBySessionId.has(sessionId)) {
        paneBySessionId.set(sessionId, agent.paneKey)
      }
    }
    const visible = snapshot.records.filter(record =>
      record.orcaWorktreeId === worktreeId &&
      record.orcaSessionId &&
      (record.role !== 'work' || !record.hiddenFromMainAt)
    )
    const byId = new Map(visible.map(record => [record.id, record]))
    for (const record of visible) {
      if (record.role === 'main') continue
      const parentId = record.role === 'support' && record.relatedWorkId
        ? record.relatedWorkId : record.parentMainId
      const parent = parentId ? byId.get(parentId) : undefined
      const childPane = paneBySessionId.get(record.orcaSessionId!)
      const parentPane = parent?.orcaSessionId
        ? paneBySessionId.get(parent.orcaSessionId) : undefined
      if (childPane && parentPane && childPane !== parentPane) {
        parents.set(childPane, parentPane)
      }
    }
    return parents
  }, [agents, cwd, snapshot, tabs, worktreeId])
}
