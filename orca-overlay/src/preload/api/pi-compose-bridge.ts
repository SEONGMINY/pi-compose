import { ipcRenderer } from 'electron'

export type PiComposeCommand = 'list' | 'main' | 'work' | 'support'
export type PiComposeRequest = {
  cwd: string
  title?: string
  mainId?: string
  task?: string
  workspace?: 'shared' | 'worktree'
}
export type PiComposeRecord = {
  id: string
  title: string
  role: 'main' | 'work' | 'support'
  parentMainId?: string | null
  projectRoot: string
  cwd: string
  workspace?: 'shared' | 'worktree'
  state: string
  sessionId: string
}
export type PiComposeResult = {
  record: PiComposeRecord
  launcher: string
  proof?: { allMatch: boolean; copied: number; expected: number }
}
export type PiComposeApi = {
  list: (cwd: string) => Promise<Array<Pick<PiComposeRecord, 'id'|'role'|'title'|'parentMainId'|'state'|'sessionId'>>>
  create: (command: Exclude<PiComposeCommand, 'list'>, request: PiComposeRequest) => Promise<PiComposeResult>
}
export const piComposeApi: PiComposeApi = {
  list: (cwd) => ipcRenderer.invoke('pi-compose:execute', 'list', { cwd }),
  create: (command, request) => ipcRenderer.invoke('pi-compose:execute', command, request)
}
