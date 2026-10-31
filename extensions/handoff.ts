import { randomUUID } from 'node:crypto';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

// Pi Compose only coordinates explicit user sharing. Pi owns the transcript and
// pi-intercom owns routing, queuing and delivery.
const REGISTER_EVENT = 'intercom:extension-register';
const OUTBOX_REQUEST_EVENT = 'intercom:outbox-request';
const OUTBOX_RESULT_EVENT = 'intercom:outbox-result';

type Peer = { id: string; name?: string; cwd?: string };
type Channel = { listSessions(): Promise<Peer[]> };
type OutboxResult = {
  requestId?: unknown;
  status?: unknown;
  messageId?: unknown;
  detail?: unknown;
  code?: unknown;
};

function plainText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type: 'text'; text: string } =>
      typeof part === 'object' && part !== null &&
      part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n');
}

type Source = { id: string; role: 'user' | 'assistant'; text: string };

function activeSources(ctx: ExtensionContext): Source[] {
  return ctx.sessionManager.getBranch().flatMap(entry => {
    if (entry.type !== 'message') return [];
    const role = entry.message.role;
    if (role !== 'user' && role !== 'assistant') return [];
    const text = plainText(entry.message.content).trim();
    return text ? [{ id: entry.id, role, text }] : [];
  }).slice(-30).reverse();
}

/**
 * Returns a user-driven Handoff action for the existing Compose command.
 * No model tool, auto-send, new broker, or context mutation is registered.
 */
export function registerHandoff(pi: ExtensionAPI): (ctx: ExtensionContext) => Promise<void> {
  let channel: Channel | undefined;
  let currentSessionId: string | undefined;
  let notify: ExtensionContext['ui']['notify'] | undefined;
  const pending = new Set<string>();

  pi.on('session_start', (_event, ctx) => {
    channel = undefined;
    pending.clear();
    currentSessionId = ctx.sessionManager.getSessionId();
    notify = ctx.ui.notify.bind(ctx.ui);

    // pi-intercom's extension channel lists connected peers in its own routing scope.
    // Registration is optional: without pi-intercom this command fails closed.
    pi.events.emit(REGISTER_EVENT, {
      namespace: 'pi-compose/handoff/v1',
      ownerEligible: false,
      onEvent: (_event: unknown) => {},
      onReady: (ready: Channel) => { channel = ready; },
    });
  });

  pi.events.on(OUTBOX_RESULT_EVENT, (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const result = raw as OutboxResult;
    if (typeof result.requestId !== 'string' || !pending.has(result.requestId)) return;
    pending.delete(result.requestId);

    // Non-context session entry. 'sent' means broker delivery, not model acceptance.
    pi.appendEntry('compose_handoff_delivery', {
      requestId: result.requestId,
      status: result.status,
      messageId: result.messageId,
      code: result.code,
      detail: result.detail,
      senderSessionId: currentSessionId,
      timestamp: new Date().toISOString(),
    });
    if (result.status === 'sent') {
      notify?.('Handoff sent to intercom. Recipient model processing is not confirmed.', 'info');
    } else {
      notify?.('Handoff was not confirmed: ' + String(result.status || 'unknown') + '. ' + String(result.detail || ''), 'warning');
    }
  });

  return async (ctx: ExtensionContext): Promise<void> => {
    if (!ctx.hasUI) {
      ctx.ui.notify('Handoff requires an interactive user selection.', 'warning');
      return;
    }
    if (!channel) {
      ctx.ui.notify('pi-intercom is not available. Nothing was sent.', 'warning');
      return;
    }
    const senderSessionId = ctx.sessionManager.getSessionId();
    const senderSessionFile = ctx.sessionManager.getSessionFile();
    const sourceLeafId = ctx.sessionManager.getLeafId();
    if (!senderSessionFile || !sourceLeafId) {
      ctx.ui.notify('The active Pi session has no persistent source reference. Nothing was sent.', 'warning');
      return;
    }

    let peers: Peer[];
    try {
      peers = (await channel.listSessions()).filter(peer =>
        Boolean(peer.id) && peer.id !== senderSessionId);
    } catch (error) {
      ctx.ui.notify('Cannot list intercom recipients: ' + String(error), 'error');
      return;
    }
    if (!peers.length) {
      ctx.ui.notify('No connected intercom recipients are available.', 'warning');
      return;
    }

    const targetLabels = peers.map((peer, i) =>
      String(i + 1) + '. ' + (peer.name || 'Unnamed') + ' [' + peer.id + '] ' + (peer.cwd || ''));
    const targetLabel = await ctx.ui.select('Share with which connected Pi session?', targetLabels);
    if (!targetLabel) return;
    const target = peers[targetLabels.indexOf(targetLabel)];
    if (!target) return;

    const sources = activeSources(ctx);
    if (!sources.length) {
      ctx.ui.notify('No user or assistant source messages on the active branch.', 'warning');
      return;
    }
    const sourceLabels = sources.map((source, i) =>
      String(i + 1) + '. ' + source.role + ' [' + source.id + '] ' +
      source.text.replace(/\s+/g, ' ').slice(0, 78));
    const sourceLabel = await ctx.ui.select('Select the source entry on this active branch', sourceLabels);
    if (!sourceLabel) return;
    const source = sources[sourceLabels.indexOf(sourceLabel)];
    if (!source) return;

    const types = ['Finding / result (verification not inferred)', 'Proposal (not approved)'];
    const selectedType = await ctx.ui.select('What is being shared?', types);
    if (!selectedType) return;
    const kind = selectedType === types[1] ? 'proposal' : 'reported-finding';

    // Human reviews the exact source excerpt and authors what to share.
    // We never ask a model to strengthen, weaken or invent an approval.
    const authored = await ctx.ui.editor('Review the Handoff report before sharing', source.text.slice(0, 2500));
    if (!authored?.trim()) return;
    if (authored.length > 8000) {
      ctx.ui.notify('Handoff message is too long (maximum 8000 characters). Nothing was sent.', 'warning');
      return;
    }

    // Fail closed if the user switched sessions or the source leaf changed.
    if (ctx.sessionManager.getSessionId() !== senderSessionId ||
        ctx.sessionManager.getLeafId() !== sourceLeafId ||
        !ctx.sessionManager.getBranch().some(entry => entry.id === source.id)) {
      ctx.ui.notify('Source session changed while composing. Nothing was sent.', 'warning');
      return;
    }

    const requestId = randomUUID();
    const message = [
      'Pi Compose Handoff — explicitly selected by a user',
      'Kind: ' + kind,
      'Approval: the act of sharing does not approve the proposal or change recipient policy.',
      'Verification: not independently established by this handoff.',
      '',
      authored.trim(),
      '',
      'Source (read-only reference, not a replacement for the original):',
      'Pi session ID: ' + senderSessionId,
      'Pi session file: ' + senderSessionFile,
      'Active source leaf ID: ' + sourceLeafId,
      'Source entry ID: ' + source.id,
      'Source role: ' + source.role,
      '',
      'Recipient: compare with current decisions; consult the original before changing a contract.',
    ].join('\n');

    pending.add(requestId);
    pi.appendEntry('compose_handoff_request', {
      requestId, senderSessionId, recipientIntercomId: target.id,
      sourceLeafId, sourceEntryId: source.id, kind,
      timestamp: new Date().toISOString(),
    });
    try {
      pi.events.emit(OUTBOX_REQUEST_EVENT, {
        version: 1,
        requestId,
        extensionId: 'pi-compose',
        extensionName: 'Pi Compose',
        to: target.id,
        message,
      });
      ctx.ui.notify('Handoff requested. Check Outbox result; delivery and model processing are separate.', 'info');
    } catch (error) {
      pending.delete(requestId);
      pi.appendEntry('compose_handoff_delivery', {
        requestId, status: 'failed', detail: String(error),
        senderSessionId, timestamp: new Date().toISOString(),
      });
      ctx.ui.notify('Handoff request failed: ' + String(error), 'error');
    }
  };
}
