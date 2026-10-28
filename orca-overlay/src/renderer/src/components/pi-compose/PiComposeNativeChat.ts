import { adoptAgentSessionLaunchVerdict } from '@/lib/agent-session-launch-plan'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { beginStructuredAgentSessionProvisionalLaunch } from '@/lib/agent-session/structured-agent-session-provisional-tab'

/**
 * Resume the verified, already-forked Pi conversation in Orca Native Chat.
 * We must adopt its existing Pi provider session, never start a blank chat or
 * create a second fork. The user sends the first Work instruction afterward.
 */
export async function openPreparedWorkNativeChat(
  worktreeId: string,
  providerSessionId: string
): Promise<string> {
  if (!providerSessionId) throw new Error('Work의 Pi Fork 세션 ID가 없습니다.')
  const plan = adoptAgentSessionLaunchVerdict({
    route: 'structured-native-chat',
    requestId: newAgentLaunchRequestId(),
    agent: 'pi',
    worktreeId,
    resumeFrom: { providerSessionId }
  })
  const launch = beginStructuredAgentSessionProvisionalLaunch({
    plan,
    hooks: {},
    target: { worktreeId }
  })
  if (!launch) throw new Error('Orca Native Chat 생성이 시작되지 않았습니다.')
  const result = await launch.settlement
  if (result.kind === 'structured') return result.sessionId
  if (result.kind === 'visibility-unknown') {
    throw new Error('Orca 대화 생성 결과를 확인할 수 없습니다. 세션을 중복 생성하지 말고 기존 탭을 확인하세요.')
  }
  if (result.kind === 'failed') {
    throw new Error(result.error instanceof Error ? result.error.message : String(result.error))
  }
  throw new Error('Orca Native Chat이 열리지 않았습니다. 준비된 Pi 세션은 그대로 보존됩니다.')
}
