import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  AGENT_BOOTSTRAP_ENV,
  decodeAgentBootstrap,
} from '../src/agent-bootstrap.ts';

/**
 * Stamp identity only inside the newly launched Pi session, once that exact
 * session has started. The launch request must have preassigned the new Pi ID.
 *
 * Pi's own SessionManager stores it as a custom entry outside model context.
 * This does not write to any parent/Main session or modify Fork source JSONL.
 */
export function registerAgentIdentity(pi: ExtensionAPI): void {
  const ticket = decodeAgentBootstrap(process.env[AGENT_BOOTSTRAP_ENV]);
  if (!ticket) return;

  pi.on('session_start', (_event, ctx) => {
    if (ctx.sessionManager.getSessionId() !== ticket.sessionId) return;
    if (ctx.cwd !== ticket.workspaceCwd) return;
    const existing = ctx.sessionManager.getEntries().some(entry => {
      if (entry.type !== 'custom' || entry.customType !== 'compose_agent_identity') return false;
      const data = entry.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
      return (data as Record<string, unknown>).sessionId === ticket.sessionId;
    });
    if (existing) return;

    pi.appendEntry('compose_agent_identity', {
      sessionId: ticket.sessionId,
      launchRequestId: ticket.launchRequestId,
      product: ticket.product,
      label: ticket.label,
      role: ticket.role,
      workspaceCwd: ticket.workspaceCwd,
      requesterSessionId: ticket.requesterSessionId,
      requesterSessionFile: ticket.requesterSessionFile,
      forkSourceSessionId: ticket.forkSourceSessionId,
      forkSourceLeafId: ticket.forkSourceLeafId,
      recordedAt: new Date().toISOString(),
    });
  });
}
