import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
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
    path: 'src/renderer/src/components/sidebar/sidebar-header-actions.tsx',
    before: "    openWorkspaceCreationComposerWithTourHandoff()",
    after: "    window.dispatchEvent(new Event('pi-compose:new'))",
    secondBefore: "const label = translate('auto.components.sidebar.SidebarHeader.92154beb7e', 'New workspace')",
    secondAfter: "const label = '새 작업 또는 Agent 만들기'"
  }

  ,{
    path: 'src/renderer/src/components/sidebar/index.tsx',
    before: "import WorktreeList from './WorktreeList'",
    after: "import WorktreeList from './WorktreeList'\\nimport { PiComposeOutline } from '../pi-compose/PiComposeOutline'",
    secondBefore: '                <StartupWorktreeRefreshStatus />',
    secondAfter: '                <StartupWorktreeRefreshStatus />\\n                <PiComposeOutline />'
  }

]

const additions = [
  'src/main/pi-compose-ipc.ts',
  'src/preload/api/pi-compose-bridge.ts',
  'src/renderer/src/components/pi-compose/PiComposeMenu.tsx',
  'src/renderer/src/components/pi-compose/PiComposeOutline.tsx',
]
const original = (root, relative) => join(root,'orca-overlay',relative)

export function applyOrcaOverlay(orca, piComposeRoot) {
  if (!existsSync(join(orca, '.git')) || !existsSync(join(orca, 'LICENSE'))) {
    throw new Error('정상적인 Orca 원본 체크아웃이 아닙니다.')
  }
  // Read and validate the entire patch before writing ANY upstream code.
  const staged = []
  for (const patch of patches) {
    const path = join(orca,patch.path)
    const source = readFileSync(path,'utf8')
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
    staged.push({path,content:result})
  }
  for (const relative of additions) {
    const path=join(orca,relative)
    const overlay=original(piComposeRoot,relative)
    const content=readFileSync(overlay,'utf8')
    if (existsSync(path) && readFileSync(path,'utf8')!==content) {
      throw new Error('Orca 원본의 사용자 변경 파일을 덮어쓸 수 없습니다: ' + relative)
    }
    staged.push({path,content})
  }
  for (const {path,content} of staged) {
    mkdirSync(dirname(path),{recursive:true})
    if (!existsSync(path) || readFileSync(path,'utf8')!==content) writeFileSync(path,content)
  }
  console.log('Pi Compose native Orca integration:',patches.length,'upstream hooks,',additions.length,'overlay files')
}
