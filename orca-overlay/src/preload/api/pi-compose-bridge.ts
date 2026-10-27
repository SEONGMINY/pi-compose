import { ipcRenderer } from 'electron'

export type PiComposeCommand = 'list' | 'sessions' | 'import' | 'attach' | 'main' | 'work' | 'support'
export type PiComposeRequest = {
  cwd: string
  title?: string
  sessionId?: string
  id?: string
  tabId?: string
  worktreeId?: string
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
  launcher?: string | null
  orcaTabId?: string | null
  orcaWorktreeId?: string | null
}
export type PiComposeListRecord = Pick<PiComposeRecord, 'id'|'role'|'title'|'parentMainId'|'state'|'sessionId'|'cwd'|'launcher'|'orcaTabId'|'orcaWorktreeId'> & {
  proof?: { allMatch: boolean; copied: number; expected: number }
}
export type PiComposeResult = {
  record: PiComposeRecord
  launcher: string
  proof?: { allMatch: boolean; copied: number; expected: number }
}
export type PiComposeApi = {
  list: (cwd: string) => Promise<PiComposeListRecord[]>
  attach: (cwd: string, id: string, tabId: string, worktreeId: string) => Promise<PiComposeRecord>
  sessions: (cwd: string) => Promise<{id:string;title:string;messageCount:number;path:string}[]>
  create: (command: 'main'|'import'|'work'|'support', request: PiComposeRequest) => Promise<PiComposeResult>
}
export const piComposeApi: PiComposeApi = {
  list: (cwd) => ipcRenderer.invoke('pi-compose:execute', 'list', { cwd }),
  attach: (cwd,id,tabId,worktreeId) => ipcRenderer.invoke('pi-compose:execute','attach',{cwd,id,tabId,worktreeId}),
  sessions: (cwd) => ipcRenderer.invoke('pi-compose:execute', 'sessions', { cwd }),
  create: (command, request) => ipcRenderer.invoke('pi-compose:execute', command, request)
}
