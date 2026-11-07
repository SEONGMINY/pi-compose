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
        if (bare && !ctx.isIdle()) {
          return status('Finish the current Pi turn',
            'Handoff is available after the Work response settles.');
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
export function registerDirectHandoff(
  pi: ExtensionAPI,
  handoff: (ctx: ExtensionContext, options?: HandoffOptions) => Promise<void>,
  connectedRecipientIds: () => Promise<Set<string>>,
): void {
  let inFlight = false;
  const ownerOf = (ctx: ExtensionContext) =>
    readAgentRelationship(ctx.sessionManager.getSessionId(), ctx.sessionManager.getEntries());

  async function open(ctx: ExtensionContext, text: string, shortcut: DirectHandoff, exactRecipientId?: string) {
    if (!ctx.hasUI) return;
    const restore = (reason: string) => {
      ctx.ui.setEditorText(text);
      ctx.ui.notify(reason, 'warning');
    };
    if (inFlight) return restore('A Compose Handoff is already open.');
    if (!ctx.isIdle()) return restore('Finish the current Pi turn before sharing.');
    const owner = ownerOf(ctx);
    if (!owner) return restore('The exact Compose product cannot be verified. Nothing was sent.');

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
    } catch {
      restore('Could not open Handoff. Try again from the Work session.');
    } finally {
      inFlight = false;
    }
  }

  registerHandoffAutocomplete(pi, async (ctx, command, id) => {
    if (ctx.ui.getEditorText() !== command) return;
    ctx.ui.setEditorText('');
    await open(ctx, command, { recipientQuery: id }, id);
  }, connectedRecipientIds);

  const updateHint = (_event: unknown, ctx: ExtensionContext) => {
    if (ownerOf(ctx)?.role === 'work') showHandoffHint(ctx);
  };
  pi.on('session_start', updateHint);
  pi.on('session_tree', updateHint);
  pi.on('agent_settled', updateHint);
  pi.on('agent_start', (_event, ctx) => {
    if (ctx.mode === 'tui' && ownerOf(ctx)?.role === 'work') {
      ctx.ui.setWidget(HANDOFF_HINT, undefined);
    }
  });

  pi.on('input', async (event, ctx) => {
    if (event.source !== 'interactive') return { action: 'continue' };
    const shortcut = parseDirectHandoff(event.text);
    if (!shortcut) return { action: 'continue' };
    if (!ctx.hasUI) return { action: 'handled' };
    if (event.images?.length || event.streamingBehavior) {
      ctx.ui.setEditorText(event.text);
      ctx.ui.notify(event.images?.length
        ? 'Handoff shortcuts do not accept images.'
        : 'Finish the current Pi turn before sharing.', 'warning');
      return { action: 'handled' };
    }
    await open(ctx, event.text, shortcut);
    return { action: 'handled' };
  });
}
