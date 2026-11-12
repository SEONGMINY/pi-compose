import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

/** Presentation only. This must never change the authority or delivery state. */
export type PolicyIndicatorState = {
  status: 'checked' | 'delivered' | 'pending' | 'unavailable';
  pendingCount: number;
  subject?: string;
  stop?: boolean;
  unreviewedApprovalCount?: number;
  unavailableReason?: 'owner' | 'read' | 'unknown';
};
export type PolicyNotice = {
  tone: 'warning' | 'error' | 'accent';
  /** Always safe to show as a single narrow terminal row. */
  compact: string;
  /** Used only if the Ghostty Split is wide enough. */
  detailed: string;
};

function safeSubject(subject: string | undefined): string {
  return (subject ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 90);
}

/**
 * Pending policy is not a request for another user approval.
 * Delivery is not proof that the policy was applied to files or tested.
 */
export function policyNotice(state: PolicyIndicatorState): PolicyNotice | undefined {
  if (state.stop) {
    return {
      tone: 'error',
      compact: '■ Main 중단 · 수정 제한',
      detailed: '■ Main 작업 중단 지시 · 후속 수정 실행 제한',
    };
  }
  if (state.status === 'checked') return undefined;

  if (state.status === 'unavailable') {
    if (state.unreviewedApprovalCount) {
      return {
        tone: 'warning',
        compact: '! Main 미확정 후보 · /compose policy',
        detailed: '! Main 승인 후보 ' + state.unreviewedApprovalCount + '건 미확정 · Main /compose policy',
      };
    }
    const reason = state.unavailableReason === 'owner'
      ? '정책 소유 Main 불명확'
      : state.unavailableReason === 'read'
        ? 'Main 정책 조회 실패'
        : 'Main 정책 최신성 확인 불가';
    return { tone: 'warning', compact: '! ' + reason, detailed: '! ' + reason };
  }

  if (state.status === 'delivered') {
    return {
      tone: 'accent',
      compact: '○ Main 정책 전달됨 · ><로 즉시 검토',
      detailed: '○ Main 정책 전달됨 · ><로 즉시 검토 가능 (반영은 별도 확인)',
    };
  }

  const count = Math.max(1, Math.trunc(state.pendingCount) || 1);
  const compact = '● Main 정책 ' + count + '건 · ><로 즉시 검토';
  const subject = count === 1 ? safeSubject(state.subject) : '';
  return {
    tone: 'warning',
    compact,
    detailed: subject
      ? '● Main 정책 ' + count + '건 · ' + subject + ' · 다음 응답 자동 전달 (><로 즉시 검토)'
      : compact,
  };
}

/** Responsive, guaranteed one-line rendering with accurate Korean/CJK cell widths. */
export function policyNoticeLine(notice: PolicyNotice, width: number): string {
  if (!Number.isFinite(width) || width <= 0) return '';
  const available = Math.floor(width);
  const text = visibleWidth(notice.detailed) <= available
    ? notice.detailed : notice.compact;
  return truncateToWidth(text, available, '…');
}
