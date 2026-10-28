import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'

/**
 * Preserve Orca's original New Workspace button and its shortcut/tour.
 * Pi Compose never replaces an upstream action with a new private launcher.
 * Minimal reversible overlay on a pinned original Orca checkout.
 * Fail closed if upstream changes; never overwrite user's own edits.
 * Orca source and LICENSE remain the real app.
 */
const patches = [
  {
    path: 'src/main/startup/main-process-ipc-bootstrap.ts',
    before: "import { ipcMain } from 'electron'",
    after: "import { ipcMain } from 'electron'\nimport { registerPiComposeIpc } from '../pi-compose-ipc'",
    secondBefore: 'export function registerMainProcessIpcHandlers(): void {\n',
    secondAfter: 'export function registerMainProcessIpcHandlers(): void {\n  registerPiComposeIpc()\n'
  },
  {
    path: 'src/preload/index.ts',
    before: "import { contextBridge, ipcRenderer } from 'electron'",
    after: "import { contextBridge, ipcRenderer } from 'electron'\nimport { piComposeApi } from './api/pi-compose-bridge'",
    secondBefore: '  plugins: pluginsApi,',
    secondAfter: '  plugins: pluginsApi,\n  piCompose: piComposeApi,'
  },
  {
    path: 'src/preload/api-types.ts',
    before: "import type { PluginsApi } from './api/plugin-host-api'",
    after: "import type { PluginsApi } from './api/plugin-host-api'\nimport type { PiComposeApi } from './api/pi-compose-bridge'",
    secondBefore: '  plugins: PluginsApi',
    secondAfter: '  plugins: PluginsApi\n  piCompose: PiComposeApi'
  },
  {
    path: 'src/renderer/src/components/sidebar/sidebar-header-actions.tsx',
    before: "import React, { useCallback } from 'react'",
    after: "import React, { useCallback } from 'react'\nimport { PiComposeMenu } from '../pi-compose/PiComposeMenu'",
    secondBefore: '      <NewWorkspaceButton preserveWorkspaceBoardOpen />',
    secondAfter: '      <PiComposeMenu />\n      <NewWorkspaceButton preserveWorkspaceBoardOpen />'
  }
  ,{
    path: 'src/renderer/src/components/sidebar/WorktreeContextMenuView.tsx',
    before: "          <WorktreeStatusMenuItems",
    after: "          {!isMultiContext && !isDeleting ? (\n            <DropdownMenuItem onSelect={() => {\n              window.dispatchEvent(new CustomEvent('pi-compose:new', {\n                detail: { projectCwd: worktree.path, projectWorktreeId: worktree.id }\n              }))\n            }}>\n              <Workflow className=\"size-3.5\" />\n              Pi Compose Agent 만들기…\n            </DropdownMenuItem>\n          ) : null}\n          <WorktreeStatusMenuItems",
    secondBefore: "  const deleteShortcut = useOptionalShortcutLabel('workspace.delete')",
    secondAfter: "  const deleteShortcut = useOptionalShortcutLabel('workspace.delete')\n  // Native Workspace menu owns lifecycle; Compose only adds creation context."
  }
  ,{
    path: 'src/renderer/src/components/native-chat/use-native-chat-context-menu.tsx',
    before: "  const keybindings = useAppStore((s) => s.keybindings)",
    after: "  const keybindings = useAppStore((s) => s.keybindings)\n  const composeChat = useAppStore((s) => chatPane\n    ? s.unifiedTabsByWorktree[chatPane.worktreeId]?.find(tab => tab.id === chatPane.tabId)\n    : undefined)\n  const composeWorktree = useAppStore((s) => chatPane ? s.getKnownWorktreeById(chatPane.worktreeId) : null)\n  type LinkedWork = { id: string; title: string; mainId: string; hidden: boolean }\n  const [composeMainId, setComposeMainId] = useState<string | null>(null)\n  const [composeLinkedWorks, setComposeLinkedWorks] = useState<LinkedWork[]>([])\n  const [composeCurrentWork, setComposeCurrentWork] = useState<LinkedWork | null>(null)\n  useEffect(() => {\n    const sessionId = composeChat?.contentType === 'agent-session' && composeChat.agentSessionAgent === 'pi'\n      ? composeChat.entityId : null\n    if (!enabled || !state.open || !sessionId || !composeWorktree?.path) {\n      setComposeMainId(null)\n      setComposeLinkedWorks([])\n      setComposeCurrentWork(null)\n      return\n    }\n    let current = true\n    void window.api.piCompose.list(composeWorktree.path).then(records => {\n      if (!current) return\n      const main = records.find(record => record.role === 'main' && record.orcaSessionId === sessionId)\n      const work = records.find(record => record.role === 'work' && record.orcaSessionId === sessionId)\n      setComposeMainId(main?.id ?? null)\n      setComposeLinkedWorks(main ? records.filter(record =>\n        record.role === 'work' && record.parentMainId === main.id\n      ).map(record => ({\n        id:record.id, title:record.title, mainId:main.id,\n        hidden:Boolean(record.hiddenFromMainAt)\n      })) : [])\n      setComposeCurrentWork(work && work.parentMainId ? {\n        id:work.id, title:work.title, mainId:work.parentMainId,\n        hidden:Boolean(work.hiddenFromMainAt)\n      } : null)\n    }).catch(() => {\n      if (current) {\n        setComposeMainId(null)\n        setComposeLinkedWorks([])\n        setComposeCurrentWork(null)\n      }\n    })\n    return () => { current = false }\n  }, [enabled, state.open, composeChat?.entityId, composeChat?.agentSessionAgent, composeWorktree?.path])\n  const changeWorkVisibility = async (work: LinkedWork): Promise<void> => {\n    if (!composeWorktree?.path) return\n    const hidden = !work.hidden\n    try {\n      await window.api.piCompose.setWorkMainVisibility(composeWorktree.path, work.mainId, work.id, hidden)\n      setComposeLinkedWorks(works => works.map(item =>\n        item.id === work.id ? { ...item, hidden } : item))\n      setComposeCurrentWork(item => item?.id === work.id ? { ...item, hidden } : item)\n      window.dispatchEvent(new Event('pi-compose:changed'))\n      toast.success(hidden ? 'Main 목록에서 이 Work만 제거했습니다. 대화와 작업 파일은 보존됩니다.' : 'Main 목록에 Work를 다시 표시합니다.')\n    } catch (error) {\n      toast.error(error instanceof Error ? error.message : 'Work 연결 변경 실패')\n    }\n  }\n",
    secondBefore: "          {chatPane ? (",
    secondAfter: "          {composeMainId && chatPane && composeWorktree ? (\n            <DropdownMenuItem onSelect={() => {\n              window.dispatchEvent(new CustomEvent('pi-compose:new', {\n                detail: {\n                  role: 'work', mainId: composeMainId,\n                  projectCwd: composeWorktree.path, projectWorktreeId: chatPane.worktreeId\n                }\n              }))\n            }}>\n              <GitFork className=\"size-3.5\" />\n              이 Main에서 Work 만들기…\n            </DropdownMenuItem>\n          ) : null}\n          {composeMainId && composeLinkedWorks.length > 0 ? (\n            <DropdownMenuSub>\n              <DropdownMenuSubTrigger>연결된 Work 관리</DropdownMenuSubTrigger>\n              <DropdownMenuSubContent className=\"w-64\">\n                {composeLinkedWorks.map(work => (\n                  <DropdownMenuItem key={work.id} onSelect={() => void changeWorkVisibility(work)}>\n                    <span className=\"max-w-40 truncate\">{work.title}</span>\n                    <span className=\"ml-auto text-xs text-muted-foreground\">\n                      {work.hidden ? '다시 표시' : '목록에서 제거'}\n                    </span>\n                  </DropdownMenuItem>\n                ))}\n              </DropdownMenuSubContent>\n            </DropdownMenuSub>\n          ) : null}\n          {composeCurrentWork ? (\n            <DropdownMenuItem onSelect={() => void changeWorkVisibility(composeCurrentWork)}>\n              {composeCurrentWork.hidden ? '이 Work를 Main 목록에 다시 표시' : '이 Work만 Main 목록에서 제거'}\n            </DropdownMenuItem>\n          ) : null}\n          {chatPane ? ("
  }
  ,{
    path: "src/renderer/src/components/sidebar/worktree-card-agents-expansion-state.ts",
    before: "  compactRootListExpanded: boolean\n}",
    after: "  compactRootListExpanded: boolean\n  /** Synthetic child rows hidden without touching their parent session. */\n  hiddenSubagentPaneKeys?: ReadonlySet<string>\n}",
    secondBefore: "  if (state.compactRootListExpanded || state.collapsedLineageParents.size > 0) {",
    secondAfter: "  if (state.compactRootListExpanded || state.collapsedLineageParents.size > 0 ||\n    (state.hiddenSubagentPaneKeys?.size ?? 0) > 0) {"
  }
  ,{
    path: "src/renderer/src/components/sidebar/worktree-card-agents-expansion-state.ts",
    before: "  toggleCompactRootList: () => void\n}",
    after: "  toggleCompactRootList: () => void\n  hiddenSubagentPaneKeys: ReadonlySet<string>\n  dismissSubagent: (paneKey: string) => void\n}",
    secondBefore: "  return {\n    collapsedLineageParents: current.collapsedLineageParents,",
    secondAfter: "  const dismissSubagent = useCallback((paneKey: string) => {\n    const base = readExpansionState(worktreeId)\n    const keys = new Set(base.hiddenSubagentPaneKeys ?? [])\n    keys.add(paneKey)\n    // Follow Orca's bounded renderer-session disclosure cache.\n    commit({ ...base, hiddenSubagentPaneKeys: new Set(Array.from(keys).slice(-128)) })\n  }, [commit, worktreeId])\n\n  return {\n    hiddenSubagentPaneKeys: current.hiddenSubagentPaneKeys ?? EMPTY_COLLAPSED_PARENTS,\n    dismissSubagent,\n    collapsedLineageParents: current.collapsedLineageParents,"
  }
  ,{
    path: "src/renderer/src/components/sidebar/WorktreeCardAgents.tsx",
    before: "  const focusedAgentPaneKey = useFocusedAgentPaneKey(worktreeId)",
    after: "  const focusedAgentPaneKey = useFocusedAgentPaneKey(worktreeId)\n  const {\n    collapsedLineageParents, compactRootListExpanded, toggleLineageParent: toggleLineageParentState,\n    toggleCompactRootList, hiddenSubagentPaneKeys, dismissSubagent\n  } = useWorktreeAgentExpansionState(worktreeId)",
    secondBefore: "  const handleDismissAgent = useCallback(\n    (paneKey: string) => {\n      dropAgentStatus(paneKey)\n      dismissRetainedAgent(paneKey)\n    },\n    [dropAgentStatus, dismissRetainedAgent]\n  )",
    secondAfter: "  const handleDismissAgent = useCallback(\n    (paneKey: string) => {\n      // Synthetic children have no own status record: never drop the parent.\n      if (agents.some(agent => agent.paneKey === paneKey && agent.rowSource === 'subagent')) {\n        dismissSubagent(paneKey)\n        return\n      }\n      dropAgentStatus(paneKey)\n      dismissRetainedAgent(paneKey)\n    },\n    [agents, dismissSubagent, dropAgentStatus, dismissRetainedAgent]\n  )"
  }
  ,{
    path: "src/renderer/src/components/sidebar/WorktreeCardAgents.tsx",
    before: "  const { rootRows: rootAgents, childrenByParentPaneKey } = useMemo(\n    () => buildAgentRowLineageTree(agents),\n    [agents]\n  )",
    after: "  const visibleAgents = useMemo(() => agents.filter(agent =>\n    agent.rowSource !== 'subagent' || !hiddenSubagentPaneKeys.has(agent.paneKey)\n  ), [agents, hiddenSubagentPaneKeys])\n  const { rootRows: rootAgents, childrenByParentPaneKey } = useMemo(\n    () => buildAgentRowLineageTree(visibleAgents),\n    [visibleAgents]\n  )",
    secondBefore: "  const {\n    collapsedLineageParents,\n    compactRootListExpanded,\n    toggleLineageParent: toggleLineageParentState,\n    toggleCompactRootList\n  } = useWorktreeAgentExpansionState(worktreeId)\n",
    secondAfter: "  // Parent lineage controls are initialized above before row callbacks."
  }
  ,{
    path: "src/renderer/src/components/sidebar/WorktreeCardAgents.tsx",
    before: "        <CompactAgentRow\n          agent={agent}\n          now={now}",
    after: "        <CompactAgentRow\n          agent={agent}\n          now={now}\n          onDismiss={handleDismissAgent}\n          hasParentAgent={ancestorPaneKeys.size > 0}",
    secondBefore: "import React",
    secondAfter: "import React"
  }
  ,{
    path: "src/renderer/src/components/dashboard/DashboardAgentRow.tsx",
    before: "          hideDismiss={agent.rowSource === 'subagent'}",
    after: "          // Parent X must not make its entire visible child subtree disappear.\n          hideDismiss={hasChildDisclosure}",
    secondBefore: "import React",
    secondAfter: "import React"
  }
  ,{
    path: "src/renderer/src/components/sidebar/worktree-card-compact-agent-row.tsx",
    before: "import { DashboardAgentChildDisclosure } from '@/components/dashboard/DashboardAgentChildDisclosure'",
    after: "import { DashboardAgentChildDisclosure } from '@/components/dashboard/DashboardAgentChildDisclosure'\nimport { X } from 'lucide-react'",
    secondBefore: "  onActivate: (tabId: string, paneKey: string) => void\n  // Send-target mode",
    secondAfter: "  onActivate: (tabId: string, paneKey: string) => void\n  onDismiss?: (paneKey: string) => void\n  hasParentAgent?: boolean\n  // Send-target mode"
  }
  ,{
    path: "src/renderer/src/components/sidebar/worktree-card-compact-agent-row.tsx",
    before: "  onActivate,\n  sendTargetStatus,",
    after: "  onActivate,\n  onDismiss,\n  hasParentAgent = false,\n  sendTargetStatus,",
    secondBefore: "      {hasChildDisclosure ? (\n        <DashboardAgentChildDisclosure",
    secondAfter: "      {onDismiss && !hasChildDisclosure ? (\n        <button type=\"button\" aria-label=\"목록에서 이 Agent만 제거\"\n          className=\"shrink-0 rounded-sm p-1 text-muted-foreground/70 hover:text-foreground\"\n          onClick={e => { e.stopPropagation(); onDismiss(agent.paneKey) }}\n          onMouseDown={e => e.stopPropagation()}\n          onPointerDown={e => e.stopPropagation()}>\n          <X className=\"size-3\" />\n        </button>\n      ) : null}\n      {hasChildDisclosure ? (\n        <DashboardAgentChildDisclosure"
  }
  ,{
    path: 'src/renderer/src/components/native-chat/use-native-chat-context-menu.tsx',
    before: "import { translate } from '@/i18n/i18n'",
    after: "import { translate } from '@/i18n/i18n'\nimport { toast } from 'sonner'",
    secondBefore: "  DropdownMenuItem,\n  DropdownMenuSeparator,",
    secondAfter: "  DropdownMenuItem,\n  DropdownMenuSub,\n  DropdownMenuSubTrigger,\n  DropdownMenuSubContent,\n  DropdownMenuSeparator,"
  }
  ,{
    path: 'src/renderer/src/components/sidebar/worktree-card-compact-agent-row.tsx',
    before: "  const isLineageChild = agent.lineage?.depth === 1",
    after: "  const isLineageChild = hasParentAgent || agent.lineage?.depth === 1",
    secondBefore: "import React",
    secondAfter: "import React"
  }
  ,{
    path: "src/renderer/src/components/dashboard/agent-row-lineage-model.ts",
    before: "  paneKeyByTerminalHandle: ReadonlyMap<string, string>\n): string | undefined {",
    after: "  paneKeyByTerminalHandle: ReadonlyMap<string, string>,\n  contextParentPaneKeys?: ReadonlyMap<string, string>\n): string | undefined {",
    secondBefore: "  return undefined\n}\n\nexport function buildAgentRowLineageTree",
    secondAfter: "  // Orca's native orchestration always wins. Pi context is presentation-only.\n  const contextParent = contextParentPaneKeys?.get(row.paneKey)\n  if (contextParent && contextParent !== row.paneKey && rowsByPaneKey.has(contextParent)) {\n    return contextParent\n  }\n  return undefined\n}\n\nexport function buildAgentRowLineageTree"
  }
  ,{
    path: "src/renderer/src/components/dashboard/agent-row-lineage-model.ts",
    before: "export function buildAgentRowLineageTree<T extends AgentLineageSourceRow>(\n  rows: readonly T[]\n): AgentRowLineageTree<T> {",
    after: "export function buildAgentRowLineageTree<T extends AgentLineageSourceRow>(\n  rows: readonly T[],\n  contextParentPaneKeys?: ReadonlyMap<string, string>\n): AgentRowLineageTree<T> {",
    secondBefore: "const parentPaneKey = resolveAgentRowParentPaneKey(row, rowsByPaneKey, paneKeyByTerminalHandle)",
    secondAfter: "const parentPaneKey = resolveAgentRowParentPaneKey(row, rowsByPaneKey, paneKeyByTerminalHandle, contextParentPaneKeys)"
  }
  ,{
    path: "src/renderer/src/components/dashboard/agent-row-lineage.ts",
    before: "export function applyAgentRowLineage(rows: DashboardAgentRow[]): DashboardAgentRowWithLineage[] {",
    after: "export function applyAgentRowLineage(\n  rows: DashboardAgentRow[],\n  contextParentPaneKeys?: ReadonlyMap<string, string>\n): DashboardAgentRowWithLineage[] {",
    secondBefore: "  const { rootRows, childrenByParentPaneKey, childPaneKeys } = buildAgentRowLineageTree(rows)",
    secondAfter: "  const { rootRows, childrenByParentPaneKey, childPaneKeys } = buildAgentRowLineageTree(rows, contextParentPaneKeys)"
  }
  ,{
    path: "src/renderer/src/components/sidebar/WorktreeCardAgents.tsx",
    before: "  const { rootRows: rootAgents, childrenByParentPaneKey } = useMemo(\n    () => buildAgentRowLineageTree(visibleAgents),\n    [visibleAgents]\n  )",
    after: "  const contextParents = usePiComposeNativeLineage(worktreeId, visibleAgents)\n  const presentationAgents = useMemo(\n    () => applyAgentRowLineage(visibleAgents, contextParents),\n    [visibleAgents, contextParents]\n  )\n  const { rootRows: rootAgents, childrenByParentPaneKey } = useMemo(\n    () => buildAgentRowLineageTree(presentationAgents, contextParents),\n    [presentationAgents, contextParents]\n  )",
    secondBefore: "import { buildAgentRowLineageTree } from '@/components/dashboard/agent-row-lineage-model'",
    secondAfter: "import { buildAgentRowLineageTree } from '@/components/dashboard/agent-row-lineage-model'\nimport { applyAgentRowLineage } from '@/components/dashboard/agent-row-lineage'\nimport { usePiComposeNativeLineage } from '../pi-compose/usePiComposeNativeLineage'"
  }

  ,{
    path: 'src/renderer/src/components/native-chat/NativeChatMessageList.tsx',
    before: "import { NativeChatMessageRail } from './NativeChatMessageRail'",
    after: "import { NativeChatMessageRail } from './NativeChatMessageRail'\nimport { PiComposeLinkedWorkReports } from '../pi-compose/PiComposeLinkedWorkReports'",
    secondBefore: "                <NativeChatWaitingTranscriptItems slots={waitingSlots} context={rowContext} />",
    secondAfter: "                <NativeChatWaitingTranscriptItems slots={waitingSlots} context={rowContext} />\n                <PiComposeLinkedWorkReports orcaSessionId={composeOrcaSessionId ?? null} worktreeId={composeWorktreeId ?? null} isVisible={isVisible} />"
  }
  ,{
    path: 'src/renderer/src/components/native-chat/use-native-chat-context-menu.tsx',
    before: "import { NativeChatPaneMenuItems } from './NativeChatPaneMenuItems'",
    after: "import { NativeChatPaneMenuItems } from './NativeChatPaneMenuItems'\nimport { PiComposeSupportDraftMenu } from '../pi-compose/PiComposeSupportDraftMenu'",
    secondBefore: "          {chatPane ? (",
    secondAfter: "          {composeChat?.entityId && composeWorktree?.path ? (\n            <PiComposeSupportDraftMenu cwd={composeWorktree.path} orcaSessionId={composeChat.entityId} />\n          ) : null}\n          {chatPane ? ("
  }
  ,{
    path: 'src/main/pi/rpc-session-adapter.ts',
    before: "  readCommands = (id: string) => this.sessions.get(id)?.startup.commands",
    after: "  /** Read authoritative live Pi branch leaf without changing the conversation. */\n  async readComposeActiveLeaf(sessionId: string): Promise<string | null> {\n    const session = this.sessions.get(sessionId)\n    if (!session || session.connection.closed) throw new Error('Pi Main is not live on this host')\n    const response = await readPiEntries(session.connection, null, 10_000)\n    return response.leafId\n  }\n  readCommands = (id: string) => this.sessions.get(id)?.startup.commands",
    secondBefore: "import { PiRpcSession, type PiRpcSessionDeps, type PiRpcConnection } from './rpc-session'",
    secondAfter: "import { PiRpcSession, type PiRpcSessionDeps, type PiRpcConnection } from './rpc-session'\nimport { readPiEntries } from './rpc-history-catch-up'"
  }
  // P2 DECISION GATE: cross-worktree duplicate native rows have been
  // disabled until Orca owner routing and the A/B UX policy are confirmed.
  // Keep source as an unmounted experiment; do not alter native row dismissal.
  ,{
    path: 'src/main/pi/rpc-launch.ts',
    before: "import { ORCA_AGENT_SESSION_SPAWN_TOKEN_ENV } from '../../shared/agent-session-caller-env'",
    after: "import { ORCA_AGENT_SESSION_SPAWN_TOKEN_ENV } from '../../shared/agent-session-caller-env'\nimport { existsSync } from 'node:fs'\nimport { join } from 'node:path'",
    secondBefore: "  const args = [...(options.extraArgs ?? [])]",
    secondAfter: "  // Extend the normal Pi CLI args; never disable the user's own Extensions.\n  // PI_COMPOSE_ROOT is set only in the opt-in Pi Compose Orca launch environment.\n  const composeRoot = options.env?.PI_COMPOSE_ROOT\n  const composeExtension = composeRoot ? join(composeRoot, 'extensions/orca-compose.ts') : null\n  const args = [...(options.extraArgs ?? [])]\n  if (composeExtension && existsSync(composeExtension) && !args.includes(composeExtension)) {\n    args.push('--extension', composeExtension)\n  }"
  }
  ,{
    path: "src/renderer/src/components/native-chat/NativeChatMessageList.tsx",
    before: "  isVisible = true,\n  isWorking,",
    after: "  isVisible = true,\n  composeOrcaSessionId,\n  composeWorktreeId,\n  isWorking,",
    secondBefore: "  isVisible?: boolean\n  isWorking: boolean",
    secondAfter: "  isVisible?: boolean\n  /** Orca host conversation identity, not the provider's Pi session UUID. */\n  composeOrcaSessionId?: string | null\n  composeWorktreeId?: string | null\n  isWorking: boolean"
  }
  ,{
    path: "src/renderer/src/components/native-chat/NativeChatStructuredSession.tsx",
    before: "                <NativeChatMessageList\n",
    after: "                <NativeChatMessageList\n                  composeOrcaSessionId={props.sessionId}\n                  composeWorktreeId={ownerWorktreeId}\n",
    secondBefore: "import { NativeChatMessageList } from './NativeChatMessageList'",
    secondAfter: "import { NativeChatMessageList } from './NativeChatMessageList'"
  }
]

const additions = [
  'src/main/pi-compose-ipc.ts',
  'src/preload/api/pi-compose-bridge.ts',
  'src/renderer/src/components/pi-compose/PiComposeMenu.tsx',
  'src/renderer/src/components/pi-compose/PiComposeNativeChat.ts',
  'src/renderer/src/components/pi-compose/usePiComposeNativeLineage.ts',
  'src/renderer/src/components/pi-compose/PiComposeLinkedWorkReports.tsx',
  'src/renderer/src/components/pi-compose/PiComposeCrossWorktreeAgentRefs.tsx',
  'src/renderer/src/components/pi-compose/PiComposeSupportDraftMenu.tsx',
]
const original = (root, relative) => join(root,'orca-overlay',relative)

export function applyOrcaOverlay(orca, piComposeRoot) {
  if (!existsSync(join(orca, '.git')) || !existsSync(join(orca, 'LICENSE'))) {
    throw new Error('정상적인 Orca 원본 체크아웃이 아닙니다.')
  }
  // Read and validate the entire patch before writing ANY upstream code.
  // A prior Compose-generated file is safe to update only while its current
  // hash still matches the last Compose-applied bytes. Hand edits fail closed.
  const manifestPath = join(orca, '.pi-compose-overlay-state.json')
  const previous = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : { files: {} }
  const hash = text => createHash('sha256').update(text).digest('hex')
  const nextFiles = {}
  const staged = new Map()
  // Later patches may intentionally refine earlier patches in the SAME file.
  // Compare the whole applied patch set, not individual intermediate strings:
  // a second prepare must not reapply an intermediate transformation.
  const patchInputs = new Map()
  for (const patch of patches) {
    const inputs = patchInputs.get(patch.path) ?? []
    inputs.push([patch.before, patch.after, patch.secondBefore, patch.secondAfter])
    patchInputs.set(patch.path, inputs)
  }
  const patchSignatures = new Map(
    [...patchInputs].map(([relative, inputs]) => [relative, hash(JSON.stringify(inputs))])
  )
  const nextPatchedFiles = {}
  const alreadyUpToDate = new Set()
  for (const patch of patches) {
    if (alreadyUpToDate.has(patch.path)) continue
    const path = join(orca, patch.path)
    const stagedSource = staged.get(path)
    const currentSource = stagedSource ?? readFileSync(path, 'utf8')
    const previousPatch = previous.patchedFiles?.[patch.path]
    if (previousPatch && !stagedSource && hash(currentSource) !== previousPatch.hash) {
      throw new Error('기존 Orca 패치 파일이 변경됐습니다. 사용자 변경을 덮어쓰지 않습니다: ' + patch.path)
    }
    if (previousPatch?.signature === patchSignatures.get(patch.path) &&
        hash(currentSource) === previousPatch.hash && !stagedSource) {
      staged.set(path, currentSource)
      alreadyUpToDate.add(patch.path)
      continue
    }
    // The previous overlay may have applied multiple sequential patches to
    // this file. An intermediate "after" string is not the final output, so
    // editing that output again cannot safely remove retired hooks. Once our
    // manifest proves no user modification, rebuild exclusively from the
    // PINNED Orca commit via a read-only Git query (never git checkout/reset).
    // If the original no longer matches the patch contract, fail closed.
    let result = currentSource
    if (previousPatch && !stagedSource) {
      try {
        result = execFileSync('git', ['show', 'HEAD:' + patch.path], {
          cwd: orca, encoding: 'utf8', timeout: 20_000
        })
      } catch {
        throw new Error('Orca 원본을 안전하게 읽지 못해 기존 패치를 보존했습니다: ' + patch.path)
      }
    }
    for (const [from, to] of [
      [patch.before, patch.after], [patch.secondBefore, patch.secondAfter]
    ]) {
      if (result.includes(to)) continue
      if (!result.includes(from)) {
        throw new Error('Orca upstream이 변경되어 통합을 멈췄습니다: ' + patch.path)
      }
      result = result.replace(from, to)
    }
    staged.set(path, result)
  }
  for (const relative of patchInputs.keys()) {
    nextPatchedFiles[relative] = {
      hash: hash(staged.get(join(orca, relative))),
      signature: patchSignatures.get(relative)
    }
  }
  for (const relative of additions) {
    const path=join(orca,relative)
    const overlay=original(piComposeRoot,relative)
    const content=readFileSync(overlay,'utf8')
    if (existsSync(path)) {
      const current = readFileSync(path, 'utf8')
      const previouslyAppliedHash = previous.files?.[relative]
      if (current !== content && hash(current) !== previouslyAppliedHash) {
        throw new Error('Orca 원본 또는 사용자 변경 파일을 덮어쓸 수 없습니다: ' + relative)
      }
    }
    nextFiles[relative] = hash(content)
    staged.set(path,content)
  }
  for (const [path,content] of staged) {
    mkdirSync(dirname(path),{recursive:true})
    if (!existsSync(path) || readFileSync(path,'utf8')!==content) writeFileSync(path,content)
  }
  // Persist last applied bytes after completing the staged writes. An
  // interrupted run can be recovered by choosing a clean Orca checkout.
  const tempManifestPath = manifestPath + '.tmp'
  writeFileSync(tempManifestPath, JSON.stringify({ version: 2, files: nextFiles, patchedFiles: nextPatchedFiles }, null, 2) + '\n')
  renameSync(tempManifestPath, manifestPath)
  console.log('Pi Compose native Orca integration:',patches.length,'upstream hooks,',additions.length,'overlay files')
}
