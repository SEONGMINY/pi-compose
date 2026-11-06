import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import {
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
 * Narrowly wraps Pi's native completion for "< @" only; ordinary @file
 * completions, including the existing >w @ selector, keep working.
 */
export function registerHandoffAutocomplete(pi: ExtensionAPI): void {
  let registered = false;
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI || registered) return;
    registered = true;
    ctx.ui.addAutocompleteProvider(previous => ({
      ...previous,
      triggerCharacters: [...new Set([...(previous.triggerCharacters || []), '@'])],
      async getSuggestions(lines, cursorLine, cursorCol, options) {
        const before = (lines[cursorLine] || '').slice(0, cursorCol);
        const match = /^<[ \t]+(@[^\s]*)$/.exec(before);
        if (!match || cursorLine !== 0 || options.signal.aborted) {
          return previous.getSuggestions(lines, cursorLine, cursorCol, options);
        }
        const sessionId = ctx.sessionManager.getSessionId();
        const owner = readAgentRelationship(sessionId, ctx.sessionManager.getEntries());
        if (!owner) return null;
        let candidates;
        try {
          candidates = searchProductHandoffSessions(
            await listProductHandoffSessions(owner.product), match[1].slice(1),
          ).filter(candidate => candidate.id !== sessionId);
        } catch {
          return null; // No cross-product or guessed suggestions on load failure.
        }
        if (options.signal.aborted || candidates.length === 0) return null;
        return {
          prefix: match[1],
          items: candidates.slice(0, 20).map(candidate => ({
            value: candidate.id,
            label: candidate.name + ' [' + candidate.id.slice(0, 12) + ']',
            description: candidate.role + ' · ' + candidate.recentTask.slice(0, 70) +
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
 * Pi interactive input, not a model instruction. Never sends without the
 * existing Handoff's recipient/source/type/editor human selection.
 */
export function registerDirectHandoff(
  pi: ExtensionAPI,
  handoff: (ctx: ExtensionContext, options?: HandoffOptions) => Promise<void>,
): void {
  let inFlight = false;
  pi.on('input', async (event, ctx) => {
    if (event.source !== 'interactive') return { action: 'continue' };
    const shortcut = parseDirectHandoff(event.text);
    if (!shortcut) return { action: 'continue' };

    const restore = (reason: string) => {
      ctx.ui.setEditorText(event.text);
      ctx.ui.notify(reason, 'warning');
      return { action: 'handled' as const };
    };
    if (!ctx.hasUI) return { action: 'handled' };
    if (inFlight) return restore('A Compose Handoff is already open.');
    if (event.images?.length) return restore('Handoff shortcuts do not accept images.');
    if (event.streamingBehavior) return restore('Finish the current Pi turn before sharing.');

    const sessionId = ctx.sessionManager.getSessionId();
    const owner = readAgentRelationship(sessionId, ctx.sessionManager.getEntries());
    if (!owner) return restore('The exact Compose product cannot be verified. Nothing was sent.');

    inFlight = true;
    try {
      await handoff(ctx, {
        sameProductOnly: true,
        ...(shortcut.recipientQuery !== undefined
          ? { recipientQuery: shortcut.recipientQuery }
          : { preferParentMain: true }),
      });
    } catch (error) {
      return restore('Handoff selection failed: ' + String(error) + '. Nothing was automatically sent.');
    } finally {
      inFlight = false;
    }
    return { action: 'handled' };
  });
}
