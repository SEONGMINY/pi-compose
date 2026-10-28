import { ipcRenderer } from 'electron'

export type PiComposeCommand = 'list' | 'sessions' | 'import' | 'attach' | 'attach-chat' | 'connection-failed' | 'support-result' | 'set-work-main-visibility' | 'main' | 'work' | 'support'
export type PiComposeRequest = {
  cwd: string
  title?: string
  sessionId?: string
  id?: string
  tabId?: string
  worktreeId?: string
  orcaSessionId?: string
  message?: string
  replaceClosed?: boolean
  mainId?: string
  relatedWorkId?: string
  hidden?: boolean
  task?: string
  workspace?: 'shared' | 'worktree'
  activeLeafId?: string
  managedWorktree?: { id: string; path: string }
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
  connectionError?: string | null
  orcaWorktreeId?: string | null
  hiddenFromMainAt?: string | null
}
export type PiComposeListRecord = Pick<PiComposeRecord, 'id'|'role'|'title'|'parentMainId'|'relatedWorkId'|'sourceEntryId'|'excludedInProgress'|'state'|'sessionId'|'cwd'|'launcher'|'orcaTabId'|'orcaSessionId'|'connectionError'|'orcaWorktreeId'|'hiddenFromMainAt'> & {
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
  attachChat: (cwd: string, id: string, orcaSessionId: string, worktreeId: string, replaceClosed?: boolean) => Promise<PiComposeRecord>
  supportResult: (cwd: string, id: string) => Promise<PiComposeSupportResult>
  setWorkMainVisibility: (cwd: string, mainId: string, id: string, hidden: boolean) => Promise<PiComposeRecord>
  connectionFailed: (cwd: string, id: string, message: string) => Promise<PiComposeRecord>
  sessions: (cwd: string) => Promise<{id:string;title:string;messageCount:number;path:string}[]>
  create: (command: 'main'|'import'|'work'|'support', request: PiComposeRequest) => Promise<PiComposeResult>
}
export const piComposeApi: PiComposeApi = {
  list: (cwd) => ipcRenderer.invoke('pi-compose:execute', 'list', { cwd }),
  attach: (cwd,id,tabId,worktreeId) => ipcRenderer.invoke('pi-compose:execute','attach',{cwd,id,tabId,worktreeId}),
  attachChat: (cwd,id,orcaSessionId,worktreeId,replaceClosed) => ipcRenderer.invoke('pi-compose:execute','attach-chat',{cwd,id,orcaSessionId,worktreeId,replaceClosed}),
  supportResult: (cwd,id) => ipcRenderer.invoke('pi-compose:execute','support-result',{cwd,id}),
  setWorkMainVisibility: (cwd,mainId,id,hidden) => ipcRenderer.invoke('pi-compose:execute','set-work-main-visibility',{cwd,mainId,id,hidden}),
  connectionFailed: (cwd,id,message) => ipcRenderer.invoke('pi-compose:execute','connection-failed',{cwd,id,message}),
  sessions: (cwd) => ipcRenderer.invoke('pi-compose:execute', 'sessions', { cwd }),
  create: (command, request) => ipcRenderer.invoke('pi-compose:execute', command, request)
}
