/**
 * Source-backed overview of the active Pi branch. No model calls, contract
 * classification, inferred success or rewriting of the original transcript.
 * This is the factual fallback, not the approved semantic LLM Summary.
 */
export type SummaryEvidence = {
  status: 'responding' | 'waiting-for-ui' | 'response-ended' | 'idle-or-unknown';
  headline: string;
  facts: Array<{ sourceEntryId: string; text: string }>;
  sourceSessionId: string;
  sourceLeafId?: string;
  recentResponseEntryId?: string;
};

function takeText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(c => c && typeof c === 'object' && c.type === 'text' &&
    typeof c.text === 'string').map(c => c.text).join('\n');
}
function excerpt(content: unknown, max = 150): string {
  const clean = takeText(content)
    // Tool output can contain hostile ANSI/OSC/control sequences. Summary
    // text is evidence, never terminal escape syntax or trusted Markdown.
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

export function projectSummaryEvidence(
  entries: readonly unknown[],
  sessionId: string,
  leafId: string | undefined,
  state: SummaryEvidence['status'],
  activeTool?: string,
): SummaryEvidence {
  const facts: SummaryEvidence['facts'] = [];
  let lastUser = '';
  let lastAssistant = '';
  let lastAssistantId: string | undefined;
  let lastTool: { id: string; text: string } | undefined;
  for (const item of entries) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (e.type !== 'message' || typeof e.id !== 'string') continue;
    const msg = e.message && typeof e.message === 'object'
      ? e.message as Record<string, unknown> : undefined;
    if (msg?.role === 'user') {
      lastUser = excerpt(msg.content);
      facts.push({ sourceEntryId: e.id, text: '사용자 요청: ' + lastUser });
    } else if (msg?.role === 'assistant') {
      const text = excerpt(msg.content);
      if (text) { lastAssistant = text; lastAssistantId = e.id; }
    } else if (msg?.role === 'toolResult') {
      const text = excerpt(msg.content, 110);
      if (text) lastTool = {
        id: e.id,
        text: (msg.isError === true ? '도구 오류' : '도구 결과') + ': ' + text,
      };
    }
  }
  const selected = lastUser ? facts.slice(-1) : [];
  if (lastTool) selected.push({ sourceEntryId: lastTool.id, text: lastTool.text });
  if (lastAssistant && lastAssistantId) selected.push({
    sourceEntryId: lastAssistantId, text: '최근 Assistant 답변: ' + lastAssistant,
  });
  const headline = state === 'waiting-for-ui'
    ? 'Pi의 사용자 입력 UI가 열려 있습니다'
    : state === 'responding'
      ? activeTool ? '도구 실행: ' + activeTool : 'Pi 응답 생성 중'
      : state === 'response-ended' ? 'Pi 응답 종료 — 실제 작업 완료 여부는 미확인'
      : '현재 활동을 확인할 수 없습니다';
  return {
    status: state, headline, facts: selected.slice(-2),
    sourceSessionId: sessionId, sourceLeafId: leafId,
    recentResponseEntryId: lastAssistantId,
  };
}
