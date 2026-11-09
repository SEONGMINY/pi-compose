import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { getFocusedGhosttyTerminalId } from '../src/ghostty-native.ts';
import { startNativeAgentFromTerminal } from '../src/native-agent-launch.ts';
import {
  listProductForkSessions,
  searchProductForkSessions,
  type ForkSessionCandidate,
} from '../src/product-sessions.ts';

export type DirectDelegation = {
  role: 'work' | 'support';
  workspace: 'shared' | 'worktree';
  task: string;
  sessionQuery?: string;
};

export function parseDirectDelegation(text: string): DirectDelegation | undefined {
  // Direct commands are recognized only at the very start of interactive
  // input. Ordinary Pi file @ mentions and other text are not intercepted.
  const match = /^(>w|>s|>>w|>>s)\s+([\s\S]+)$/.exec(text);
  if (!match) return undefined;
  const shortcut = match[1];
  let task = match[2];
  let sessionQuery: string | undefined;
  if (shortcut.endsWith('w') && task.startsWith('@')) {
    // Allow a search token or an explicit Pi Session ID, optionally quoted.
    // The selected ID, never this token, determines which JSONL is forked.
    const selected = /^@(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s]*))\s+([\s\S]+)$/.exec(task);
    if (!selected) return undefined; // Missing task: preserve original input.
    sessionQuery = selected[1] ?? selected[2] ?? selected[3] ?? '';
    task = selected[4];
  }
  return {
    role: shortcut.endsWith('w') ? 'work' : 'support',
    workspace: shortcut.startsWith('>>') ? 'worktree' : 'shared',
    task,
    ...(sessionQuery !== undefined ? { sessionQuery } : {}),
  };
}

async function chooseForkSource(
  ctx: ExtensionContext,
  product: string,
  query: string,
): Promise<ForkSessionCandidate | undefined> {
  const all = await listProductForkSessions(product);
  const candidates = searchProductForkSessions(all, query);
  if (candidates.length === 0) {
    ctx.ui.notify('No completed Pi session matching this product/session query.', 'warning');
    return;
  }
  const labels = candidates.map((candidate, i) =>
    String(i + 1) + '. ' + candidate.name + ' [' + candidate.id.slice(0, 12) + '] ' +
    candidate.role + ' · ' + candidate.recentTask.slice(0, 55) +
    ' · ' + candidate.cwd,
  );
  const selected = await ctx.ui.select('Choose the exact Pi Fork source (same product)', labels);
  if (!selected) return;
  return candidates[labels.indexOf(selected)];
}

/** A narrow native autocomplete adapter; outside >w @ / >>w @ the existing
 * Pi provider (including its standard @file behavior) runs unchanged.
 */
export function registerDelegationAutocomplete(pi: ExtensionAPI): void {
  let registered = false;
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI || registered) return;
    registered = true;
    ctx.ui.addAutocompleteProvider(previous => ({
      ...previous,
      triggerCharacters: [...new Set([...(previous.triggerCharacters || []), '@'])],
      async getSuggestions(lines, cursorLine, cursorCol, options) {
        const before = (lines[cursorLine] || '').slice(0, cursorCol);
        const match = /^(?:>w|>>w)\s+(@[^\s]*)$/.exec(before);
        if (!match || cursorLine !== 0 || options.signal.aborted) {
          return previous.getSuggestions(lines, cursorLine, cursorCol, options);
        }
        const owner = readAgentRelationship(
          ctx.sessionManager.getSessionId(), ctx.sessionManager.getEntries());
        if (!owner) return null; // Never leak sessions from other products.
        const candidates = searchProductForkSessions(
          await listProductForkSessions(owner.product), match[1].slice(1));
        if (options.signal.aborted || candidates.length === 0) return null;
        return {
          prefix: match[1],
          items: candidates.slice(0, 20).map(session => ({
            value: session.id,
            label: session.name + ' [' + session.id.slice(0, 12) + ']',
            description: session.role + ' · ' + session.recentTask.slice(0, 70) +
              ' · ' + session.cwd,
          })),
        };
      },
      shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
        return previous.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
      },
      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        if (!prefix.startsWith('@') || !/^(>w|>>w)\s+@/.test(lines[0] || '')) {
          return previous.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
        }
        const before = lines[cursorLine].slice(0, cursorCol - prefix.length);
        const after = lines[cursorLine].slice(cursorCol);
        const next = [...lines];
        next[cursorLine] = before + '@' + item.value + ' ' + after;
        return { lines: next, cursorLine, cursorCol: before.length + item.value.length + 2 };
      },
    }));
  });
}

/**
 * Direct user input is handled before the caller's Pi model receives it.
 * Uses the user's current Ghostty Pi terminal as the split anchor;
 * no Overview or Sidebar is required.
 */
export function registerDirectDelegation(pi: ExtensionAPI): void {
  let inFlight = false;
  pi.on('input', async (event, ctx) => {
    if (event.source !== 'interactive') return { action: 'continue' };
    const direct = parseDirectDelegation(event.text);
    const shortcutAttempt = /^>{1,2}[ws](?:$|\s)/.test(event.text);
    if (!direct && !shortcutAttempt) return { action: 'continue' };

    const restore = (reason: string) => {
      ctx.ui.setEditorText(event.text);
      ctx.ui.notify(reason, 'warning');
      return { action: 'handled' as const };
    };
    if (!ctx.hasUI) return { action: 'handled' };
    if (!direct || !direct.task.trim()) {
      return restore('Enter a task after the delegation command (and optional @session).');
    }
    if (inFlight) return restore('A Compose creation request is already running.');
    if (event.images?.length) return restore('Direct delegation with images is not supported.');
    if (event.streamingBehavior) {
      return restore('Finish the current Pi turn before directly delegating.');
    }
    inFlight = true;
    try {
      const requesterSessionId = ctx.sessionManager.getSessionId();
      const requesterSessionFile = ctx.sessionManager.getSessionFile();
      const requesterLeafId = ctx.sessionManager.getLeafId();
      const owner = readAgentRelationship(requesterSessionId, ctx.sessionManager.getEntries());
      const product = owner?.product ??
        await ctx.ui.input('Product for this Agent', 'Product / project name');
      if (!product?.trim()) return restore('Product selection is required.');

      let source: { sessionFile: string; sessionId: string; leafId: string } | undefined;
      if (direct.role === 'work') {
        if (direct.sessionQuery !== undefined) {
          const selected = await chooseForkSource(ctx, product.trim(), direct.sessionQuery);
          if (!selected) return restore('No Pi source selected; nothing was created.');
          source = {
            sessionFile: selected.file, sessionId: selected.id, leafId: selected.leafId,
          };
        } else {
          if (!requesterSessionFile || !requesterLeafId) {
            return restore('The calling Pi session has no persisted completed Fork source.');
          }
          source = {
            sessionFile: requesterSessionFile, sessionId: requesterSessionId, leafId: requesterLeafId,
          };
        }
      }
      // If the user navigated to another Pi branch/session during a selector,
      // the requester's identity is stale. Fail closed before touching Git.
      if (ctx.sessionManager.getSessionId() !== requesterSessionId ||
          ctx.sessionManager.getSessionFile() !== requesterSessionFile ||
          ctx.sessionManager.getLeafId() !== requesterLeafId) {
        return restore('Calling Pi session/branch changed during selection; nothing was started.');
      }
      const anchorTerminalId = await getFocusedGhosttyTerminalId();
      const receipt = await startNativeAgentFromTerminal({
        role: direct.role,
        workspace: direct.workspace,
        product: product.trim(),
        label: direct.task.trimStart().split('\n')[0].trim().slice(0, 120),
        task: direct.task,
        requesterSessionId,
        requesterSessionFile,
        targetCwd: ctx.cwd, // File workspace is ALWAYS the caller's.
        anchorTerminalId,
        ...(source ? { source } : {}),
      });
      const workspaceNote = receipt.worktree
        ? '\nNew Git Worktree: ' + receipt.worktree.worktreePath +
          '\nBase HEAD: ' + receipt.worktree.baseCommit.slice(0, 12) +
          (receipt.worktree.hadUncommittedChanges
            ? '\nNote: uncommitted changes were NOT copied.' : '')
        : '';
      ctx.ui.notify(
        'Ghostty ' + receipt.role + ' Split created [' + receipt.sessionId.slice(0, 8) +
        ']. Pi startup/initial task delivery are not confirmed.' + workspaceNote,
        'info',
      );
      return { action: 'handled' };
    } catch (error) {
      return restore('Delegation failed or outcome is uncertain: ' + String(error) +
        '. Inspect Ghostty/Git Worktrees before retrying; no automatic cleanup.');
    } finally {
      inFlight = false;
    }
  });
}
