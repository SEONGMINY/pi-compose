import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

type NativeRole = 'main' | 'work' | 'support'
type NativeCommand = 'list' | 'sessions' | 'import' | NativeRole
export type NativeComposeRequest = {
  cwd: string
  title?: string
  sessionId?: string
  mainId?: string
  task?: string
  workspace?: 'shared' | 'worktree'
}
const VALID_COMMANDS = new Set<NativeCommand>(['list', 'sessions', 'import', 'main', 'work', 'support'])
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
