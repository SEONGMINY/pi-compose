import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { HANDOFF_HINT } from './handoff-draft.ts';
import {
  CANDIDATE_ENTRY,
  candidateReviewInstruction,
  latestPreparedHandoff,
  prepareWorkHandoffCandidates,
  type PreparedHandoff,
} from './handoff-candidates.ts';
import { readAgentRelationship } from '../src/agent-relationships.ts';

export const REVIEWED_ENTRY = 'compose_handoff_reviewed_draft';

type ReviewTurn = {
  sessionId: string;
  reportEntryId: string;
  previousTools: string[];
  reviewStartLeafId?: string;
};
type SavedReview = {
  version: 1;
  sessionId: string;
  reportEntryId: string;
  reviewEntryId: string;
  text: string;
  sourceEntryIds: string[];
  createdAt: string;
};

function textContent(content: unknown): string {
  return typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(v => v?.type === 'text' && typeof v.text === 'string')
      .map(v => v.text).join('\n').trim() : '';
}

export function latestReviewedDraft(ctx: ExtensionContext, reportEntryId?: string): SavedReview | undefined {
  const branch = ctx.sessionManager.getBranch();
  const ids = new Set(branch.map(entry => entry.id));
  const sessionId = ctx.sessionManager.getSessionId();
  for (const entry of [...branch].reverse()) {
    if (entry.type !== 'custom' || entry.customType !== REVIEWED_ENTRY) continue;
    const data = entry.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    const raw = data as Record<string, unknown>;
    if (raw.version !== 1 || raw.sessionId !== sessionId ||
        typeof raw.reportEntryId !== 'string' ||
        (reportEntryId && raw.reportEntryId !== reportEntryId) ||
        typeof raw.reviewEntryId !== 'string' || !ids.has(raw.reviewEntryId) ||
        typeof raw.text !== 'string' || !raw.text.trim() ||
        !Array.isArray(raw.sourceEntryIds) ||
        !raw.sourceEntryIds.every(id => typeof id === 'string' && ids.has(id))) continue;
    if (!ids.has(raw.reportEntryId)) continue;
    return data as SavedReview;
  }
}

/**
 * Work finishes unattended. This extension prepares and persists candidate
 * DATA; if pi-ask-user is active, only its model-only tool may be used in
 * a separate, prompt-specific review turn. No focus-stealing or sending.
 */
export function registerHandoffReady(
  pi: ExtensionAPI,
  requestReviewedSend?: (ctx: ExtensionContext) => Promise<void>,
) {
  let preparing = false;
  let review: ReviewTurn | undefined;

  const isWork = (ctx: ExtensionContext) =>
    readAgentRelationship(ctx.sessionManager.getSessionId(), ctx.sessionManager.getEntries())?.role === 'work';

  function showReady(ctx: ExtensionContext) {
    if (!ctx.hasUI || ctx.mode !== 'tui' || !isWork(ctx)) return;
    const prepared = latestPreparedHandoff(ctx);
    if (!prepared) return;
    const askUserActive = pi.getActiveTools().includes('ask_user');
    ctx.ui.setWidget(HANDOFF_HINT, [
      'Work · Main 공유 후보 ' + prepared.candidates.length + '개 준비됨 · ' +
      (askUserActive
        ? 'ask_user에서 선택·수정 가능 (자동 전송 없음)'
        : 'ask_user 미활성 · 후보 저장됨 · pi install npm:pi-ask-user 후 /compose review'),
    ]);
  }

  function restoreReviewTools() {
    if (!review) return;
    // Do not overwrite a tool-set change made by the user or another extension.
    if (pi.getActiveTools().length === 1 && pi.getActiveTools()[0] === 'ask_user') {
      pi.setActiveTools(review.previousTools);
    }
    review = undefined;
  }

  function persistReviewAfterAnswer(ctx: ExtensionContext, active: ReviewTurn): boolean {
    if (ctx.sessionManager.getSessionId() !== active.sessionId) return false;
    const branch = ctx.sessionManager.getBranch();
    const prepared = latestPreparedHandoff(ctx);
    if (!prepared || prepared.reportEntryId !== active.reportEntryId) return false;
    const startIndex = active.reviewStartLeafId
      ? branch.findIndex(entry => entry.id === active.reviewStartLeafId) + 1 : 0;
    const newEntries = branch.slice(Math.max(0, startIndex));
    const asked = [...newEntries].reverse().find(entry =>
      entry.type === 'message' && entry.message.role === 'toolResult' &&
      entry.message.toolName === 'ask_user');
    if (!asked || asked.type !== 'message' || asked.message.role !== 'toolResult') return false;
    const details = asked.message.details;
    if (!details || typeof details !== 'object' || Array.isArray(details)) return false;
    const answer = details as Record<string, unknown>;
    if (answer.cancelled === true || !answer.response) return false;
    const response = answer.response as Record<string, unknown>;
    if (response.kind === 'selection' && Array.isArray(response.selections) &&
        response.selections.length === 0 && !response.comment) return false;
    const last = [...branch].reverse().find(entry =>
      entry.type === 'message' &&
      (entry.message.role === 'assistant' || entry.message.role === 'user' || entry.message.role === 'toolResult'));
    if (last?.type !== 'message' || last.message.role !== 'assistant' ||
        last.message.stopReason !== 'stop') return false;
    const text = textContent(last.message.content);
    if (!text || text.length > 14000) return false;
    const sourceEntryIds = [...new Set([prepared.reportEntryId, last.id,
      ...prepared.candidates.map(candidate => candidate.sourceEntryId)])];
    pi.appendEntry(REVIEWED_ENTRY, {
      version: 1, sessionId: active.sessionId, reportEntryId: active.reportEntryId,
      reviewEntryId: last.id, text, sourceEntryIds, createdAt: new Date().toISOString(),
    } satisfies SavedReview);
    return true;
  }

  function beginReview(ctx: ExtensionContext, draft: PreparedHandoff): boolean {
    if (review || !ctx.isIdle()) {
      ctx.ui.notify('Work is still running or a candidate review is already open.', 'warning');
      return false;
    }
    const activeTools = pi.getActiveTools();
    if (!activeTools.includes('ask_user')) {
      ctx.ui.notify(
        'Sharing candidates are saved, but ask_user is not active. Install/enable pi-ask-user, then /compose review.',
        'warning',
      );
      return false;
    }
    // Limit the review model to the installed, existing pi-ask-user tool.
    // Even a mistaken model instruction cannot launch agents or send intercom.
    review = {
      sessionId: ctx.sessionManager.getSessionId(),
      reportEntryId: draft.reportEntryId,
      previousTools: activeTools,
      reviewStartLeafId: ctx.sessionManager.getLeafId() ?? undefined,
    };
    try {
      pi.setActiveTools(['ask_user']);
      pi.sendMessage({
        customType: 'compose_handoff_candidate_review',
        // The user sees the real ask_user question, not a wall of control text.
        display: false,
        content: candidateReviewInstruction(draft),
        details: { reportEntryId: draft.reportEntryId },
      }, { triggerTurn: true });
      return true;
    } catch (error) {
      restoreReviewTools();
      ctx.ui.notify('Candidate review could not be opened: ' + String(error), 'error');
      return false;
    }
  }

  function openSavedReview(ctx: ExtensionContext): void {
    if (!ctx.hasUI || !isWork(ctx)) {
      ctx.ui.notify('Open candidate review from an identified Work session.', 'warning');
      return;
    }
    const prepared = latestPreparedHandoff(ctx);
    if (!prepared) {
      ctx.ui.notify('No prepared Work sharing candidates on the active Pi branch.', 'info');
      return;
    }
    beginReview(ctx, prepared);
  }

  pi.on('session_start', (_event, ctx) => {
    restoreReviewTools();
    showReady(ctx);
  });
  pi.on('session_tree', (_event, ctx) => {
    showReady(ctx);
  });
  pi.on('session_shutdown', () => {
    restoreReviewTools();
  });

  pi.on('agent_settled', async (event, ctx) => {
    if (review) {
      const active = review;
      // This settlement is from the one-off candidate question, not
      // completion of a second coding task.
      const saved = ctx.sessionManager.getSessionId() === active.sessionId &&
        !event.aborted && persistReviewAfterAnswer(ctx, active);
      restoreReviewTools();
      showReady(ctx);
      // The user just answered ask_user. Continue to Pi's native editor and
      // explicit SEND confirmation without requiring another < input.
      // No focus command is issued; the UI remains in this Work terminal.
      if (saved && requestReviewedSend && ctx.hasUI && ctx.mode === 'tui' && ctx.isIdle()) {
        // Do not hold Pi's settlement event open for a human answer.
        // Open the normal editor/confirmation AFTER the event callback returns.
        queueMicrotask(() => {
          if (ctx.sessionManager.getSessionId() !== active.sessionId || !ctx.isIdle()) return;
          void requestReviewedSend(ctx).catch(error => {
            ctx.ui.notify('Could not open reviewed Handoff: ' + String(error), 'warning');
          });
        });
      }
      return;
    }
    if (event.aborted || !isWork(ctx) || preparing) return;
    preparing = true;
    try {
      const result = await prepareWorkHandoffCandidates(ctx);
      if (result.status !== 'prepared') {
        if (result.status === 'complete-no-candidates') {
          ctx.ui.notify('Work reported complete; no Main sharing candidates were identified.', 'info');
        }
        if (result.status === 'failed') {
          ctx.ui.notify('Work sharing candidate generation failed; no completion or sending was assumed.', 'warning');
        }
        return;
      }
      // Check session/branch again after the separate provider request.
      if (ctx.sessionManager.getSessionId() !== result.draft.sessionId ||
          ctx.sessionManager.getLeafId() !== result.draft.sourceLeafId) return;
      pi.appendEntry(CANDIDATE_ENTRY, result.draft);
      showReady(ctx);
      ctx.ui.notify(
        'Work reported complete. Main sharing candidates are saved for later review; nothing was sent.',
        'info',
      );
      // Opening the ask_user question stays inside the Work terminal.
      // If unavailable, saved candidates survive and /compose review can retry.
      if (ctx.hasUI && ctx.mode === 'tui' && ctx.isIdle()) {
        beginReview(ctx, result.draft);
      }
    } finally {
      preparing = false;
    }
  });

  return { openSavedReview };
}
