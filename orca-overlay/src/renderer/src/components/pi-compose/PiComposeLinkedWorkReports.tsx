import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { activateStructuredAgentSessionById } from '@/lib/agent-session/structured-agent-session-tab-activation'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import type { PiComposeLinkedWorkResult, PiComposeLinkedWorkSnapshot } from '../../../../preload/api/pi-compose-bridge'
import { NativeChatExpandable } from '../native-chat/NativeChatExpandable'
import { NativeChatToolRun } from '../native-chat/NativeChatToolRun'
import { MessageRow } from '../native-chat/NativeChatMessageRow'
import { NativeChatWorkingStatus } from '../native-chat/NativeChatWorkingStatus'
import { NativeChatReasoningRow } from '../native-chat/NativeChatReasoningRow'

/**
 * READ-ONLY view into another Pi session. It does not send a user/assistant
 * message to Main, change the Work session, or create a synthetic subagent.
 * Presentation uses Orca's actual transcript/tool rendering primitives.
 */
export function PiComposeLinkedWorkReports({
  orcaSessionId,
  worktreeId,
  isVisible
}: {
  orcaSessionId: string | null
  worktreeId: string | null
  isVisible: boolean
}): React.JSX.Element | null {
  const cwd = useAppStore(s => worktreeId
    ? s.getKnownWorktreeById(worktreeId)?.path ?? '' : '')
  const [main, setMain] = useState<{ sessionId: string; id: string | null }>({
    sessionId: '', id: null
  })
  const [unverified, setUnverified] = useState<{
    sessionId: string
    titles: string[]
  }>({ sessionId: '', titles: [] })
  const [unavailableSessionId, setUnavailableSessionId] = useState<string | null>(null)
  const [reports, setReports] = useState<{
    sessionId: string
    snapshot: PiComposeLinkedWorkSnapshot
  }>({ sessionId: '', snapshot: {items:[], unavailable:[], omittedWorkCount:0} })
  // A late Work read from a previously selected Main must not be displayed
  // under a different Main. Focus, Compose changes and polling share this fence.
  const readEpoch = useRef(0)
  const refresh = useCallback(async (alive: () => boolean) => {
    if (!cwd || !orcaSessionId || !isVisible) return
    const epoch = ++readEpoch.current
    const current = () => alive() && epoch === readEpoch.current
    try {
      const records = await window.api.piCompose.list(cwd)
      const selected = records.find(record =>
        record.role === 'main' && record.orcaSessionId === orcaSessionId)
      if (!current()) return
      setMain({ sessionId: orcaSessionId, id: selected?.id ?? null })
      setUnverified({
        sessionId: orcaSessionId,
        titles: selected ? records.filter(record =>
          record.role === 'work' && record.parentMainId === selected.id &&
          !record.hiddenFromMainAt && record.proof?.allMatch !== true
        ).map(record => record.title) : []
      })
      if (!selected) {
        setReports({sessionId:orcaSessionId,snapshot:{items:[],unavailable:[],omittedWorkCount:0}})
        setUnavailableSessionId(null)
        return
      }
      const snapshot = await window.api.piCompose.linkedWorkResults(cwd, selected.id)
      if (current()) {
        setReports({sessionId:orcaSessionId,snapshot})
        setUnavailableSessionId(null)
      }
    } catch {
      // Preserve the last confirmed report; never present failure as "no Work".
      if (current()) setUnavailableSessionId(orcaSessionId)
    }
  }, [cwd, orcaSessionId, isVisible])

  useEffect(() => {
    if (!isVisible || !orcaSessionId) return
    let alive = true
    const update = () => void refresh(() => alive)
    update()
    window.addEventListener('focus', update)
    window.addEventListener('pi-compose:changed', update)
    return () => {
      alive = false
      readEpoch.current += 1
      window.removeEventListener('focus', update)
      window.removeEventListener('pi-compose:changed', update)
    }
  }, [isVisible, orcaSessionId, refresh])

  // Read-only discovery of newly settled Pi replies while THIS Main is
  // visible. A finished response is not proof of completed development.
  useEffect(() => {
    if (!main.id || main.sessionId !== orcaSessionId ||
        !orcaSessionId || !cwd || !isVisible) return
    let alive = true
    const currentMainId = main.id
    const timer = setInterval(() => {
      const epoch = ++readEpoch.current
      void window.api.piCompose.linkedWorkResults(cwd, currentMainId).then(snapshot => {
        if (alive && epoch === readEpoch.current) {
          setReports({sessionId:orcaSessionId,snapshot})
          setUnavailableSessionId(null)
        }
      }).catch(() => {
        if (alive && epoch === readEpoch.current) setUnavailableSessionId(orcaSessionId)
      })
    }, 10_000)
    return () => { alive = false; clearInterval(timer) }
  }, [main.id, main.sessionId, cwd, orcaSessionId, isVisible])
  const unverifiedTitles = unverified.sessionId === orcaSessionId ? unverified.titles : []

  if (reports.sessionId !== orcaSessionId) {
    return unavailableSessionId === orcaSessionId ? (
      <p className="mt-5 text-xs text-chat-foreground-faint">
        연결된 Work 기록을 현재 확인할 수 없습니다. 원본 Orca Work 대화에서 상태를 확인해 주세요.
      </p>
    ) : null
  }
  if (reports.snapshot.items.length === 0 && reports.snapshot.unavailable.length === 0 &&
      reports.snapshot.omittedWorkCount === 0 && unavailableSessionId !== orcaSessionId &&
      unverifiedTitles.length === 0) return null
  return (
    <section aria-label="연결된 Work 결과" className="mt-5 space-y-3">
      {unavailableSessionId === orcaSessionId ? (
        <p className="text-xs text-chat-foreground-faint">
          현재 Work 기록 재조회에 실패했습니다. 아래 내용은 마지막으로 확인된 결과이며 최신 상태가 아닐 수 있습니다.
        </p>
      ) : null}
      {unverifiedTitles.length > 0 ? (
        <p className="text-xs text-chat-foreground-faint">
          {unverifiedTitles.length}개 Work의 Main Fork 출처를 확인할 수 없어 결과를 표시하지 않았습니다.
          원본 Pi 대화는 그대로 보존됩니다.
        </p>
      ) : null}
      {reports.snapshot.omittedWorkCount > 0 ? (
        <p className="text-xs text-chat-foreground-faint">
          과거 Work {reports.snapshot.omittedWorkCount}개는 목록 범위를 벗어났습니다. 원본 Orca History에서 확인하세요.
        </p>
      ) : null}
      {reports.snapshot.unavailable.map(work => (
        <p key={work.workId} className="text-xs text-chat-foreground-faint">
          {work.workTitle} · {work.reason === 'orca-unlinked'
            ? '원본 Orca Native Chat 연결을 확인할 수 없습니다.'
            : work.reason === 'pi-file-unavailable'
              ? '원본 Pi 대화 파일을 읽을 수 없습니다.'
              : '원본 Pi 대화 분기 또는 기록을 확인할 수 없습니다.'}
          {' '}결과 완료 여부를 추측하지 않습니다.
        </p>
      ))}
      {reports.snapshot.items.map(work => <WorkReport
        key={(work.workOrcaSessionId || work.workPiSessionId) + ':' + work.entryId} work={work} />)}
    </section>
  )
}

/** The toggle is the same disclosure mechanism used by Orca Native Chat. */
function WorkReport({work}: {work:PiComposeLinkedWorkResult}): React.JSX.Element {
  const [open,setOpen] = useState(false)
  const openSource = () => {
    if (!work.worktreeId || !work.workOrcaSessionId ||
        activateAndRevealWorkspace(work.worktreeId) === false ||
        !activateStructuredAgentSessionById({
          worktreeId: work.worktreeId, sessionId: work.workOrcaSessionId
        })) {
      toast.error('원본 Work 대화를 열지 못했습니다. 기록은 변경하지 않았습니다.')
    }
  }
  const firstLine = work.reportText.split('\n').find(line => line.trim())?.trim() ||
    'Work 응답이 종료됐습니다.'
  const reportMessage = {
    id: work.workId + ':' + work.entryId,
    role: 'assistant' as const,
    source: 'transcript' as const,
    blocks: [{ type: 'text' as const, text: work.reportText }],
    timestamp: work.observedAt ? Date.parse(work.observedAt) : null
  }
  return <div className="border-t border-border pt-2">
    <div className="min-w-0 px-1 text-sm">
      <span className="block text-chat-foreground-faint">연결된 Work · {work.workTitle}</span>
      <span className="block truncate text-chat-foreground">{firstLine}</span>
      {work.worktreeId && work.workOrcaSessionId ? (
        <button type="button" onClick={openSource}
          className="mt-1 text-xs text-chat-foreground-faint underline underline-offset-2 hover:text-chat-foreground">
          Orca에서 원본 Work 대화 열기
        </button>
      ) : null}
    </div>
    {work.workedSeconds !== null ? (
      <NativeChatWorkingStatus
        startedAt={null}
        workedSeconds={work.workedSeconds}
        expanded={open}
        onToggleExpanded={() => setOpen(previous => !previous)}
      />
    ) : (
      <button type="button" aria-expanded={open}
        onClick={() => setOpen(previous => !previous)}
        className="flex min-h-8 w-full items-center gap-2 border-b border-border text-left text-sm text-chat-foreground-faint">
        <span>Work 응답 상세</span>
        <ChevronRight aria-hidden="true" className={cn(
          'size-3.5 transition-transform motion-reduce:transition-none', open && 'rotate-90'
        )}/>
      </button>
    )}
    <NativeChatExpandable open={open}>
      <div className="space-y-3 pl-5 pt-3">
        {work.reasoning.map(item => (
          <NativeChatReasoningRow key={item.id}
            message={{
              id:item.id,
              role:'reasoning',
              timestamp:item.timestamp ? Date.parse(item.timestamp) : null
            }}
            markdown={item.text}
          />
        ))}
        {work.reportText ? (
          <MessageRow
            message={reportMessage}
            expandSignal={false}
            onScrollMessageToTop={element => element.scrollIntoView({block:'start'})}
          />
        ) : null}
        {work.toolBlocks.length ? (
          <NativeChatToolRun
            blocks={work.toolBlocks}
            expandSignal={false}
            disclosureId={work.workId + ':' + work.entryId + ':tools'}
            followsProse={Boolean(work.reportText)}
          />
        ) : null}
        {work.truncated || work.toolActivityTruncated ? (
          <p className="text-xs text-chat-foreground-faint">
            실행 내역의 일부만 표시할 수 있습니다. 전체 기록은 Orca의 Work 대화에 보존되어 있습니다.
          </p>
        ) : null}
      </div>
    </NativeChatExpandable>
  </div>
}
