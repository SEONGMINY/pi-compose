import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { startNativeAgentInOverview } from '../src/native-agent-launch.ts';

export type DirectDelegation = {
  role: 'work' | 'support';
  workspace: 'shared' | 'worktree';
  task: string;
};

export function parseDirectDelegation(text: string): DirectDelegation | undefined {
  // At the very beginning only. Ordinary text, other Pi commands, and
  // mentions of >w in the middle of a message are left to Pi unchanged.
  const match = /^(>w|>s|>>w|>>s)(?:\s+)([\s\S]+)$/.exec(text);
  if (!match) return undefined;
  const shortcut = match[1];
  return {
    role: shortcut.endsWith('w') ? 'work' : 'support',
    workspace: shortcut.startsWith('>>') ? 'worktree' : 'shared',
    task: match[2],
  };
}

/**
 * Direct user input is consumed *before* it enters the caller Pi model.
 * The future pic Overview must pass its exact native terminal UUID through
 * PI_COMPOSE_OVERVIEW_TERMINAL_ID. Without it, fail closed and restore text.
 */
export function registerDirectDelegation(pi: ExtensionAPI): void {
  let inFlight = false;
  pi.on('input', async (event, ctx) => {
    if (event.source !== 'interactive') return { action: 'continue' };
    const direct = parseDirectDelegation(event.text);
    if (!direct) return { action: 'continue' };

    // Any failure/cancel keeps the original task in the Pi editor.
    // Never send a directly delegated prompt to the caller's model.
    const restore = (reason: string) => {
      ctx.ui.setEditorText(event.text);
      ctx.ui.notify(reason, 'warning');
      return { action: 'handled' as const };
    };
    if (!ctx.hasUI) return { action: 'handled' };
    if (inFlight) return restore('A Compose creation request is already running.');
    if (event.images?.length) return restore('Direct delegation with images is not supported yet.');
    if (event.streamingBehavior) return restore('Finish the current Pi turn before starting a new Work/Support Agent.');
    if (!direct.task.trim()) return restore('A task is required.');
    if (direct.workspace === 'worktree') {
      return restore('Worktree direct delegation is not wired to native Ghostty yet. No Agent was started.');
    }
    if (direct.role === 'work' && direct.task.trimStart().startsWith('@')) {
      return restore('Selected @session Fork is not wired to the same-product session selector yet.');
    }
    const overviewTerminalId = process.env.PI_COMPOSE_OVERVIEW_TERMINAL_ID;
    if (!overviewTerminalId) {
      return restore('The real pic Overview is not active. No Agent was started.');
    }

    inFlight = true;
    try {
      const requesterId = ctx.sessionManager.getSessionId();
      const requesterFile = ctx.sessionManager.getSessionFile();
      const identity = readAgentRelationship(requesterId, ctx.sessionManager.getEntries());
      const product = identity?.product ?? await ctx.ui.input('Product for this Agent', 'Project / product name');
      if (!product?.trim()) return restore('A product must be selected to preserve Agent ownership.');

      const sourceLeafId = direct.role === 'work' ? ctx.sessionManager.getLeafId() : undefined;
      if (direct.role === 'work' && (!requesterFile || !sourceLeafId)) {
        return restore('The current Pi session has no persistent completed Fork source.');
      }
      const receipt = await startNativeAgentInOverview({
        role: direct.role,
        product: product.trim(),
        label: direct.task.split('\n')[0].trim().slice(0, 120),
        task: direct.task,
        requesterSessionId: requesterId,
        requesterSessionFile: requesterFile,
        targetCwd: ctx.cwd,
        overviewAnchorTerminalId: overviewTerminalId,
        ...(direct.role === 'work' && requesterFile && sourceLeafId ? {
          source: {
            sessionFile: requesterFile,
            sessionId: requesterId,
            leafId: sourceLeafId,
          },
        } : {}),
      });
      ctx.ui.notify(
        'Ghostty split created for ' + receipt.role + ' [' + receipt.sessionId.slice(0, 8) +
        ']. Pi startup and initial task delivery are not yet verified.',
        'info',
      );
      return { action: 'handled' };
    } catch (error) {
      return restore('Compose launch failed or is unconfirmed: ' + String(error) +
        '. Do not retry without inspecting the existing Ghostty Surfaces.');
    } finally {
      inFlight = false;
    }
  });
}
