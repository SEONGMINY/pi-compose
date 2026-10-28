import React, { useCallback, useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { activateStructuredAgentSessionById } from '@/lib/agent-session/structured-agent-session-tab-activation'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import type { PiComposeLinkedWorkResult } from '../../../../preload/api/pi-compose-bridge'
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
  const [mainId, setMainId] = useState<string | null>(null)
  const [unavailableSessionId, setUnavailableSessionId] = useState<string | null>(null)
  const [reports, setReports] = useState<{
    sessionId: string
    items: PiComposeLinkedWorkResult[]
  }>({ sessionId: '', items: [] })
  const refresh = useCallback(async (alive: () => boolean) => {
    if (!cwd || !orcaSessionId || !isVisible) return
    try {
      const records = await window.api.piCompose.list(cwd)
      const main = records.find(record =>
        record.role === 'main' && record.orcaSessionId === orcaSessionId)
      if (!alive()) return
      setMainId(main?.id ?? null)
      if (!main) {
        setReports({sessionId:orcaSessionId,items:[]})
        setUnavailableSessionId(null)
        return
      }
      const items = await window.api.piCompose.linkedWorkResults(cwd, main.id)
      if (alive()) {
        setReports({sessionId:orcaSessionId,items})
        setUnavailableSessionId(null)
      }
    } catch {
      // Keep the last *verified* report and distinguish a failed read from
      // genuinely no completed Work result. Never invent a newer status.
      if (alive()) setUnavailableSessionId(orcaSessionId)
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
      window.removeEventListener('focus', update)
      window.removeEventListener('pi-compose:changed', update)
    }
  }, [isVisible, orcaSessionId, refresh])

  // The Orca host provides the actual Work's execution status; this read-only
  // interval discovers newly settled Pi responses without fabricating a task-done
  // event. Poll only while a confirmed Main chat is visible.
  useEffect(() => {
    if (!mainId || !orcaSessionId || !cwd || !isVisible) return
    let alive = true
    const timer = setInterval(() => {
      void window.api.piCompose.linkedWorkResults(cwd, mainId).then(items => {
        if (alive) {
          setReports({sessionId:orcaSessionId,items})
          setUnavailableSessionId(null)
        }
      }).catch(() => {
        if (alive) setUnavailableSessionId(orcaSessionId)
      })
    }, 10_000)
    return () => { alive = false; clearInterval(timer) }
  }, [mainId, cwd, orcaSessionId, isVisible])

  if (reports.sessionId !== orcaSessionId) {
    return unavailableSessionId === orcaSessionId ? (
      <p className="mt-5 text-xs text-chat-foreground-faint">
        연결된 Work 기록을 현재 확인할 수 없습니다. 원본 Orca Work 대화에서 상태를 확인해 주세요.
      </p>
    ) : null
  }
  if (reports.items.length === 0 && unavailableSessionId !== orcaSessionId) return null
  return (
    <section aria-label="연결된 Work 결과" className="mt-5 space-y-3">
      {unavailableSessionId === orcaSessionId ? (
        <p className="text-xs text-chat-foreground-faint">
          현재 Work 기록 재조회에 실패했습니다. 아래 내용은 마지막으로 확인된 결과이며 최신 상태가 아닐 수 있습니다.
        </p>
      ) : null}
      {reports.items.map(work => <WorkReport key={work.workId + ':' + work.entryId} work={work} />)}
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
