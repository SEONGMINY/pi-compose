import { adoptAgentSessionLaunchVerdict } from '@/lib/agent-session-launch-plan'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import {
  beginStructuredAgentSessionProvisionalLaunch
} from '@/lib/agent-session/structured-agent-session-provisional-tab'
import { revealStructuredSession } from '@/lib/activate-ai-vault-structured-session'
import { useAppStore } from '@/store'

export async function openPreparedPiNativeChat(
  worktreeId: string,
  providerSessionId: string
): Promise<string> {
  if (!providerSessionId) throw new Error('Pi 세션 ID가 없습니다.')
  const plan = adoptAgentSessionLaunchVerdict({
    route: 'structured-native-chat',
    requestId: newAgentLaunchRequestId(),
    agent: 'pi',
    worktreeId,
    resumeFrom: { providerSessionId }
  })
  const launch = beginStructuredAgentSessionProvisionalLaunch({
    plan, hooks: {}, target: { worktreeId }
  })
  if (!launch) throw new Error('Native Chat 생성이 시작되지 않았습니다.')
  const result = await launch.settlement
  if (result.kind === 'structured') return result.sessionId
  if (result.kind === 'visibility-unknown') {
    throw new Error('Native Chat 생성 여부가 불확실합니다. 중복 생성을 피하기 위해 기존 탭을 확인하세요.')
  }
  if (result.kind === 'failed') {
    throw new Error(result.error instanceof Error ? result.error.message : String(result.error))
  }
  throw new Error('Native Chat을 열지 못했습니다. Pi 세션은 그대로 보존됩니다.')
}

/**
 * Closing a Native Chat tab may unpublish its tab or close the host record.
 * Only after the host explicitly refuses reveal may we adopt the saved Pi
 * transcript into a new Orca session (never create another Pi fork).
 */
export async function reopenPiNativeChat(
  worktreeId: string,
  providerSessionId: string,
  orcaSessionId: string
): Promise<{ sessionId: string; replacedClosed: boolean }> {
  const current = useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? []
  if (current.some(tab => tab.contentType === 'agent-session' &&
    tab.entityId === orcaSessionId)) {
    return { sessionId: orcaSessionId, replacedClosed: false }
  }
  const outcome = await revealStructuredSession({ worktreeId, sessionId: orcaSessionId })
  if (outcome === 'revealed') {
    return { sessionId: orcaSessionId, replacedClosed: false }
  }
  if (outcome !== 'gone') {
    throw new Error(outcome === 'host-cannot-open'
      ? 'Orca가 이 Chat을 다시 열 수 없습니다. 기존 Pi 기록은 보존됩니다.'
      : 'Orca 호스트에서 세션 상태를 확인하지 못했습니다. 중복 생성하지 않았습니다.')
  }
  const sessionId = await openPreparedPiNativeChat(worktreeId, providerSessionId)
  return { sessionId, replacedClosed: true }
}

// Keep older imports functional while callers move to role-neutral naming.
export const openPreparedWorkNativeChat = openPreparedPiNativeChat
