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

/**
 * "Document it" versus "implement it" chooses the execution mode of an
 * already-approved task. A bare choice is not a new product policy.
 */
export function isExecutionModeOnlyChoice(text:string):boolean {
  const normalized=text.trim().replace(/[.!。]+$/,'').replace(/\s+/g,'');
  return /^(?:문서화|문서작성|문서만|코드구현|코드수정|구현|테스트)(?:로|으로|만|부터|하기로)?(?:진행(?:합니다|하겠습니다|해주세요|해요|할게요)?|해주세요|선택합니다|할게요|하겠습니다)?$/.test(normalized);
}

/**
 * A self-contained user decision outranks an earlier named assistant option.
 * Preserve the complete approved tail, including conditions and exceptions.
 * This conservative fallback recognizes declarative statements only; other
 * formulations require semantic classification and exact-source verification.
 */
export function selfContainedApprovedPolicyQuote(text:string):string|undefined {
  const approval=text.trim();
  const lead=approval.match(/^[A-Z가-힣]\s*안(?:으로|을|이)?\s*(?:확정|결정|채택)(?:합니다|하겠습니다|했습니다|했어요|해요|한다)?[.!。]?\s*/i);
  if(!lead)return;
  const tail=approval.slice(lead[0].length).trim();
  if(tail.length<20||tail.length>1600)return;
  // Do not whitelist domain verbs like "이동"; new domains must also work.
  if(!/(?:합니다|하겠습니다|됩니다|되겠습니다|해야\s*합니다|해야\s*한다|한다|하기로\s*했습니다)(?:[.!。]|\s|$)/.test(tail))return;
  // Coordination instructions do not themselves state the approved policy.
  if(/^(?:이|그|해당|위)\s*(?:정책|내용|결정|안|방안)(?:을|를|은|는)?\s*(?:Work|워크|Main|메인)?[\s\S]*?(?:전달|전파|공유|보고|기록|반영|적용)(?:합니다|하겠습니다)[.!。]?$/.test(tail))return;
  if(/^(?:Work|워크|Main|메인)(?:에|에게|로|에서는?)\s*(?:즉시|먼저|자동으로)?\s*(?:전달|전파|공유|보고|기록)(?:합니다|하겠습니다)[.!。]?$/.test(tail))return;
  if(containsSensitivePolicyText(tail)||containsSensitivePolicyText(approval))return;
  return tail;
}

export function couldBeApproval(text: string): boolean {
  if (!text.trim() || text.length > 12000 || isExecutionModeOnlyChoice(text)) return false;
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
  summary?: unknown;
  targetId?: string; replacement?: unknown;
  details?: unknown };
export function branchDecisions(entries: readonly BranchEntry[], mainSessionId: string): PolicyDecision[] {
  const byId = new Map(entries.map(e => [e.id, e]));
  // ContextEdit can intentionally remove or replace approval/proposal text.
  // Preserve decisions across Compaction, but do not use edited-away evidence
  // as if the original approval still existed in the active model context.
  const latestEdits = new Map<string,unknown>();
  for(const entry of entries){
    if(entry.type==='context_edit'&&typeof entry.targetId==='string')
      latestEdits.set(entry.targetId,entry.replacement);
  }
  const originalQuoteStillVisible=(id:string,quote:string)=>
    !latestEdits.has(id)||textParts(latestEdits.get(id)).includes(quote);
  const result: PolicyDecision[] = [];
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== DECISION_ENTRY) continue;
    const parsed = decisionSchema.safeParse(entry.data);
    if (!parsed.success || parsed.data.mainSessionId !== mainSessionId) continue;
    const d = parsed.data;
    if(!originalQuoteStillVisible(d.approvalEntryId,d.approvalQuote)||
       !originalQuoteStillVisible(d.sourceEntryId,d.sourceQuote))continue;
    const approval = byId.get(d.approvalEntryId);
    const source = byId.get(d.sourceEntryId);
    if (containsSensitivePolicyText(d.approvalQuote) ||
        containsSensitivePolicyText(d.sourceQuote) ||
        approval?.type !== 'message' || approval.message?.role !== 'user' ||
        !textParts(approval.message.content).includes(d.approvalQuote) ||
        source?.type !== 'message' || !['user', 'assistant'].includes(source.message?.role ?? '') ||
        !textParts(source.message?.content).includes(d.sourceQuote) ||
        d.decision !== d.sourceQuote ||
        d.id !== decisionId(d.mainSessionId, d.approvalEntryId, d.sourceEntryId, d.sourceQuote)) continue;
    result.push(d);
  }
  // A newer, explicitly linked decision replaces an older decision on this branch.
  const unique=[...new Map(result.map(d=>[d.id,d])).values()];
  const replaced = new Set(unique.flatMap(d => d.supersedesId ? [d.supersedesId] : []));
  return unique.filter(d => !replaced.has(d.id));
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
      ...(d.effective==='next-task'
        ?['주의: 다음 작업부터 적용되는 결정입니다. 현재 진행 중 작업의 수정 지시가 아닙니다.']
        :d.effective==='stop'
          ?['중단 지시: 새로운 수정 작업을 진행하지 말고 Main에 필요한 확인을 요청하세요.']
          :[]),
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
