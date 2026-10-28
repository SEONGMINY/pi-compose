import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useActiveWorktree } from '@/store/selectors'
import { createNewTerminalTab } from '@/components/terminal/terminal-tab-create'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { openWorkspaceCreationComposerWithTourHandoff } from '../contextual-tours/workspace-creation-tour-handoff'
import type { PiComposeListRecord, PiComposeResult } from '../../../../preload/api/pi-compose-bridge'
import { openPreparedWorkNativeChat } from './PiComposeNativeChat'
import { structuredLaunchOwner } from '@/lib/agent-session/structured-agent-session-provisional-tab'
import { admitStructuredLaunchOnHost } from '@/lib/structured-agent-session-host-admission'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'

type Role = 'main' | 'work' | 'support'
const ROLES: ReadonlyArray<{ id: Role; title: string; description: string }> = [
  { id: 'main', title: 'Main Agent', description: '요구사항·설계·의사결정의 원본 대화' },
  { id: 'work', title: 'Work Agent', description: '선택한 Main의 실제 Pi 세션 Fork' },
  { id: 'support', title: 'Support Agent', description: 'Main을 상속하지 않는 독립 조사·테스트' },
]
function shellQuote(path: string): string {
  return "'" + path.replaceAll("'", "'\\''") + "'"
}

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
  const linkedWorks = agents.filter((record) => record.role === 'work' && record.parentMainId === mainId)
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
  // The native Orca + button and project tree both open this same creation flow.
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

  useEffect(() => {
    if (!cwd) return
    const key = 'pi-compose.first-open.' + cwd
    try { if (window.localStorage.getItem(key) === 'shown') return }
    catch { return }
    let cancelled = false
    void window.api.piCompose.list(cwd).then(items => {
      if (cancelled || items.some(item => item.role === 'main')) return
      try { window.localStorage.setItem(key, 'shown') } catch { return }
      setRole('main')
      setOpen(true)
    }).catch(() => { /* the visible sidebar supplies a retry path */ })
    return () => { cancelled = true }
  }, [cwd])

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
      // Check Pi Native Chat support BEFORE creating a persistent Work in a
      // shared workspace. A definitive refusal must not leave an unusable fork.
      if (role === 'work' && workspace === 'shared') {
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
      const result: PiComposeResult = await window.api.piCompose.create(role === 'main' && mainMode === 'existing' ? 'import' : role, {
        cwd,
        ...(role === 'main' ? { title: title.trim(), ...(mainMode === 'existing' ? { sessionId: savedId } : {}) }
          : { mainId, title: task.trim(), workspace: workspace as 'shared' | 'worktree',
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
        // Orca, not Pi Compose, must own the resulting Git workspace and Git UI.
        await useAppStore.getState().fetchAllWorktrees({ hydrationPurge: 'defer' })
        const target = useAppStore.getState().allWorktrees().find(
          candidate => candidate.path === result.record.cwd
        )
        if (!target) {
          throw new Error('Git Worktree와 Pi 세션은 준비됐지만 Orca 작업 공간 등록을 확인하지 못했습니다. 기존 Agent를 중복 생성하지 말고 Orca 프로젝트 목록에서 작업 폴더를 가져와 주세요.')
        }
        targetWorktreeId = target.id
      }
      if (activateAndRevealWorkspace(targetWorktreeId) === false) {
        throw new Error('해당 Orca 작업 공간을 열지 못했습니다. Pi 세션은 준비된 상태로 보존됩니다.')
      }
      if (role === 'work') {
        // Adopt the prepared Pi session into Orca's original Native Chat.
        // There is no initial prompt: the user sends the first Work instruction.
        try {
          const chatSessionId = await openPreparedWorkNativeChat(targetWorktreeId, result.record.sessionId)
          await window.api.piCompose.attachChat(cwd, result.record.id, chatSessionId, targetWorktreeId)
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause)
          await window.api.piCompose.connectionFailed(cwd, result.record.id, message)
            .catch(() => { /* original launch failure is the important error */ })
          window.dispatchEvent(new Event('pi-compose:changed'))
          throw cause
        }
        window.dispatchEvent(new Event('pi-compose:changed'))
        setOpen(false)
        setTitle('')
        setTask('')
        return
      }
      const started = await new Promise<boolean>((resolve) => {
        createNewTerminalTab(targetWorktreeId, undefined, {
          startupCwd: result.record.cwd,
          command: 'sh ' + shellQuote(result.launcher),
          onSettled: resolve,
        })
      })
      if (!started) {
        throw new Error('Pi 세션은 준비됐지만 Orca 탭을 열지 못했습니다. 생성 화면에서 다시 생성하지 말고 기존 Agent를 열어주세요.')
      }
      // The terminal tab is owned by Orca, not by a second Pi Compose renderer.
      // Persist both identities so selecting this Agent reuses the live tab.
      const active = useAppStore.getState().getActiveTab(targetWorktreeId)
      if (active?.contentType === 'terminal') {
        useAppStore.getState().setTabCustomLabel(active.id,
          (role === 'main' ? 'Main · ' : role === 'work' ? 'Work · ' : 'Support · ') +
          result.record.title.slice(0, 60))
        try {
          await window.api.piCompose.attach(cwd,result.record.id,active.id,targetWorktreeId)
        } catch (cause) {
          setError('터미널은 열렸지만 Agent와 탭의 연결을 저장하지 못했습니다: ' +
            (cause instanceof Error ? cause.message : String(cause)))
          return
        }
      } else {
        setError('Pi 터미널은 생성됐지만 탭 식별을 확인하지 못했습니다. 기존 Agent에서 다시 열 수 있습니다.')
        return
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
          <button type="button" className="w-full rounded-md border border-border px-3 py-2 text-left text-xs hover:bg-muted"
            onClick={() => { setOpen(false); openWorkspaceCreationComposerWithTourHandoff() }} disabled={busy}>
            Orca 일반 작업 만들기 <span className="ml-1 text-muted-foreground">· Git 작업 공간 및 일반 Agent</span>
          </button>
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
          {agents.length > 0 && <details className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
            <summary className="cursor-pointer font-medium">이 프로젝트의 Agent · Context 출처</summary>
            <div className="mt-3 space-y-3">
              {mains.map((main) => <div key={main.id} className="space-y-1 rounded-md border border-border/60 p-2">
                <div className="font-semibold">Main Agent · {main.title}</div>
                <p className="text-muted-foreground">독립 Pi 설계 세션 · {main.sessionId}</p>
                {agents.filter((agent) => agent.parentMainId === main.id).map((agent) =>
                  <div key={agent.id} className="ml-2 border-l border-border pl-3 py-1">
                    <div>{agent.role === 'work' ? 'Work Agent' : 'Support Agent'} · {agent.title}</div>
                    <div className="text-muted-foreground">
                      {agent.role === 'work'
                        ? agent.proof?.allMatch
                          ? '원본 Pi 기록 일치 ' + agent.proof.copied + '/' + agent.proof.expected
                          : 'Fork 기록을 다시 확인해야 합니다'
                        : '독립 세션 · Main 대화 상속 없음'}
                    </div>
                  </div>)}
              </div>)}
            </div>
            <p className="mt-2 text-muted-foreground">기록의 일치는 모델의 의미 이해나 구현 완료를 뜻하지 않습니다.</p>
          </details>}
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
