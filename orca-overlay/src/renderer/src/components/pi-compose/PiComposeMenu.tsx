import React, { useEffect, useState } from 'react'
import { Layers3 } from 'lucide-react'
import { useAppStore } from '@/store'
import { useActiveWorktree } from '@/store/selectors'
import { createNewTerminalTab } from '@/components/terminal/terminal-tab-create'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { PiComposeListRecord, PiComposeResult } from '../../../../preload/api/pi-compose-bridge'

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
  const [title, setTitle] = useState('')
  const [mainMode, setMainMode] = useState<'new'|'existing'>('new')
  const [saved, setSaved] = useState<{id:string;title:string;messageCount:number;path:string}[]>([])
  const [savedId, setSavedId] = useState('')
  const [task, setTask] = useState('')
  const [workspace, setWorkspace] = useState<'shared'|'worktree'>('worktree')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cwd = activeWorktree?.path ?? ''

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
    if (!cwd || !activeWorktreeId) {
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
    if (role !== 'main' && !task.trim()) {
      setError('실제로 수행할 작업을 입력하세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result: PiComposeResult = await window.api.piCompose.create(role === 'main' && mainMode === 'existing' ? 'import' : role, {
        cwd,
        ...(role === 'main' ? { title: title.trim(), ...(mainMode === 'existing' ? { sessionId: savedId } : {}) }
          : { mainId, task: task.trim(), workspace }),
      })
      if (role === 'work' && !result.proof?.allMatch) {
        throw new Error('원본 Main 컨텍스트 복제가 검증되지 않아 실행을 차단했습니다.')
      }
      const started = await new Promise<boolean>((resolve) => {
        createNewTerminalTab(activeWorktreeId, undefined, {
          startupCwd: result.record.cwd,
          command: 'sh ' + shellQuote(result.launcher),
          onSettled: resolve,
        })
      })
      if (!started) {
        throw new Error('Pi 세션은 안전하게 준비됐지만 Orca 터미널 생성에 실패했습니다. 새 작업을 중복 실행하지 마세요.')
      }
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
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs"
          className="text-muted-foreground" aria-label="Pi Compose Agent 만들기"
          onClick={() => { setOpen(true); setError('') }}>
          <Layers3 className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>Pi Compose · 새 Agent</TooltipContent>
    </Tooltip>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pi Compose Agent</DialogTitle>
          <DialogDescription>
            Orca 터미널에서 실제 Pi를 실행합니다. Main의 원본 설계 맥락은 보존됩니다.
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
                value={mainId} onChange={(event) => setMainId(event.target.value)} disabled={busy}>
                {!mains.length && <option value="">등록된 Main이 없습니다</option>}
                {mains.map((main) => <option key={main.id} value={main.id}>{main.title}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium">
              작업 지시
              <textarea className="mt-2 min-h-24 w-full rounded-md border border-input bg-background p-3"
                value={task} onChange={(event) => setTask(event.target.value)} disabled={busy}
                maxLength={5000} placeholder="구체적인 작업을 입력하세요."/>
            </label>
            <label className="block text-xs font-medium">
              Git 작업 폴더
              <select className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2"
                value={workspace} disabled={busy}
                onChange={(event) => setWorkspace(event.target.value as 'shared'|'worktree')}>
                <option value="worktree">별도 Worktree</option>
                <option value="shared">기존 작업 폴더 공유</option>
              </select>
            </label>
            {workspace === 'worktree' && <p className="text-xs leading-relaxed text-amber-500">
              별도 Git Worktree에서 Pi가 실행됩니다. 현재 Orca 작업 공간·Git 패널은
              자동으로 새 Worktree로 전환되지 않으므로 코드 변경은 해당 작업 폴더에서 확인하세요.
            </p>}
            {role === 'work' && <p className="text-xs leading-relaxed text-muted-foreground">
              Main의 실제 Pi 대화 전체를 복제하고 일치 여부를 검증한 후 실행합니다.
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
              disabled={busy || !cwd || (role !== 'main' && !mainId)}>
              {busy ? '세션 검증·준비 중…' : 'Agent 생성하고 실행'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>
}
