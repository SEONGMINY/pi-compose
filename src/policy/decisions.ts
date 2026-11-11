import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Never auto-forward obvious credentials from conversation history. */
export function containsSensitivePolicyText(text:string):boolean {
  return /(?:password|private.?key|api.?key|secret|credential|authorization|bearer)\s*[:=]/i.test(text) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text);
}

export const DECISION_ENTRY = 'compose_policy_decision';
export const REVIEW_ENTRY = 'compose_policy_reviewed';
export const POLICY_MESSAGE = 'compose_policy_update';

export const decisionSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  mainSessionId: z.string().min(1),
  approvalEntryId: z.string().min(1),
  sourceEntryId: z.string().min(1),
  approvalQuote: z.string().min(1).max(1200),
  sourceQuote: z.string().min(1).max(1600),
  subject: z.string().min(1).max(140),
  decision: z.string().min(1).max(1600),
  reason: z.string().max(800),
  scope: z.enum(['owner-main', 'specific-work']),
  targetWorkIds: z.array(z.string().min(1)).max(30).default([]),
  effective: z.enum(['now', 'next-task', 'stop']),
  supersedesId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export type PolicyDecision = z.infer<typeof decisionSchema>;

export function decisionId(mainId: string, approvalId: string, sourceId: string, quote: string): string {
  return createHash('sha256').update(JSON.stringify([
    'compose-policy-v1', mainId, approvalId, sourceId, quote,
  ])).digest('hex');
}

/** Cheap lexical prefilter. Never treat matching text as approval by itself. */
export function couldBeApproval(text: string): boolean {
  if (!text.trim() || text.length > 12000) return false;
  return /(?:확정|결정|채택|승인|선택|적용|진행(?:해|하|합)|바꾸|변경|중단|폐기|제외|좋습니다|좋아요|동의|이대로|그렇게|하지\s*마|금지|finaliz|approv|decid|go ahead|proceed|stop|cancel)/i.test(text);
}

export function textParts(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(p => p && typeof p === 'object' && p.type === 'text' &&
    typeof p.text === 'string').map(p => p.text as string).join('\n');
}
type BranchEntry = { id: string; type: string; customType?: string;
  data?: unknown; message?: { role?: string; content?: unknown };
  details?: unknown };
export function branchDecisions(entries: readonly BranchEntry[], mainSessionId: string): PolicyDecision[] {
  const byId = new Map(entries.map(e => [e.id, e]));
  const result: PolicyDecision[] = [];
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== DECISION_ENTRY) continue;
    const parsed = decisionSchema.safeParse(entry.data);
    if (!parsed.success || parsed.data.mainSessionId !== mainSessionId) continue;
    const d = parsed.data;
    const approval = byId.get(d.approvalEntryId);
    const source = byId.get(d.sourceEntryId);
    if (containsSensitivePolicyText(d.approvalQuote) ||
        containsSensitivePolicyText(d.sourceQuote) ||
        approval?.type !== 'message' || approval.message?.role !== 'user' ||
        !textParts(approval.message.content).includes(d.approvalQuote) ||
        source?.type !== 'message' || !['user', 'assistant'].includes(source.message?.role ?? '') ||
        !textParts(source.message?.content).includes(d.sourceQuote) ||
        d.id !== decisionId(d.mainSessionId, d.approvalEntryId, d.sourceEntryId, d.sourceQuote)) continue;
    result.push(d);
  }
  // A newer, explicitly linked decision replaces an older decision on this branch.
  const replaced = new Set(result.flatMap(d => d.supersedesId ? [d.supersedesId] : []));
  return result.filter(d => !replaced.has(d.id));
}

export function workKnownDecisionIds(entries: readonly BranchEntry[], mainId: string): string[] {
  const known = new Set(branchDecisions(entries, mainId).map(d => d.id));
  for (const e of entries) {
    if (e.type !== 'custom_message' || e.customType !== POLICY_MESSAGE ||
        !e.details || typeof e.details !== 'object') continue;
    const d = e.details as { mainSessionId?: unknown; activeDecisionIds?: unknown };
    if (d.mainSessionId !== mainId || !Array.isArray(d.activeDecisionIds)) continue;
    // Each durable delivery is a checkpoint of which policies were active.
    // The latest receipt supersedes earlier receipts, including withdrawals.
    known.clear();
    for (const id of d.activeDecisionIds) if (typeof id === 'string') known.add(id);
  }
  return [...known];
}

export function policyDelta(active: readonly PolicyDecision[], knownIds: readonly string[],
  workId: string): { added: PolicyDecision[]; withdrawn: string[] } {
  const current = active.filter(d =>
    d.scope === 'owner-main' || d.targetWorkIds.includes(workId));
  const activeIds = new Set(current.map(d => d.id));
  const old = new Set(knownIds);
  return {
    added: current.filter(d => !old.has(d.id)),
    withdrawn: [...old].filter(id => !activeIds.has(id)),
  };
}

export function renderPolicyDelta(
  mainId: string, added: readonly PolicyDecision[], withdrawn: readonly string[],
): string {
  return [
    'Pi Compose · Main에서 사용자 승인 후 공개된 정책 변경',
    '출처: Main ' + mainId + '. 이 내용은 사용자 지시를 새로 만들지 않습니다.',
    ...added.map(d => [
      '결정 ID: ' + d.id,
      '영역: ' + d.subject + ' / 적용: ' + d.effective,
      '확정 내용: ' + d.decision,
      '원문 근거: ' + d.sourceQuote,
      '사용자 승인: ' + d.approvalQuote,
      'WHY: ' + (d.reason || '추가 이유 확인되지 않음'),
    ].join('\n')),
    ...(withdrawn.length ? [
      '현재 Main 활성 분기에서 유효하지 않게 된 이전 결정 ID: ' + withdrawn.join(', '),
      '이전 결정을 임의로 실행하거나 파일을 자동 복원하지 말고 현재 작업에 대한 영향을 재평가하세요.',
    ] : []),
    '현재 위임된 작업 범위에서 영향을 평가하고, 범위 변경이나 충돌이 있으면 Main에 질문하세요.',
    '수신은 적용 완료나 테스트 성공을 의미하지 않습니다.',
  ].join('\n\n');
}
