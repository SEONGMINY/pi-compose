import React, { useCallback, useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import type { PiComposeLinkedWorkResult } from '../../../../preload/api/pi-compose-bridge'
import { NativeChatExpandable } from '../native-chat/NativeChatExpandable'
import { NativeChatToolRun } from '../native-chat/NativeChatToolRun'
import { MessageRow } from '../native-chat/NativeChatMessageRow'

/**
 * READ-ONLY view into another Pi session. It does not send a user/assistant
 * message to Main, change the Work session, or create a synthetic subagent.
 * Presentation uses Orca's actual transcript/tool rendering primitives.
 */
export function PiComposeLinkedWorkReports({
  orcaSessionId,
  isVisible
}: {
  orcaSessionId: string | null
  isVisible: boolean
}): React.JSX.Element | null {
  const cwd = useAppStore(s => {
    const id = s.activeWorktreeId
    return id ? s.getKnownWorktreeById(id)?.path ?? '' : ''
  })
  const [reports, setReports] = useState<{
    sessionId: string
    items: PiComposeLinkedWorkResult[]
  }>({ sessionId: '', items: [] })
  const refresh = useCallback(async (alive: () => boolean) => {
    if (!cwd || !orcaSessionId || !isVisible || !orcaSessionId.startsWith('pi_')) return
    try {
      const records = await window.api.piCompose.list(cwd)
      const main = records.find(record =>
        record.role === 'main' && record.orcaSessionId === orcaSessionId)
      if (!alive()) return
      if (!main) {
        setReports({sessionId:orcaSessionId,items:[]})
        return
      }
      const items = await window.api.piCompose.linkedWorkResults(cwd, main.id)
      if (alive()) setReports({sessionId:orcaSessionId,items})
    } catch {
      // Inaccessible hosts must not manufacture completion or corrupt Main.
      if (alive()) setReports({sessionId:orcaSessionId,items:[]})
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

  if (reports.sessionId !== orcaSessionId || reports.items.length === 0) return null
  return (
    <section aria-label="연결된 Work 결과" className="mt-5 space-y-3">
      {reports.items.map(work => <WorkReport key={work.workId + ':' + work.entryId} work={work} />)}
    </section>
  )
}

/** The toggle is the same disclosure mechanism used by Orca Native Chat. */
function WorkReport({work}: {work:PiComposeLinkedWorkResult}): React.JSX.Element {
  const [open,setOpen] = useState(false)
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
    <button type="button"
      aria-expanded={open}
      onClick={() => setOpen(previous => !previous)}
      className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left font-sans text-sm text-chat-foreground hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <ChevronRight aria-hidden="true" className={cn(
        'mt-0.5 size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
        open && 'rotate-90'
      )}/>
      <span className="min-w-0">
        <span className="block text-chat-foreground-faint">연결된 Work · {work.workTitle}</span>
        <span className="block break-words">{firstLine}</span>
      </span>
    </button>
    <NativeChatExpandable open={open}>
      <div className="space-y-3 pl-5 pt-3">
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
        {work.truncated ? (
          <p className="text-xs text-chat-foreground-faint">
            긴 결과의 일부만 표시합니다. 전체 원본은 Work 대화에 보존되어 있습니다.
          </p>
        ) : null}
      </div>
    </NativeChatExpandable>
  </div>
}
