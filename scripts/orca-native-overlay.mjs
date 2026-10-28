import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
    before: "  const menuOpenedAtRef = useRef(0)",
    after: "  const composeChat = useAppStore((s) => chatPane\n    ? s.unifiedTabsByWorktree[chatPane.worktreeId]?.find(tab => tab.id === chatPane.tabId)\n    : undefined)\n  const composeWorktree = useAppStore((s) => chatPane ? s.getKnownWorktreeById(chatPane.worktreeId) : null)\n  const [composeMainId, setComposeMainId] = useState<string | null>(null)\n  useEffect(() => {\n    const sessionId = composeChat?.contentType === 'agent-session' && composeChat.agentSessionAgent === 'pi'\n      ? composeChat.entityId : null\n    if (!enabled || !state.open || !sessionId || !composeWorktree?.path) {\n      setComposeMainId(null)\n      return\n    }\n    let current = true\n    void window.api.piCompose.list(composeWorktree.path).then(records => {\n      if (current) setComposeMainId(records.find(record =>\n        record.role === 'main' && record.orcaSessionId === sessionId)?.id ?? null)\n    }).catch(() => { if (current) setComposeMainId(null) })\n    return () => { current = false }\n  }, [enabled, state.open, composeChat?.entityId, composeChat?.agentSessionAgent, composeWorktree?.path])\n  const menuOpenedAtRef = useRef(0)",
    secondBefore: "          {chatPane ? (",
    secondAfter: "          {composeMainId && chatPane && composeWorktree ? (\n            <DropdownMenuItem onSelect={() => {\n              window.dispatchEvent(new CustomEvent('pi-compose:new', {\n                detail: {\n                  role: 'work', mainId: composeMainId,\n                  projectCwd: composeWorktree.path, projectWorktreeId: chatPane.worktreeId\n                }\n              }))\n            }}>\n              <GitFork className=\"size-3.5\" />\n              이 Main에서 Work 만들기…\n            </DropdownMenuItem>\n          ) : null}\n          {chatPane ? ("
  }

]

const additions = [
  'src/main/pi-compose-ipc.ts',
  'src/preload/api/pi-compose-bridge.ts',
  'src/renderer/src/components/pi-compose/PiComposeMenu.tsx',
  'src/renderer/src/components/pi-compose/PiComposeNativeChat.ts',
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
  for (const patch of patches) {
    const path = join(orca,patch.path)
    const source = staged.get(path) ?? readFileSync(path,'utf8')
    let result = source
    for (const pair of [
      [patch.before,patch.after],[patch.secondBefore,patch.secondAfter]
    ]) {
      const [from,to] = pair
      if (result.includes(to)) continue // already applied exactly
      if (!result.includes(from)) {
        throw new Error('Orca upstream이 변경되어 통합을 멈췄습니다: ' + patch.path)
      }
      result=result.replace(from,to)
    }
    staged.set(path,result)
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
  writeFileSync(tempManifestPath, JSON.stringify({ version: 1, files: nextFiles }, null, 2) + '\n')
  renameSync(tempManifestPath, manifestPath)
  console.log('Pi Compose native Orca integration:',patches.length,'upstream hooks,',additions.length,'overlay files')
}
