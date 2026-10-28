import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

type NativeRole = 'main' | 'work' | 'support'
type NativeCommand = 'list' | 'sessions' | 'import' | 'attach' | 'attach-chat' | 'connection-failed' | 'support-result' | 'preview-work-fork' | 'live-main-leaf' | 'linked-work-results' | 'set-work-main-visibility' | NativeRole
export type NativeComposeRequest = {
  cwd: string
  title?: string
  sessionId?: string
  id?: string
  tabId?: string
  worktreeId?: string
  orcaSessionId?: string
  message?: string
  mainId?: string
  relatedWorkId?: string
  hidden?: boolean
  task?: string
  workspace?: 'shared' | 'worktree'
  activeLeafId?: string
  expectedSourceEntryId?: string
  managedWorktree?: { id: string; path: string }
}
const VALID_COMMANDS = new Set<NativeCommand>(['list', 'sessions', 'import', 'attach', 'attach-chat', 'connection-failed', 'support-result', 'preview-work-fork', 'live-main-leaf', 'linked-work-results', 'set-work-main-visibility', 'main', 'work', 'support'])
const TIMEOUT_MS = 90_000

/**
 * Pi SDK code is not bundled into Electron or exposed to the renderer.
 * Native Orca process invokes a constrained, local Node bridge with JSON stdin.
 */
export function registerPiComposeIpc(): void {
  ipcMain.handle('pi-compose:execute', async (_event, command: NativeCommand, data: NativeComposeRequest) => {
    if (!VALID_COMMANDS.has(command)) throw new Error('Unknown Pi Compose command')
    if (!data || typeof data.cwd !== 'string' || !data.cwd.startsWith('/') ||
        data.cwd.length > 2000) throw new Error('Select a local Git project first')
    if (JSON.stringify(data).length > 16_000) throw new Error('Pi Compose request is too long')
    if (command === 'live-main-leaf') {
      // The ORIGINAL live Pi RPC process is the source of truth for its branch.
      // Reading JSONL's last appended row would silently fork abandoned branches.
      const orcaSessionId = data.orcaSessionId
      const worktreeId = data.worktreeId
      const expectedPiSessionId = data.sessionId
      if (!orcaSessionId || !worktreeId || !expectedPiSessionId) {
        throw new Error('Main Orca 세션/Worktree ID 또는 Pi 원본 세션 ID가 없습니다.')
      }
      const { getStructuredAgentSessionHost } = await import('./native-chat/agent-session-wire/structured-agent-session-registry')
      const host = getStructuredAgentSessionHost()
      const record = host?.deps.store.getConversation(orcaSessionId)
      if (!host || !record || record.provider !== 'pi' ||
          record.location.workspaceId !== worktreeId) {
        throw new Error('선택한 Main은 이 Orca 호스트의 Pi 대화가 아닙니다.')
      }
      // Orca's Pi provider handle identifies the *file*, not the Pi UUID.
      // The live leaf is safe to use only when that file's canonical Pi
      // session header belongs to the selected Main.
      const handle = record.providerHandleChain.at(-1)?.handle
      if (handle?.agent !== 'pi' || handle.transport !== 'jsonl-rpc' ||
          !handle.nativeId) {
        throw new Error('Main의 Pi 원본 파일 소유권을 확인할 수 없습니다.')
      }
      const { readPiSessionHeader } = await import('./pi/rpc-launch-resolution')
      const header = await readPiSessionHeader(handle.nativeId)
      if (!header || header.id !== expectedPiSessionId) {
        throw new Error('Orca Native Chat의 Pi 기록이 선택한 Main 세션과 다릅니다. Fork를 중단했습니다.')
      }
      const { PiRpcSessionAdapter } = await import('./pi/rpc-session-adapter')
      const adapter = host.deps.agents.registration('pi')?.adapter
      if (!(adapter instanceof PiRpcSessionAdapter)) {
        throw new Error('현재 호스트에서 Pi RPC 대화의 활성 분기를 확인할 수 없습니다.')
      }
      const activeLeafId = await adapter.readComposeActiveLeaf(orcaSessionId)
      if (!activeLeafId) throw new Error('Main의 Pi 대화에 완료된 분기가 없습니다.')
      return { activeLeafId, orcaSessionId }
    }

    if (command === 'attach-chat') {
      // Admission must prove the *actual* Orca host record owns the selected
      // Pi transcript, not merely trust a renderer-supplied session label.
      const { orcaSessionId, worktreeId, sessionId } = data
      if (!orcaSessionId || !worktreeId || !sessionId) {
        throw new Error('Pi/Orca 세션과 작업 공간 ID가 필요합니다.')
      }
      const { getStructuredAgentSessionHost } = await import('./native-chat/agent-session-wire/structured-agent-session-registry')
      const host = getStructuredAgentSessionHost()
      const conversation = host?.deps.store.getConversation(orcaSessionId)
      if (!conversation || conversation.provider !== 'pi' ||
          conversation.location.workspaceId !== worktreeId) {
        throw new Error('이 Orca 호스트가 해당 Pi 대화를 소유하지 않습니다.')
      }
      const handle = conversation.providerHandleChain.at(-1)?.handle
      if (handle?.agent !== 'pi' || handle.transport !== 'jsonl-rpc' ||
          !handle.nativeId) {
        throw new Error('Orca의 Pi 원본 파일을 확인할 수 없습니다.')
      }
      const { readPiSessionHeader } = await import('./pi/rpc-launch-resolution')
      const header = await readPiSessionHeader(handle.nativeId)
      if (header?.id !== sessionId) {
        throw new Error('Orca 세션과 준비된 Pi 파일의 원본 ID가 다릅니다. 연결을 보류합니다.')
      }
    }

    const root = process.env.PI_COMPOSE_ROOT
    if (!root) throw new Error('Pi Compose bridge unavailable: start with npm run orca:dev')
    const script = resolve(root, 'scripts/orca-native-bridge.mjs')
    const executable = process.env.PI_COMPOSE_NODE_BIN || 'node'
    return await new Promise<unknown>((resolveResult, reject) => {
      const child = spawn(executable, [script, command], {
        cwd: root, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      })
      let output = ''
      let failure = ''
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error('Pi Compose preparation timed out; check Git and Pi sessions'))
      }, TIMEOUT_MS)
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8')
        if (output.length > 1024 * 1024) child.kill('SIGTERM')
      })
      child.stderr.on('data', (chunk: Buffer) => {
        failure = (failure + chunk.toString('utf8')).slice(-4000)
      })
      child.on('error', (error) => { clearTimeout(timer); reject(error) })
      child.on('close', (code) => {
        clearTimeout(timer)
        let response: { ok?: boolean; error?: string; data?: unknown }
        try {
          response = JSON.parse(output.trim().split('\n').at(-1) || '{}')
        } catch {
          reject(new Error('Pi Compose returned invalid data: ' + (failure || 'check Node bridge')))
          return
        }
        if (!response.ok || code !== 0) {
          reject(new Error(response.error || failure || 'Pi Compose command failed'))
        } else {
          resolveResult(response.data)
        }
      })
      child.stdin.end(JSON.stringify(data))
    })
  })
}
