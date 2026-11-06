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
        if ((!bare && !match) || cursorLine !== 0 || options.signal.aborted) {
          return previous.getSuggestions(lines, cursorLine, cursorCol, options);
        }
        const sessionId = ctx.sessionManager.getSessionId();
        const owner = readAgentRelationship(sessionId, ctx.sessionManager.getEntries());
        if (!owner || (bare && (owner.role !== 'work' || !ctx.isIdle()))) return null;
        let candidates;
        let parent: string | undefined;
        try {
          const [sessions, connected] = await Promise.all([
            listProductHandoffSessions(owner.product),
            bare ? connectedRecipientIds() : undefined,
          ]);
          parent = bare ? findParentMainSessionId(sessions, sessionId) : undefined;
          candidates = searchProductHandoffSessions(sessions, match?.[1].slice(1) ?? '')
            .filter(candidate => candidate.id !== sessionId && (!connected || connected.has(candidate.id)))
            .sort((a, b) => Number(b.id === parent) - Number(a.id === parent));
        } catch {
          return null; // No cross-product or guessed suggestions on load failure.
        }
        if (options.signal.aborted || candidates.length === 0) return null;
        return {
          prefix: match?.[1] ?? '<',
          items: candidates.slice(0, 20).map(candidate => ({
            value: candidate.id,
            label: candidate.name + ' [' + candidate.id.slice(0, 12) + ']',
            description: (candidate.id === parent ? '상위 Main 추천 · ' : candidate.role + ' · ') +
              (bare ? '검토 · ' : '') + candidate.recentTask.slice(0, 70) +
              ' · ' + candidate.cwd,
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
