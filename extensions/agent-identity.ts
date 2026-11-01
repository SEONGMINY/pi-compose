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
    const existing = ctx.sessionManager.getEntries().find(entry => {
      if (entry.type !== 'custom' || entry.customType !== 'compose_agent_identity') return false;
      const data = entry.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
      return (data as Record<string, unknown>).sessionId === ticket.sessionId;
    });
    if (existing && existing.type === 'custom') {
      const saved = existing.data as Record<string, unknown>;
      if (saved.role !== ticket.role || saved.product !== ticket.product ||
          saved.label !== ticket.label) return;
    }
    if (!existing) pi.appendEntry('compose_agent_identity', {
      sessionId: ticket.sessionId,
      launchRequestId: ticket.launchRequestId,
      product: ticket.product,
      label: ticket.label,
      role: ticket.role,
      workspaceCwd: ticket.workspaceCwd,
      gitWorktree: ticket.gitWorktree,
      requesterSessionId: ticket.requesterSessionId,
      requesterSessionFile: ticket.requesterSessionFile,
      forkSourceSessionId: ticket.forkSourceSessionId,
      forkSourceLeafId: ticket.forkSourceLeafId,
      recordedAt: new Date().toISOString(),
    });
    // On explicit resume, identity already exists. Record only the new
    // Surface binding, never invent a new session or change the Main's role.
    const priorBinding = ctx.sessionManager.getEntries().some(entry => {
      if (entry.type !== 'custom' || entry.customType !== 'compose_surface_binding') return false;
      const data = entry.data;
      return Boolean(data && typeof data === 'object' && !Array.isArray(data) &&
        (data as Record<string, unknown>).sessionId === ticket.sessionId &&
        (data as Record<string, unknown>).terminalId === ticket.terminalId);
    });
    if (ticket.terminalId && !priorBinding) {
      pi.appendEntry('compose_surface_binding', {
        sessionId: ticket.sessionId,
        terminalId: ticket.terminalId,
        launchRequestId: ticket.launchRequestId,
        runtimeReceiptFile: ticket.runtimeReceiptFile,
        recordedAt: new Date().toISOString(),
      });
    }
  });
}
