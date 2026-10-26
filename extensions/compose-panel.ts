import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { LaunchPlan } from '../src/launch.ts';

/** Display name never substitutes for the full user-approved task instruction. */
export function taskName(instruction: string, suppliedTitle?: string): string {
  return (suppliedTitle?.trim() || instruction.split('\n').find(s => s.trim()) || '새 작업')
    .replace(/\s+/g, ' ').trim().slice(0, 64);
}

/**
 * One native Pi confirmation for both natural language and slash delegation.
 * No custom Overlay, list renderer, timer, status manager or terminal cells.
 */
export async function approveLaunch(
  ctx: ExtensionContext, plan: LaunchPlan,
  origin: { current: boolean; title?: string; conversationPreview?: string[] },
): Promise<boolean> {
  if (!ctx.hasUI) return false;
  return (await ctx.ui.confirm('새 개발 Agent 실행', [
    '작업: ' + taskName(plan.task, origin.title),
    '맥락: ' + (plan.context === 'fork'
      ? (origin.current ? '현재 Pi 대화 Fork' : '선택한 저장 대화 Fork')
      : '독립 실행 · Main 대화 미전달'),
    '작업 공간: ' + (plan.workspace === 'worktree' ? '별도 Git Worktree' : '현재 디렉터리 Shared'),
    ...(plan.source ? ['원본 Pi 세션: ' + plan.source.id] : []),
    ...(plan.branch ? ['브랜치: ' + plan.branch] : []),
    ...plan.warnings.map(w => '주의: ' + w),
    '\n위임 지시 원문 (원본 Fork 대화 전체는 아님):',
    plan.task,
    ...(origin.conversationPreview?.length
      ? ['\n최근 사용자 발화 (대화 전체 아님):', ...origin.conversationPreview] : []),
    '\n승인하면 실제 Agent 및 필요한 Worktree를 생성합니다.',
  ].join('\n'))) === true;
}
