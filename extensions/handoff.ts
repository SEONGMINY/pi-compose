import { randomUUID } from 'node:crypto';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { generateHandoffDraft } from './handoff-draft.ts';
import { latestPreparedHandoff } from './handoff-candidates.ts';
import { latestReviewedDraft } from './handoff-ready.ts';
import { projectHandoffHistory } from '../src/handoff-history.ts';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import {
  listProductHandoffSessions,
  searchProductHandoffSessions,
  findParentMainSessionId,
  type HandoffSessionCandidate,
} from '../src/product-sessions.ts';

// Pi Compose only coordinates explicit user sharing. Pi owns the transcript and
// pi-intercom owns routing, queuing and delivery.
const REGISTER_EVENT = 'intercom:extension-register';
const OUTBOX_REQUEST_EVENT = 'intercom:outbox-request';
const OUTBOX_RESULT_EVENT = 'intercom:outbox-result';

type Peer = { id: string; name?: string; cwd?: string };
type Channel = { listSessions(): Promise<Peer[]> };

/** Shortcut-only routing. Legacy /compose handoff retains its existing picker. */
export type HandoffOptions = {
  sameProductOnly?: boolean;
  recipientQuery?: string;
  preferParentMain?: boolean;
  exactRecipientId?: string;
  draft?: boolean;
};
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
export function registerHandoff(pi: ExtensionAPI) {
  let channel: Channel | undefined;
  let currentSessionId: string | undefined;
  let notify: ExtensionContext['ui']['notify'] | undefined;
  const pending = new Map<string, { sessionId: string; sessionFile: string }>();

  pi.on('session_start', (_event, ctx) => {
    currentSessionId = ctx.sessionManager.getSessionId();
    notify = ctx.ui.notify.bind(ctx.ui);

    // pi-intercom retains channel registrations across Pi session switches.
    // Register once per Extension lifecycle; duplicate namespaces are rejected.
    if (channel) return;
    // Without pi-intercom this event has no listener and the command fails closed.
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
    if (typeof result.requestId !== 'string') return;
    const origin = pending.get(result.requestId);
    if (!origin) return;
    pending.delete(result.requestId);
    // Session switches must never append the old sender's outcome to the new session.
    // The original request remains 'outcome-unknown' until evidence can be reconciled.
    if (origin.sessionId !== currentSessionId) return;

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

  async function showHandoff(ctx: ExtensionContext, options: HandoffOptions = {}): Promise<void> {
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

    let candidates: HandoffSessionCandidate[] = [];
    let suggestedParentId: string | undefined;
    if (options.sameProductOnly) {
      const owner = readAgentRelationship(senderSessionId, ctx.sessionManager.getEntries());
      if (!owner) {
        ctx.ui.notify('Cannot verify the current Compose product. Nothing was sent.', 'warning');
        return;
      }
      try {
        candidates = await listProductHandoffSessions(owner.product);
      } catch (error) {
        ctx.ui.notify('Cannot verify same-product Pi recipients: ' + String(error), 'warning');
        return;
      }
      const exactId = options.exactRecipientId ??
        candidates.find(candidate => candidate.id === options.recipientQuery)?.id;
      const allowed = exactId
        ? candidates.filter(candidate => candidate.id === exactId)
        : searchProductHandoffSessions(candidates, options.recipientQuery ?? '');
      const ids = new Set(allowed.map(candidate => candidate.id));
      // pi-intercom normally uses the Pi session ID. A custom stable intercom
      // address may differ: never route by a guessed name/cwd in that case.
      peers = peers.filter(peer => ids.has(peer.id));
      if (options.preferParentMain && options.recipientQuery === undefined) {
        suggestedParentId = findParentMainSessionId(candidates, senderSessionId);
        peers.sort((a, b) =>
          Number(b.id === suggestedParentId) - Number(a.id === suggestedParentId));
      }
    }
    if (!peers.length) {
      ctx.ui.notify(options.sameProductOnly
        ? 'No matching connected Compose session in this product. If intercom uses a custom ID, the exact Pi identity cannot be verified; nothing was sent.'
        : 'No connected intercom recipients are available.', 'warning');
      return;
    }

    const recipientById = new Map(candidates.map(candidate => [candidate.id, candidate]));
    let target: Peer | undefined = options.exactRecipientId
      ? peers.find(peer => peer.id === options.exactRecipientId)
      : options.draft && options.recipientQuery && peers.length === 1 ? peers[0] : undefined;
    if (!target) {
      const targetLabels = peers.map((peer, i) => {
        const identity = recipientById.get(peer.id);
        const mainHint = peer.id === suggestedParentId ? ' · parent Main suggested' : '';
        return String(i + 1) + '. ' + (identity?.name || peer.name || 'Unnamed') +
          ' [' + peer.id + '] ' +
          (identity ? identity.role + ' · ' + identity.recentTask.slice(0, 55) : '') +
          mainHint + ' · ' + (identity?.cwd || peer.cwd || '');
      });
      const selected = await ctx.ui.select(
        options.sameProductOnly
          ? 'Confirm the exact connected recipient (same product)'
          : 'Share with which connected Pi session?',
        targetLabels,
      );
      if (!selected) return;
      target = peers[targetLabels.indexOf(selected)];
      if (!target) return;
    }

    const sameSource = () => currentSessionId === senderSessionId &&
      ctx.sessionManager.getSessionId() === senderSessionId &&
      ctx.sessionManager.getLeafId() === sourceLeafId;
    if (!sameSource()) {
      ctx.ui.notify('Source session changed. Open Handoff again.', 'warning');
      return;
    }

    let kind: 'proposal' | 'reported-finding' | 'work-evidence';
    let message: string;
    let sourceEntryId: string;
    let sourceEntryIds: string[];
    if (options.draft && ctx.mode === 'tui') {
      const prepared = latestPreparedHandoff(ctx);
      const reviewed = prepared && latestReviewedDraft(ctx, prepared.reportEntryId);
      let draftText: string;
      if (prepared) {
        // Reuse the SAVED candidate work, not a second truncated model summary.
        // The user may revise the entire text, regardless of how ask_user was answered.
        const sourceLabel = reviewed
          ? 'Reviewed with ask_user; generated wording remains an unverified Work draft.'
          : 'Prepared for review; no ask_user selection has been recorded.';
        draftText = reviewed?.text ?? [
          'Pi Compose — proposed Work sharing candidates',
          sourceLabel,
          ...prepared.candidates.map((candidate, i) => [
            String(i + 1) + '. ' + candidate.title + ' (' + candidate.kind + ')',
            candidate.description,
            'Evidence [' + candidate.sourceEntryId + ']: ' + candidate.quote,
          ].join('\n')),
        ].join('\n\n');
        sourceEntryId = prepared.reportEntryId;
        sourceEntryIds = [...new Set([prepared.reportEntryId,
          ...prepared.candidates.map(candidate => candidate.sourceEntryId),
          ...(reviewed?.sourceEntryIds ?? [])])];
      } else {
        // Manual < remains usable before any completion candidate is prepared.
        const draft = await generateHandoffDraft(ctx, senderSessionId, sourceLeafId);
        if (!sameSource()) {
          ctx.ui.notify('Source session changed. Open Handoff again.', 'warning');
          return;
        }
        if (!draft) {
          ctx.ui.notify('No source-backed draft is available. Use /compose handoff to share manually.', 'warning');
          return;
        }
        draftText = draft.message;
        sourceEntryId = draft.report.id;
        sourceEntryIds = draft.sources.map(source => source.id);
      }
      const edited = await ctx.ui.editor(
        'Edit Handoff to ' + (target.name || target.id),
        draftText,
      );
      if (!edited?.trim()) return;
      if (edited.length > 14000) {
        ctx.ui.notify('Handoff body exceeds 14000 characters. Nothing was sent.', 'warning');
        return;
      }
      const approved = await ctx.ui.confirm(
        'Send this user-reviewed Handoff?',
        'Recipient: ' + (target.name || target.id) + ' [' + target.id + ']\n' +
        'Sending does not approve a policy, verify implementation, or authorize new tasks.',
      );
      if (approved !== true) return;
      kind = 'work-evidence';
      message = [
        'Pi Compose Handoff — user-reviewed Work report for recipient inspection',
        'Do not treat this report as approval, instructions to start another task, or verified test success.',
        edited.trim(),
        'Sender Pi session: ' + senderSessionId,
        'Original completed Work report: ' + sourceEntryId,
        'Evidence entry IDs: ' + sourceEntryIds.join(', '),
        'Recipient should verify any claims against source and current Main decisions.',
      ].join('\n\n');
    } else {
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
      kind = selectedType === types[1] ? 'proposal' : 'reported-finding';
      const authored = await ctx.ui.editor('Review the Handoff report before sharing', source.text.slice(0, 2500));
      if (!authored?.trim()) return;
      if (authored.length > 8000) {
        ctx.ui.notify('Handoff message is too long (maximum 8000 characters). Nothing was sent.', 'warning');
        return;
      }
      sourceEntryId = source.id;
      sourceEntryIds = [source.id];
      message = [
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
    }

    // A review is valid only for the session, leaf, and sources it displayed.
    if (!sameSource() || (options.draft && !ctx.isIdle())) {
      ctx.ui.notify('Source session changed or is busy. Nothing was sent.', 'warning');
      return;
    }
    const activeIds = new Set(ctx.sessionManager.getBranch().map(entry => entry.id));
    if (sourceEntryIds.some(id => !activeIds.has(id))) {
      ctx.ui.notify('Source session changed while composing. Nothing was sent.', 'warning');
      return;
    }

    const requestId = randomUUID();
    pending.set(requestId, { sessionId: senderSessionId, sessionFile: senderSessionFile });
    pi.appendEntry('compose_handoff_request', {
      requestId, senderSessionId, recipientIntercomId: target.id,
      sourceLeafId, sourceEntryId, sourceEntryIds, kind,
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
  }

  return {
    showHandoff,
    async connectedRecipientIds(): Promise<Set<string>> {
      const peers = await channel?.listSessions() ?? [];
      return new Set(peers.map(peer => peer.id));
    },
  };
}

/**
 * Temporary native Pi TUI reader until the approved Ghostty Overview message
 * sidebar exists. It displays recorded facts only; it never marks messages read.
 */
export async function showHandoffHistory(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify('Handoff history requires an interactive Pi TUI.', 'warning');
    return;
  }
  const rows = projectHandoffHistory(ctx.sessionManager.getEntries());
  if (rows.length === 0) {
    ctx.ui.notify('No Compose Handoff records or intercom messages in this Pi session.', 'info');
    return;
  }
  const labels = rows.map((row, i) =>
    String(i + 1) + '. ' + row.direction + ' / ' + row.status +
    ' / ' + row.peer.slice(0, 32) + ' / ' + row.at.slice(0, 19));
  const selected = await ctx.ui.select('Handoff messages (recorded evidence only)', labels);
  if (!selected) return;
  const row = rows[labels.indexOf(selected)];
  if (!row) return;
  ctx.ui.notify([
    'Direction: ' + row.direction,
    'Status: ' + row.status,
    'Peer: ' + row.peer,
    'When: ' + row.at,
    'Message ID: ' + (row.messageId || 'not observed'),
    'Source entry: ' + (row.sourceEntryId || 'not recorded'),
    'Source leaf: ' + (row.sourceLeafId || 'not recorded'),
    'Excerpt: ' + (row.excerpt || 'not stored in this projection'),
    'This is not confirmation that a model read, accepted or approved the message.',
  ].join('\n'), 'info');
}
