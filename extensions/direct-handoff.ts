import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { HANDOFF_HINT, showHandoffHint } from './handoff-draft.ts';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import {
  findParentMainSessionId,
  listProductHandoffSessions,
  searchProductHandoffSessions,
} from '../src/product-sessions.ts';
import type { HandoffOptions } from './handoff.ts';

export type DirectHandoff = { recipientQuery?: string };
const STATUS_ITEM_VALUE = 'pi-compose:handoff-status-only';

/**
 * "<" opens Handoff, "< @session" searches a same-product recipient.
 * The unused "<<" has NO semantics. Other Pi messages are left alone.
 */
export function parseDirectHandoff(text: string): DirectHandoff | undefined {
  if (/^<[ \t]*$/.test(text)) return {};
  const selected = /^<[ \t]+@(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s]*))[ \t]*$/.exec(text);
  if (!selected) return;
  return { recipientQuery: selected[1] ?? selected[2] ?? selected[3] ?? '' };
}

/**
 * Add Work recipient suggestions for a bare "<" and retain "< @" search.
 */
function registerHandoffAutocomplete(
  pi: ExtensionAPI,
  openRecipient: (ctx: ExtensionContext, command: string, id: string) => Promise<void>,
  connectedRecipientIds: () => Promise<Set<string>>,
): void {
  let registered = false;
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI || registered) return;
    registered = true;
    ctx.ui.addAutocompleteProvider(previous => ({
      ...previous,
      triggerCharacters: [...new Set([...(previous.triggerCharacters || []), '<', '@'])],
      async getSuggestions(lines, cursorLine, cursorCol, options) {
        const before = (lines[cursorLine] || '').slice(0, cursorCol);
        const bare = before === '<' && lines.length === 1 && lines[0] === '<';
        const match = /^<[ \t]+(@[^\s]*)$/.exec(before);
        if ((!bare && !match) || cursorLine !== 0) {
          return previous.getSuggestions(lines, cursorLine, cursorCol, options);
        }
        if (options.signal.aborted) return null;
        // A status row is never an intercom destination. Do not conceal missing
        // identity, session discovery errors, or connectivity as a blank menu.
        const status = (label: string, description: string) => ({
          prefix: match?.[1] ?? '<',
          items: [{ value: STATUS_ITEM_VALUE, label, description }],
        });
        const sessionId = ctx.sessionManager.getSessionId();
        const owner = readAgentRelationship(sessionId, ctx.sessionManager.getEntries());
        if (!owner) {
          return status('Compose identity unavailable',
            'This Pi session has no verified Compose product. Nothing was sent.');
        }
        if (bare && owner.role !== 'work') {
          return status('Open Handoff from a Work session',
            'Bare < is for Work. Use /compose handoff for manual sharing.');
        }
        // Discover only persisted, precisely identified same-product sessions.
        // Connection state is independent: even an offline Main is shown as
        // offline, and the final handoff still blocks an unmatched intercom ID.
        let sessions: Awaited<ReturnType<typeof listProductHandoffSessions>>;
        try {
          sessions = await listProductHandoffSessions(owner.product);
        } catch {
          return status('Cannot inspect Compose sessions',
            'Pi session discovery failed. No destination was inferred or contacted.');
        }
        let connected: Set<string> | undefined;
        let connectionProblem = false;
        if (bare) {
          try { connected = await connectedRecipientIds(); }
          catch { connectionProblem = true; }
        }
        if (options.signal.aborted) return null;
        const parent = bare ? findParentMainSessionId(sessions, sessionId) : undefined;
        const candidates = searchProductHandoffSessions(sessions, match?.[1].slice(1) ?? '')
          .filter(candidate => candidate.id !== sessionId)
          .sort((a, b) =>
            Number(connected?.has(b.id) === true) - Number(connected?.has(a.id) === true) ||
            Number(b.id === parent) - Number(a.id === parent));
        if (!candidates.length) {
          return status(match ? 'No matching Compose recipient' : 'No other Compose session in this product',
            'Only saved sessions with exact Compose identity are shown. Nothing was sent.');
        }
        return {
          prefix: match?.[1] ?? '<',
          items: candidates.slice(0, 20).map(candidate => ({
            value: candidate.id,
            label: candidate.name + ' [' + candidate.id.slice(0, 12) + ']' +
              (bare && !connected?.has(candidate.id) ? ' · unavailable' : ''),
            description: (candidate.id === parent ? '상위 Main 추천 · ' : candidate.role + ' · ') +
              (bare
                ? connected?.has(candidate.id) ? 'intercom connected'
                  : connectionProblem ? 'intercom unavailable' : 'no exact intercom ID match (offline or custom ID)'
                : 'connection checked before sending') +
              ' · ' + candidate.recentTask.slice(0, 70) + ' · ' + candidate.cwd,
          })),
        };
      },
      shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
        if (cursorLine === 0 && /^<[ \t]+@[^\s]*$/.test((lines[0] || '').slice(0, cursorCol))) {
          return false;
        }
        return previous.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
      },
      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        if (item.value === STATUS_ITEM_VALUE) {
          // Selecting an informational row never creates a recipient or message.
          queueMicrotask(() => ctx.ui.notify(item.description || item.label, 'warning'));
          return { lines: [...lines], cursorLine, cursorCol };
        }
        if (prefix === '<' && cursorLine === 0 && cursorCol === 1 && lines.length === 1 && lines[0] === '<') {
          const command = '< @' + item.value;
          // Native Pi applies completion before it can open another editor UI.
          queueMicrotask(() => { void openRecipient(ctx, command, item.value); });
          return { lines: [command], cursorLine, cursorCol: command.length };
        }
        if (cursorLine !== 0 || !prefix.startsWith('@') ||
            !/^<[ \t]+@/.test(lines[0] || '')) {
          return previous.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
        }
        const before = lines[cursorLine].slice(0, cursorCol - prefix.length);
        const after = lines[cursorLine].slice(cursorCol);
        const next = [...lines];
        next[cursorLine] = before + '@' + item.value + after;
        return { lines: next, cursorLine, cursorCol: before.length + item.value.length + 1 };
      },
    }));
  });
}

/**
 * A shortcut or recipient selection opens review, then shares only if confirmed.
 */
type QueuedHandoff = {
  sessionId: string;
  requestedLeafId: string | undefined;
  shortcut: DirectHandoff;
  exactRecipientId?: string;
  state: 'waiting' | 'ready';
  readyLeafId?: string;
};

/**
 * A user may REQUEST a Work Handoff during streaming, but no model generation,
 * UI review, or intercom delivery happens until the Work run has settled.
 * The request is extension-local (not a steering/follow-up model message).
 */
export function registerDirectHandoff(
  pi: ExtensionAPI,
  handoff: (ctx: ExtensionContext, options?: HandoffOptions) => Promise<void>,
  connectedRecipientIds: () => Promise<Set<string>>,
): void {
  let inFlight = false;
  let queued: QueuedHandoff | undefined;
  const ownerOf = (ctx: ExtensionContext) =>
    readAgentRelationship(ctx.sessionManager.getSessionId(), ctx.sessionManager.getEntries());

  const updateHint = (_event: unknown, ctx: ExtensionContext) => {
    if (ctx.mode !== 'tui' || ownerOf(ctx)?.role !== 'work') return;
    if (queued?.sessionId === ctx.sessionManager.getSessionId()) {
      ctx.ui.setWidget(HANDOFF_HINT, [
        queued.state === 'waiting'
          ? 'Handoff · 요청 접수됨 · Work 실행 종료 후 검토 가능 (자동 전송 없음)'
          : 'Handoff · 검토 가능 · < 로 열기 (자동 초안 생성·전송 없음)',
      ]);
    } else {
      showHandoffHint(ctx);
    }
  };

  function remember(ctx: ExtensionContext, shortcut: DirectHandoff, exactRecipientId?: string) {
    const owner = ownerOf(ctx);
    if (!owner || owner.role !== 'work') {
      ctx.ui.notify('Only a verified Work session can queue a Handoff while running.', 'warning');
      return;
    }
    const sessionId = ctx.sessionManager.getSessionId();
    if (queued?.sessionId === sessionId) {
      ctx.ui.notify('A Work Handoff is already queued. Nothing was sent.', 'info');
      return;
    }
    queued = {
      sessionId, requestedLeafId: ctx.sessionManager.getLeafId() ?? undefined,
      shortcut, exactRecipientId, state: 'waiting',
    };
    ctx.ui.notify(
      'Handoff request queued. Work continues; after it settles, use < to review. Nothing was sent.',
      'info',
    );
    updateHint(undefined, ctx);
  }

  async function open(ctx: ExtensionContext, text: string, shortcut: DirectHandoff, exactRecipientId?: string) {
    if (!ctx.hasUI) return;
    const restore = (reason: string) => {
      ctx.ui.setEditorText(text);
      ctx.ui.notify(reason, 'warning');
    };
    if (inFlight) return restore('A Compose Handoff is already open.');
    if (!ctx.isIdle()) {
      remember(ctx, shortcut, exactRecipientId);
      return;
    }
    const owner = ownerOf(ctx);
    if (!owner) return restore('The exact Compose product cannot be verified. Nothing was sent.');

    const q = queued;
    if (q?.sessionId === ctx.sessionManager.getSessionId()) {
      if (q.state !== 'ready') {
        return restore('Work has not settled yet. Handoff remains queued.');
      }
      if (q.readyLeafId !== ctx.sessionManager.getLeafId()) {
        queued = undefined;
        return restore('The Work session branch changed after Handoff was queued. Request again.');
      }
      // An explicit recipient in this invocation overrides the prior choice;
      // a bare < keeps the requester's original recipient selection.
      if (shortcut.recipientQuery === undefined && exactRecipientId === undefined) {
        shortcut = q.shortcut;
        exactRecipientId = q.exactRecipientId;
      }
      queued = undefined;
    }

    inFlight = true;
    try {
      await handoff(ctx, {
        sameProductOnly: true,
        draft: owner.role === 'work',
        exactRecipientId,
        ...(shortcut.recipientQuery !== undefined
          ? { recipientQuery: shortcut.recipientQuery }
          : { preferParentMain: true }),
      });
    } catch (error) {
      restore('Could not open Handoff: ' + String(error));
    } finally {
      inFlight = false;
      updateHint(undefined, ctx);
    }
  }

  registerHandoffAutocomplete(pi, async (ctx, command, id) => {
    if (ctx.ui.getEditorText() !== command) return;
    ctx.ui.setEditorText('');
    await open(ctx, command, { recipientQuery: id }, id);
  }, connectedRecipientIds);

  pi.on('session_start', (_event, ctx) => {
    // Never transplant an in-memory request into a different resumed session.
    if (queued && queued.sessionId !== ctx.sessionManager.getSessionId()) queued = undefined;
    updateHint(undefined, ctx);
  });
  pi.on('session_tree', updateHint);
  pi.on('agent_start', (_event, ctx) => {
    if (queued?.sessionId === ctx.sessionManager.getSessionId() && queued.state === 'ready') {
      queued = undefined;
      ctx.ui.notify('Unreviewed Handoff request expired when another Work run started.', 'warning');
    }
    if (ctx.mode === 'tui' && ownerOf(ctx)?.role === 'work') {
      if (queued) updateHint(undefined, ctx);
      else ctx.ui.setWidget(HANDOFF_HINT, undefined);
    }
  });
  pi.on('agent_settled', (event, ctx) => {
    const q = queued;
    if (!q || q.state !== 'waiting') {
      updateHint(undefined, ctx);
      return;
    }
    if (q.sessionId !== ctx.sessionManager.getSessionId()) {
      queued = undefined;
      updateHint(undefined, ctx);
      return;
    }
    const last = [...ctx.sessionManager.getBranch()].reverse().find(entry =>
      entry.type === 'message' &&
      (entry.message.role === 'assistant' || entry.message.role === 'user' || entry.message.role === 'toolResult'));
    const complete = !event.aborted && last?.type === 'message' &&
      last.message.role === 'assistant' && last.message.stopReason === 'stop';
    if (!complete) {
      queued = undefined;
      ctx.ui.notify('Work settled without a completed report; queued Handoff was not prepared.', 'warning');
      updateHint(undefined, ctx);
      return;
    }
    queued = { ...q, state: 'ready', readyLeafId: ctx.sessionManager.getLeafId() ?? undefined };
    ctx.ui.notify('Work settled. Handoff is ready for review: enter <. No draft generated or sent.', 'info');
    updateHint(undefined, ctx);
  });

  pi.on('input', async (event, ctx) => {
    if (event.source !== 'interactive') return { action: 'continue' };
    const shortcut = parseDirectHandoff(event.text);
    if (!shortcut) return { action: 'continue' };
    if (!ctx.hasUI) return { action: 'handled' };
    if (event.images?.length) {
      ctx.ui.setEditorText(event.text);
      ctx.ui.notify('Handoff shortcuts do not accept images.', 'warning');
      return { action: 'handled' };
    }
    // Return handled even during streaming; never inject < into the Work
    // model as a steer/followUp instruction.
    await open(ctx, event.text, shortcut);
    return { action: 'handled' };
  });
}
