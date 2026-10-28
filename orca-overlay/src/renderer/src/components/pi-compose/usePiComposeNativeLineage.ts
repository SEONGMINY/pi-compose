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

  // A same-count replacement is still a different Orca owner. Never rely on
  // agents.length alone to invalidate the Pi-to-native session mapping.
  const agentIdentity = agents.map(agent =>
    agent.paneKey + ':' + agent.tab.id + ':' + agent.rowSource
  ).join('|')
  const tabIdentity = (tabs ?? []).filter(tab =>
    tab.contentType === 'agent-session' && tab.agentSessionAgent === 'pi'
  ).map(tab => tab.id + ':' + tab.entityId).join('|')

  useEffect(() => {
    if (!cwd || agents.length < 2) return
    let alive = true
    let requestEpoch = 0
    const refresh = () => {
      const epoch = ++requestEpoch
      void window.api.piCompose.list(cwd).then(records => {
        if (alive && epoch === requestEpoch) setSnapshot({ cwd, records })
      }).catch(() => {
        // Bad/unavailable relations must leave every native Orca row unchanged.
        if (alive && epoch === requestEpoch) setSnapshot({ cwd, records: [] })
      })
    }
    refresh()
    window.addEventListener('pi-compose:changed', refresh)
    return () => {
      alive = false
      requestEpoch += 1
      window.removeEventListener('pi-compose:changed', refresh)
    }
  }, [cwd, worktreeId, agentIdentity, tabIdentity, agents.length])

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
      // A metadata parentMainId alone cannot prove a Pi Fork. An unverified
      // Work remains accessible at its genuine Orca location, but is not
      // presented as the Main's proven conversation child.
      (record.role !== 'work' || (!record.hiddenFromMainAt && record.proof?.allMatch === true))
    )
    const byId = new Map(visible.map(record => [record.id, record]))
    for (const record of visible) {
      if (record.role === 'main') continue
      // Support owns an independent Pi transcript. A missing, hidden or
      // unverified related Work must not orphan it from its actual Main.
      const linkedWork = record.role === 'support' && record.relatedWorkId
        ? byId.get(record.relatedWorkId) : undefined
      const parent = linkedWork?.role === 'work'
        ? linkedWork : (record.parentMainId ? byId.get(record.parentMainId) : undefined)
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
