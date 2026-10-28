import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useActiveWorktree } from '@/store/selectors'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { PiComposeListRecord, PiComposeResult } from '../../../../preload/api/pi-compose-bridge'
import { openPreparedPiNativeChat } from './PiComposeNativeChat'
import { structuredLaunchOwner } from '@/lib/agent-session/structured-agent-session-provisional-tab'
import { admitStructuredLaunchOnHost } from '@/lib/structured-agent-session-host-admission'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { supportsStructuredAgentSessionRename } from '@/runtime/structured-agent-session-client'

type Role = 'main' | 'work' | 'support'
const ROLES: ReadonlyArray<{ id: Role; title: string; description: string }> = [
  { id: 'main', title: 'Main Agent', description: '요구사항·설계·의사결정의 원본 대화' },
  { id: 'work', title: 'Work Agent', description: '선택한 Main의 실제 Pi 세션 Fork' },
  { id: 'support', title: 'Support Agent', description: 'Main을 상속하지 않는 독립 조사·테스트' },
]
/**
 * Thin native Orca UI. All session and Git mutations go through main IPC.
 * Pi Compose never reimplements Orca terminals/tabs/worktree navigation.
 */
export function PiComposeMenu(): React.JSX.Element {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeWorktree = useActiveWorktree()
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<Role>('main')
  const [agents, setAgents] = useState<PiComposeListRecord[]>([])
  const mains = agents.filter((record) => record.role === 'main')
  const [mainId, setMainId] = useState('')
  const linkedWorks = agents.filter((record) => record.role === 'work' && record.parentMainId === mainId && !record.hiddenFromMainAt)
  const [title, setTitle] = useState('')
  const [mainMode, setMainMode] = useState<'new'|'existing'>('new')
  const [saved, setSaved] = useState<{id:string;title:string;messageCount:number;path:string}[]>([])
  const [savedId, setSavedId] = useState('')
  const [task, setTask] = useState('')
  const [relatedWorkId, setRelatedWorkId] = useState('')
  const [workspace, setWorkspace] = useState<'shared'|'worktree'|''>('')
  const [busy, setBusy] = useState(false)
  const [preparedId, setPreparedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [sourceWorkspace, setSourceWorkspace] = useState<{ cwd: string; worktreeId: string } | null>(null)
  const cwd = sourceWorkspace?.cwd ?? activeWorktree?.path ?? ''
  const selectedWorktreeId = sourceWorkspace?.worktreeId ?? activeWorktreeId
  // Pi Compose creation is explicit; Orca's native New Workspace button is untouched.
  useEffect(() => {
    const openMenu = (event: Event) => {
      const picked = (event as CustomEvent<{ role?: Role; mainId?: string; relatedWorkId?: string; projectCwd?: string; projectWorktreeId?: string }>).detail
      setSourceWorkspace(picked?.projectCwd && picked.projectWorktreeId
        ? { cwd: picked.projectCwd, worktreeId: picked.projectWorktreeId }
        : null)
      if (picked?.role) setRole(picked.role)
      if (picked?.mainId) setMainId(picked.mainId)
      setRelatedWorkId(picked?.relatedWorkId || '')
      setWorkspace('')
      setOpen(true); setError(''); setPreparedId(null)
    };
    window.addEventListener('pi-compose:new',openMenu);
    return () => window.removeEventListener('pi-compose:new',openMenu);
  }, [])

  const refresh = async () => {
    if (!cwd) return
    try {
      const list = await window.api.piCompose.list(cwd)
      const mainRecords = list.filter((record) => record.role === 'main')
      setAgents(list)
      setMainId((previous) =>
        mainRecords.some((record) => record.id === previous) ? previous : mainRecords[0]?.id ?? '')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  useEffect(() => {
    if (!open) return
    setError('')
    void refresh()
  }, [open, cwd])

  useEffect(() => {
    if (!open || role !== 'main' || mainMode !== 'existing' || !cwd) return;
    void window.api.piCompose.sessions(cwd).then(items => {
      setSaved(items);
      setSavedId(previous=>items.some(item=>item.id===previous)?previous:items[0]?.id||'');
      if(items.length) setTitle(previous=>previous||items[0].title);
    }).catch(cause=>setError(String(cause)));
  }, [open, cwd, role, mainMode]);
  const onLaunch = async () => {
    if (preparedId) {
      setError('이미 Agent가 준비됐습니다. 사이드바에서 해당 Agent를 선택해 기존 세션을 열어주세요.')
      return
    }
    if (!cwd || !selectedWorktreeId) {
      setError('먼저 로컬 Git 작업 공간을 선택하세요.')
      return
    }
    if (role !== 'main' && !mainId) {
      setError('이 프로젝트의 Main Agent를 먼저 만드세요.')
      return
    }
    if (role === 'main' && mainMode === 'existing' && !savedId) {
      setError('가져올 Pi 대화를 선택하세요.'); return;
    }
    if (role === 'main' && !title.trim()) {
      setError('Main 이름을 입력하세요.')
      return
    }
    if (role !== 'main' && !workspace) {
      setError('코드를 실행할 작업 공간을 선택하세요.')
      return
    }
    if (role !== 'main' && !task.trim()) {
      setError('Work 또는 Support 이름을 입력하세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      // All three roles use the same native chat transport.
      if (role === 'main' || workspace === 'shared') {
        const owner = structuredLaunchOwner(
          { route: 'structured-native-chat' }, selectedWorktreeId
        )
        if (!owner) {
          throw new Error('Orca에서 이 작업 공간의 Native Chat 실행 호스트를 확인할 수 없습니다.')
        }
        const admission = await admitStructuredLaunchOnHost(
          owner.target, toRuntimeWorktreeSelector(selectedWorktreeId), 'pi'
        )
        if (admission.kind !== 'admitted') {
          const reason = admission.kind === 'declined'
            ? (admission.reason || 'Pi Native Chat 미지원')
            : 'Orca 실행 호스트를 확인할 수 없음'
          throw new Error('Work를 생성하지 않았습니다. Native Chat 준비 불가: ' + reason)
        }
      }
      // Validate the exact source branch BEFORE asking Orca to create a checkout.
      // Invalid/stale/multi-branch sources must not strand a Git Worktree.
      const forkPreview = role === 'work'
        ? await window.api.piCompose.previewWorkFork(cwd, mainId)
        : null
      let managedWorktree: { id: string; path: string } | undefined
      if (role !== 'main' && workspace === 'worktree') {
        const source = useAppStore.getState().getKnownWorktreeById(selectedWorktreeId)
        if (!source?.repoId || !source.branch) {
          throw new Error('Orca에서 기준 Git 브랜치와 프로젝트를 확인할 수 없습니다.')
        }
        const branch = source.branch.replace(/^refs\/heads\//, '')
        const owner = structuredLaunchOwner(
          { route: 'structured-native-chat' }, selectedWorktreeId
        )
        if (!owner || owner.target.kind !== 'local') {
          throw new Error('현재 Pi Compose 기록 브리지는 로컬 호스트만 지원합니다. 원격 작업 공간은 생성하지 않았습니다.')
        }
        // Reuse Orca's actual managed creation, host routing, branch collision
        // handling, registry and Git UI. No startup agent/prompt is passed.
        const suffix = window.crypto.randomUUID().slice(0, 8)
        const created = await useAppStore.getState().createWorktree(
          source.repoId, `compose-${role}-${suffix}`, branch, 'inherit'
        )
        if (!created.worktree?.id || !created.worktree?.path) {
          throw new Error('Orca의 Worktree 생성 영수증을 받지 못했습니다.')
        }
        managedWorktree = { id: created.worktree.id, path: created.worktree.path }
      }
      const result: PiComposeResult = await window.api.piCompose.create(role === 'main' && mainMode === 'existing' ? 'import' : role, {
        cwd,
        ...(role === 'main' ? { title: title.trim(), ...(mainMode === 'existing' ? { sessionId: savedId } : {}) }
          : { mainId, title: task.trim(), workspace: workspace as 'shared' | 'worktree',
              ...(forkPreview ? { expectedSourceEntryId: forkPreview.sourceEntryId } : {}),
              ...(managedWorktree ? { managedWorktree } : {}),
              ...(role === 'support' && relatedWorkId ? { relatedWorkId } : {}) }),
      })
      if (role === 'work' && !result.proof?.allMatch) {
        throw new Error('원본 Main 컨텍스트 복제가 검증되지 않아 실행을 차단했습니다.')
      }
      if (role === 'work' && result.record.excludedInProgress) {
        toast.info('Main의 진행 중인 응답은 Work에 포함하지 않았습니다.', {
          description: '마지막으로 완료된 Pi 응답까지 Fork했습니다. Main의 이후 변경 사항은 이 Work에 자동 반영되지 않습니다.'
        })
      }
      // Preparation and terminal launch are different outcomes. Always reveal a
      // prepared record in the sidebar, even if Orca fails to open its tab.
      setPreparedId(result.record.id)
      window.dispatchEvent(new Event('pi-compose:changed'))
      let targetWorktreeId = selectedWorktreeId
      if (result.record.workspace === 'worktree') {
        if (!managedWorktree ||
            result.record.orcaWorktreeId !== managedWorktree.id ||
            result.record.cwd !== managedWorktree.path) {
          throw new Error('Orca 생성 영수증과 준비된 Pi 대화의 작업 공간 ID가 다릅니다. 자산은 보존했습니다.')
        }
        targetWorktreeId = managedWorktree.id
      } else if (role === 'support' && relatedWorkId) {
        // Linked Support in shared mode follows the Work's real execution
        // workspace. Do not accidentally attach it to the currently selected Main.
        const related = agents.find(record => record.id === relatedWorkId)
        if (related?.orcaWorktreeId) targetWorktreeId = related.orcaWorktreeId
      }
      if (activateAndRevealWorkspace(targetWorktreeId) === false) {
        throw new Error('해당 Orca 작업 공간을 열지 못했습니다. Pi 세션은 준비된 상태로 보존됩니다.')
      }
      // Adopt the exact prepared Pi session, with no implicit prompt. For an
      // already-running TUI import Orca may refuse a second writer; preserve it.
      try {
        const chatSessionId = await openPreparedPiNativeChat(targetWorktreeId, result.record.sessionId)
        await window.api.piCompose.attachChat(cwd, result.record.id, chatSessionId, targetWorktreeId)
        // Orca's host-owned conversation name is the single source used by
        // tabs, Agent rows, session history and other connected clients.
        // Do not add a second Pi Compose label renderer.
        try {
          const owner = structuredLaunchOwner(
            { route: 'structured-native-chat' }, targetWorktreeId
          )
          if (owner && await supportsStructuredAgentSessionRename(owner.target)) {
            const roleName = role === 'main' ? 'Main' : role === 'work' ? 'Work' : 'Support'
            await callRuntimeRpc(owner.target, 'agentSession.rename', {
              sessionId: chatSessionId,
              name: roleName + ' · ' + result.record.title
            })
          }
        } catch (renameError) {
          console.warn('[Pi Compose] Orca 원본 대화 이름 적용 실패', renameError)
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        await window.api.piCompose.connectionFailed(cwd, result.record.id, message)
          .catch(() => { /* preserve initial error */ })
        window.dispatchEvent(new Event('pi-compose:changed'))
        throw cause
      }
      window.dispatchEvent(new Event('pi-compose:changed'))
      setOpen(false)
      setTitle('')
      setTask('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pi Compose Agent</DialogTitle>
          <DialogDescription>
            Main의 설계 컨텍스트를 보존합니다. Work와 Support는 먼저 대화만 준비하고 작업 지시는 직접 입력합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="text-xs text-muted-foreground">
            프로젝트: {cwd || '선택되지 않음'}
          </div>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Agent 역할">
            {ROLES.map((item) => <button key={item.id} type="button"
              className={'rounded-lg border p-2.5 text-left text-xs ' +
                (role===item.id?'border-primary bg-primary/10':'border-border hover:bg-muted')}
              onClick={() => { setRole(item.id); setError('') }} disabled={busy}>
              <strong>{item.title}</strong>
              <span className="mt-2 block leading-relaxed text-muted-foreground">{item.description}</span>
            </button>)}
          </div>
          {role === 'main' ? <div className="space-y-3">
            <div className="flex gap-2" role="group" aria-label="Main 대화 시작 방식">
              <Button variant={mainMode==='new'?'default':'outline'} size="sm"
                onClick={()=>{setMainMode('new');setError('')}} disabled={busy}>새 대화</Button>
              <Button variant={mainMode==='existing'?'default':'outline'} size="sm"
                onClick={()=>{setMainMode('existing');setError('')}} disabled={busy}>기존 Pi 대화 가져오기</Button>
            </div>
            {mainMode==='existing' && <label className="block text-xs font-medium">
              기존 Pi 대화
              <select className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2"
                value={savedId} onChange={event=>{
                  const value=event.target.value;setSavedId(value);
                  setTitle(saved.find(item=>item.id===value)?.title||'');
                }} disabled={busy}>
                {!saved.length && <option value="">이 프로젝트에 저장된 Pi 대화가 없습니다</option>}
                {saved.map(item=><option value={item.id} key={item.id}>
                  {item.title} · {item.messageCount}개 메시지
                </option>)}
              </select>
            </label>}
            <label className="block text-xs font-medium">
            Main 대화 이름
            <input className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3"
              value={title} onChange={(event) => setTitle(event.target.value)}
              placeholder="예: 회원가입 설계" disabled={busy} maxLength={200}/>
            </label>
          </div> : <>
            <label className="block text-xs font-medium">
              이어받을 Main (Support는 작업 관계만 연결)
              <select className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2"
                value={mainId} onChange={(event) => { setMainId(event.target.value); setRelatedWorkId('') }} disabled={busy}>
                {!mains.length && <option value="">등록된 Main이 없습니다</option>}
                {mains.map((main) => <option key={main.id} value={main.id}>{main.title}</option>)}
              </select>
            </label>
            {role === 'support' && <label className="block text-xs font-medium">
              결과를 전달할 Work (선택 사항)
              <select className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2"
                value={relatedWorkId} onChange={event => setRelatedWorkId(event.target.value)} disabled={busy}>
                <option value="">아직 연결하지 않음</option>
                {linkedWorks.map(work => <option value={work.id} key={work.id}>{work.title}</option>)}
              </select>
            </label>}
            <label className="block text-xs font-medium">
              Agent 이름
              <input className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3"
                value={task} onChange={(event) => { setTask(event.target.value); setError('') }} disabled={busy}
                maxLength={100} placeholder={role === 'work' ? '예: 로그인 구현' : '예: 테스트 검증'}/>
            </label>
            <label className="block text-xs font-medium">
              Git 작업 폴더
              <select className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2"
                value={workspace} disabled={busy}
                onChange={(event) => setWorkspace(event.target.value as 'shared'|'worktree'|'')}>
                <option value="" disabled>작업 공간을 선택해 주세요</option>
                <option value="shared">{role === 'support' && relatedWorkId ? '연결된 Work의 작업 폴더 사용' : '현재 작업 폴더 사용'}</option>
                <option value="worktree">별도 Worktree 생성</option>
              </select>
            </label>
            {workspace === 'worktree' && <p className="text-xs leading-relaxed text-amber-500">
              별도 Git Worktree에서 Pi가 실행됩니다. 현재 Orca 작업 공간·Git 패널은
              자동으로 새 Worktree로 전환되지 않으므로 코드 변경은 해당 작업 폴더에서 확인하세요.
            </p>}
            {role === 'work' && <p className="text-xs leading-relaxed text-muted-foreground">
              Main의 마지막 완료된 응답까지 Fork합니다. 진행 중인 응답은 제외되며, Work는 작업 지시를 기다립니다.
              Main의 이후 대화나 Work의 실행 로그는 자동 전달되지 않습니다.
            </p>}
          </>}
          {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>}
          {!cwd && <p className="text-xs text-muted-foreground">먼저 Orca에서 로컬 Git 프로젝트를 선택하세요.</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>취소</Button>
            <Button onClick={() => void onLaunch()}
              disabled={busy || Boolean(preparedId) || !cwd || (role !== 'main' && (!mainId || !workspace))}>
              {busy ? '세션 검증·준비 중…' : preparedId ? '기존 Agent에서 다시 열기' : role === 'main' ? 'Main 대화 열기' : 'Agent 준비하고 대화 열기'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>
}
