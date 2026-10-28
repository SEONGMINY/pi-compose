import { adoptAgentSessionLaunchVerdict } from '@/lib/agent-session-launch-plan'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import {
  beginStructuredAgentSessionProvisionalLaunch,
  structuredLaunchOwner
} from '@/lib/agent-session/structured-agent-session-provisional-tab'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
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
  const owner = structuredLaunchOwner({ route: 'structured-native-chat' }, worktreeId)
  if (!owner) throw new Error('Orca Native Chat 소유 호스트가 확인되지 않았습니다.')
  const reply = await callStructuredAgentSession<
    { ok: true; sessionId: string } | { ok: false; refusal?: { code?: string } }
  >(owner.target, 'agentSession.reveal', { sessionId: orcaSessionId })
  if (reply?.ok === true) {
    return { sessionId: orcaSessionId, replacedClosed: false }
  }
  if (reply?.ok !== false || !reply.refusal) {
    throw new Error('기존 Orca Chat 상태를 확인할 수 없습니다. 중복 생성하지 않았습니다.')
  }
  const reason = reply.refusal.code
  // Only an explicitly closed/missing record can be replaced. Ownership,
  // timeout and transport faults must not become accidental second writers.
  if (!['agent_session_ownership_unknown', 'agent_session_identity_required'].includes(reason ?? '')) {
    throw new Error('Orca Chat을 다시 열 수 없습니다: ' + (reason || '알 수 없는 응답'))
  }
  const sessionId = await openPreparedPiNativeChat(worktreeId, providerSessionId)
  return { sessionId, replacedClosed: true }
}

// Keep older imports functional while callers move to role-neutral naming.
export const openPreparedWorkNativeChat = openPreparedPiNativeChat
