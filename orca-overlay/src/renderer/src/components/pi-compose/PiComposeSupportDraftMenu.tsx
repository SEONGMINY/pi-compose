import type React from 'react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { activateStructuredAgentSessionById } from '@/lib/agent-session/structured-agent-session-tab-activation'
import {
  appendToNativeChatComposerDraft,
  readNativeChatComposerDraft,
  structuredAgentSessionDraftScopeKey,
  waitForNativeChatComposerDrafts,
  nativeChatComposerDraftWriteSettled
} from '../native-chat/native-chat-composer-draft-store'
import type { PiComposeListRecord } from '../../../../preload/api/pi-compose-bridge'

/** Reuses Orca's own unsent draft store; never sends any prompt to Work. */
export function PiComposeSupportDraftMenu({
  cwd, orcaSessionId
}: {
  cwd: string
  orcaSessionId: string
}): React.JSX.Element | null {
  const [support, setSupport] = useState<PiComposeListRecord | null>(null)
  const [works, setWorks] = useState<PiComposeListRecord[]>([])
  useEffect(() => {
    let current = true
    void window.api.piCompose.list(cwd).then(records => {
      if (!current) return
      const found = records.find(record =>
        record.role === 'support' && record.orcaSessionId === orcaSessionId)
      setSupport(found ?? null)
      setWorks(found ? records.filter(record =>
        record.role === 'work' &&
        record.parentMainId === found.parentMainId &&
        !record.hiddenFromMainAt && Boolean(record.orcaSessionId && record.orcaWorktreeId)
      ) : [])
    }).catch(() => {
      if (current) { setSupport(null); setWorks([]) }
    })
    return () => { current = false }
  }, [cwd, orcaSessionId])

  if (!support || works.length === 0) return null

  const sendAsDraft = async (work: PiComposeListRecord) => {
    if (!work.orcaSessionId || !work.orcaWorktreeId) return
    try {
      const result = await window.api.piCompose.supportResult(cwd, support.id)
      if (result.truncated) {
        toast.error('Support 결과가 길어 일부가 잘렸습니다. 전체 원본을 확인한 뒤 보내주세요.')
        return
      }
      await waitForNativeChatComposerDrafts(2500)
      const scope = structuredAgentSessionDraftScopeKey(work.orcaSessionId)
      const sourceTag = '[Support: ' + result.supportTitle + ' · ' + result.entryId + ']'
      if (readNativeChatComposerDraft(scope).text.includes(sourceTag)) {
        toast.info('이 Support 결과가 이미 Work의 초안에 있습니다.')
        return
      }
      const text = sourceTag + '\n' + result.text
      if (!appendToNativeChatComposerDraft(scope, {text})) {
        toast.error('Orca 초안 저장에 실패했습니다. Support 결과는 보존됩니다.')
        return
      }
      if (!(await nativeChatComposerDraftWriteSettled(scope))) {
        toast.error('초안 영속 저장을 확인할 수 없습니다. Work에서 초안을 확인해 주세요.')
        return
      }
      const activated = activateAndRevealWorkspace(work.orcaWorktreeId) !== false
      const opened = activated && activateStructuredAgentSessionById({
        worktreeId: work.orcaWorktreeId, sessionId: work.orcaSessionId
      })
      toast.success(opened
        ? 'Work 입력창에 미전송 초안을 추가했습니다.'
        : 'Work의 미전송 초안을 저장했습니다. Work 대화를 열어 확인해 주세요.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Support 결과 전달 실패')
    }
  }
  return <DropdownMenuSub>
    <DropdownMenuSubTrigger>Support 결과를 Work 초안에 추가…</DropdownMenuSubTrigger>
    <DropdownMenuSubContent className="w-72">
      {works.map(work => (
        <DropdownMenuItem key={work.id} onSelect={() => void sendAsDraft(work)}>
          <span className="max-w-64 truncate">{work.title}</span>
          {work.id === support.relatedWorkId ? <span className="ml-auto text-xs text-muted-foreground">연결됨</span> : null}
        </DropdownMenuItem>
      ))}
    </DropdownMenuSubContent>
  </DropdownMenuSub>
}
