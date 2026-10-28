import { ipcRenderer } from 'electron'

export type PiComposeCommand = 'list' | 'sessions' | 'import' | 'attach' | 'attach-chat' | 'support-result' | 'main' | 'work' | 'support'
export type PiComposeRequest = {
  cwd: string
  title?: string
  sessionId?: string
  id?: string
  tabId?: string
  worktreeId?: string
  orcaSessionId?: string
  mainId?: string
  relatedWorkId?: string
  task?: string
  workspace?: 'shared' | 'worktree'
}
export type PiComposeRecord = {
  id: string
  title: string
  role: 'main' | 'work' | 'support'
  parentMainId?: string | null
  relatedWorkId?: string | null
  sourceEntryId?: string | null
  excludedInProgress?: boolean
  projectRoot: string
  cwd: string
  workspace?: 'shared' | 'worktree'
  state: string
  sessionId: string
  launcher?: string | null
  orcaTabId?: string | null
  orcaSessionId?: string | null
  orcaWorktreeId?: string | null
}
export type PiComposeListRecord = Pick<PiComposeRecord, 'id'|'role'|'title'|'parentMainId'|'relatedWorkId'|'sourceEntryId'|'excludedInProgress'|'state'|'sessionId'|'cwd'|'launcher'|'orcaTabId'|'orcaSessionId'|'orcaWorktreeId'> & {
  proof?: { allMatch: boolean; copied: number; expected: number; leafMatches?: boolean }
}
export type PiComposeResult = {
  record: PiComposeRecord
  launcher: string
  proof?: { allMatch: boolean; copied: number; expected: number }
}
export type PiComposeSupportResult = {
  supportId: string
  supportTitle: string
  relatedWorkId: string | null
  sessionId: string
  sessionFile: string
  observedAt: string
  entryId: string
  text: string
  truncated: boolean
}
export type PiComposeApi = {
  list: (cwd: string) => Promise<PiComposeListRecord[]>
  attach: (cwd: string, id: string, tabId: string, worktreeId: string) => Promise<PiComposeRecord>
  attachChat: (cwd: string, id: string, orcaSessionId: string, worktreeId: string) => Promise<PiComposeRecord>
  supportResult: (cwd: string, id: string) => Promise<PiComposeSupportResult>
  sessions: (cwd: string) => Promise<{id:string;title:string;messageCount:number;path:string}[]>
  create: (command: 'main'|'import'|'work'|'support', request: PiComposeRequest) => Promise<PiComposeResult>
}
export const piComposeApi: PiComposeApi = {
  list: (cwd) => ipcRenderer.invoke('pi-compose:execute', 'list', { cwd }),
  attach: (cwd,id,tabId,worktreeId) => ipcRenderer.invoke('pi-compose:execute','attach',{cwd,id,tabId,worktreeId}),
  attachChat: (cwd,id,orcaSessionId,worktreeId) => ipcRenderer.invoke('pi-compose:execute','attach-chat',{cwd,id,orcaSessionId,worktreeId}),
  supportResult: (cwd,id) => ipcRenderer.invoke('pi-compose:execute','support-result',{cwd,id}),
  sessions: (cwd) => ipcRenderer.invoke('pi-compose:execute', 'sessions', { cwd }),
  create: (command, request) => ipcRenderer.invoke('pi-compose:execute', command, request)
}
