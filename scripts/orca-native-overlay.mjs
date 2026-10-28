import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

/**
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
    path: 'src/renderer/src/components/sidebar/worktree-list/rows/item-row.tsx',
    before: "      onClickCapture={ctx.onRowClickCapture}",
    after: "      onClickCapture={(event) => {\n        if ((event.target as HTMLElement).closest('[data-pi-compose-context]')) return\n        ctx.onRowClickCapture(event)\n      }}",
    secondBefore: "      onClick={(event) => {\n        forwardOptionPressToCardSurface(event)",
    secondAfter: "      onClick={(event) => {\n        if ((event.target as HTMLElement).closest('[data-pi-compose-context]')) return\n        forwardOptionPressToCardSurface(event)"
  }
  ,{
    path: 'src/renderer/src/components/sidebar/sidebar-header-actions.tsx',
    before: "    openWorkspaceCreationComposerWithTourHandoff()",
    after: "    window.dispatchEvent(new Event('pi-compose:new'))",
    secondBefore: "const label = translate('auto.components.sidebar.SidebarHeader.92154beb7e', 'New workspace')",
    secondAfter: "const label = '새 작업 또는 Agent 만들기'"
  }

  ,{
    path: 'src/renderer/src/components/sidebar/worktree-list/rows/item-row.tsx',
    before: "import WorktreeCard, { type ActiveSurfaceVariant } from '../../WorktreeCard'",
    after: "import WorktreeCard, { type ActiveSurfaceVariant } from '../../WorktreeCard'\nimport { PiComposeOutline } from '../../../pi-compose/PiComposeOutline'",
    secondBefore: "      />\n    </div>\n  )\n}\n\n// Rebuild the visible lineage subtree",
    secondAfter: "      />\n      {itemRow.worktree.isMainWorktree && !nested ? (\n        <PiComposeOutline projectCwd={itemRow.worktree.path} projectWorktreeId={itemRow.worktree.id} />\n      ) : null}\n    </div>\n  )\n}\n\n// Rebuild the visible lineage subtree"
  }

  ,{
    path: 'src/renderer/src/components/sidebar/sidebar-header-actions.tsx',
    before: "import { openWorkspaceCreationComposerWithTourHandoff } from '../contextual-tours/workspace-creation-tour-handoff'",
    after: "// Pi Compose integrates the original +; the native Orca workspace flow remains in its dialog.",
    secondBefore: "const shortcutLabel = formatOptionalPrimaryShortcutLabel('workspace.create', keybindings)",
    secondAfter: "const shortcutLabel = '' // the + action now opens the unified Compose/Orca chooser"
  }

  ,{
    path: 'src/renderer/src/components/sidebar/sidebar-header-actions.tsx',
    before: "import { formatOptionalPrimaryShortcutLabel } from '@/hooks/useShortcutLabel'",
    after: "// Pi Compose '+' opens the combined Agent and Orca workspace chooser.",
    secondBefore: "  const keybindings = useAppStore((s) => s.keybindings)",
    secondAfter: "  // Workspace creation shortcut remains Orca-owned; button now opens Pi Compose."
  }

]

const additions = [
  'src/main/pi-compose-ipc.ts',
  'src/preload/api/pi-compose-bridge.ts',
  'src/renderer/src/components/pi-compose/PiComposeMenu.tsx',
  'src/renderer/src/components/pi-compose/PiComposeOutline.tsx',
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
  // The previous version mounted a duplicate Pi Compose panel above WorktreeList.
  // Remove only that exact former overlay, preserving all other upstream edits.
  const sidebarIndex = join(orca, 'src/renderer/src/components/sidebar/index.tsx')
  const oldSidebar = readFileSync(sidebarIndex, 'utf8')
  const cleanedSidebar = oldSidebar
    .replace("import { PiComposeOutline } from '../pi-compose/PiComposeOutline'" + String.fromCharCode(10), '')
    .replace("                <StartupWorktreeRefreshStatus />" + String.fromCharCode(10) + "                <PiComposeOutline />",
      "                <StartupWorktreeRefreshStatus />")
  if (cleanedSidebar !== oldSidebar) staged.set(sidebarIndex, cleanedSidebar)
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
