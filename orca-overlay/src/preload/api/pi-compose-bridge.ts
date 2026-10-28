import { ipcRenderer } from 'electron'

export type PiComposeCommand = 'begin-worktree-creation' | 'pending-worktree-creation' | 'record-worktree-creation' | 'recover-pi-preparation' | 'list' | 'sessions' | 'import' | 'attach' | 'attach-chat' | 'connection-failed' | 'support-result' | 'preview-work-fork' | 'live-main-leaf' | 'linked-work-results' | 'set-work-main-visibility' | 'main' | 'work' | 'support'
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
  expectedSourceEntryId?: string
  creationIntentId?: string
  role?: 'work' | 'support'
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
  sessionFile?: string | null
  launcher?: string | null
  orcaTabId?: string | null
  orcaSessionId?: string | null
  connectionError?: string | null
  orcaWorktreeId?: string | null
  hiddenFromMainAt?: string | null
}
export type PiComposeListRecord = Pick<PiComposeRecord, 'id'|'role'|'title'|'parentMainId'|'relatedWorkId'|'sourceEntryId'|'excludedInProgress'|'state'|'sessionId'|'sessionFile'|'cwd'|'launcher'|'orcaTabId'|'orcaSessionId'|'connectionError'|'orcaWorktreeId'|'hiddenFromMainAt'> & {
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
  worktreeId: string | null
  observedAt: string
  entryId: string
  text: string
  truncated: boolean
}
export type PiComposeLinkedWorkResult = {
  workId: string
  workTitle: string
  mainId: string
  mainOrcaSessionId: string | null
  workOrcaSessionId: string | null
  workPiSessionId: string
  worktreeId: string | null
  entryId: string
  observedAt: string | null
  workedSeconds: number | null
  reasoning: Array<{ id: string; text: string; timestamp: string | null }>
  reportText: string
  truncated: boolean
  toolBlocks: Array<
    { type: 'tool-call'; name: string; input: unknown; callId?: string } |
    { type: 'tool-result'; output: string; isError?: boolean; callId?: string }
  >
  toolActivityTruncated: boolean
}
export type PiComposeLinkedWorkSnapshot = {
  items: PiComposeLinkedWorkResult[]
  unavailable: Array<{
    workId: string
    workTitle: string
    reason: 'orca-unlinked' | 'pi-file-unavailable' | 'pi-read-unavailable'
  }>
  omittedWorkCount: number
}
export type PiComposeCreationIntent = {
  operationId: string
  mainId: string
  role: 'work' | 'support'
  title: string
  relatedWorkId: string | null
  activeLeafId: string | null
  expectedSourceEntryId: string | null
  name: string
  phase: 'requested' | 'workspace-created' | 'prepared'
  createdAt: string
  workspace?: { id: string; path: string }
}
export type PiComposeApi = {
  beginWorktreeCreation: (cwd: string, mainId: string, role: 'work' | 'support', title: string,
    relatedWorkId: string | null, activeLeafId: string | null,
    expectedSourceEntryId: string | null) => Promise<PiComposeCreationIntent>
  pendingWorktreeCreation: (cwd: string, mainId: string) => Promise<PiComposeCreationIntent | null>
  recoverPiPreparation: (cwd: string, mainId: string, creationIntentId: string) => Promise<{recovered:boolean;message:string}>
  recordWorktreeCreation: (cwd: string, mainId: string, creationIntentId: string, managedWorktree: { id: string; path: string }) => Promise<PiComposeCreationIntent>
  list: (cwd: string) => Promise<PiComposeListRecord[]>
  attach: (cwd: string, id: string, tabId: string, worktreeId: string) => Promise<PiComposeRecord>
  attachChat: (cwd: string, id: string, orcaSessionId: string, worktreeId: string, sessionId: string, replaceClosed?: boolean) => Promise<PiComposeRecord>
  supportResult: (cwd: string, id: string) => Promise<PiComposeSupportResult>
  previewWorkFork: (cwd: string, mainId: string, activeLeafId?: string) => Promise<{mainId:string;sourceEntryId:string;completedAssistantEntryId:string;sourceEntryCount:number;excludedInProgress:boolean}>
  liveMainLeaf: (cwd: string, orcaSessionId: string, worktreeId: string, piSessionId: string, piSessionFile: string) => Promise<{activeLeafId:string;orcaSessionId:string}>
  linkedWorkResults: (cwd: string, mainId: string) => Promise<PiComposeLinkedWorkSnapshot>
  setWorkMainVisibility: (cwd: string, mainId: string, id: string, hidden: boolean) => Promise<PiComposeRecord>
  connectionFailed: (cwd: string, id: string, message: string) => Promise<PiComposeRecord>
  sessions: (cwd: string) => Promise<{id:string;title:string;messageCount:number;path:string}[]>
  create: (command: 'main'|'import'|'work'|'support', request: PiComposeRequest) => Promise<PiComposeResult>
}
export const piComposeApi: PiComposeApi = {
  beginWorktreeCreation: (cwd,mainId,role,title,relatedWorkId,activeLeafId,expectedSourceEntryId) =>
    ipcRenderer.invoke('pi-compose:execute','begin-worktree-creation',{
      cwd,mainId,role,title,relatedWorkId,activeLeafId,expectedSourceEntryId
    }),
  pendingWorktreeCreation: (cwd,mainId) => ipcRenderer.invoke('pi-compose:execute', 'pending-worktree-creation',{cwd,mainId}),
  recoverPiPreparation: (cwd,mainId,creationIntentId) =>
    ipcRenderer.invoke('pi-compose:execute','recover-pi-preparation',{cwd,mainId,creationIntentId}),
  recordWorktreeCreation: (cwd,mainId,creationIntentId,managedWorktree) => ipcRenderer.invoke('pi-compose:execute','record-worktree-creation',{cwd,mainId,creationIntentId,managedWorktree}),
  list: (cwd) => ipcRenderer.invoke('pi-compose:execute', 'list', { cwd }),
  attach: (cwd,id,tabId,worktreeId) => ipcRenderer.invoke('pi-compose:execute','attach',{cwd,id,tabId,worktreeId}),
  attachChat: (cwd,id,orcaSessionId,worktreeId,sessionId,replaceClosed) => ipcRenderer.invoke('pi-compose:execute','attach-chat',{cwd,id,orcaSessionId,worktreeId,sessionId,replaceClosed}),
  supportResult: (cwd,id) => ipcRenderer.invoke('pi-compose:execute','support-result',{cwd,id}),
  previewWorkFork: (cwd,mainId,activeLeafId) => ipcRenderer.invoke('pi-compose:execute','preview-work-fork',{cwd,mainId,activeLeafId}),
  liveMainLeaf: (cwd,orcaSessionId,worktreeId,sessionId,sessionFile) => ipcRenderer.invoke('pi-compose:execute','live-main-leaf',{cwd,orcaSessionId,worktreeId,sessionId,sessionFile}),
  linkedWorkResults: (cwd,mainId) => ipcRenderer.invoke('pi-compose:execute','linked-work-results',{cwd,mainId}),
  setWorkMainVisibility: (cwd,mainId,id,hidden) => ipcRenderer.invoke('pi-compose:execute','set-work-main-visibility',{cwd,mainId,id,hidden}),
  connectionFailed: (cwd,id,message) => ipcRenderer.invoke('pi-compose:execute','connection-failed',{cwd,id,message}),
  sessions: (cwd) => ipcRenderer.invoke('pi-compose:execute', 'sessions', { cwd }),
  create: (command, request) => ipcRenderer.invoke('pi-compose:execute', command, request)
}
