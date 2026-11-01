/**
 * Read-only projection of Handoff evidence already saved in the native Pi session.
 * This module never sends messages or changes any session/contract state.
 */
export type HandoffHistoryRow = {
  direction: 'outgoing' | 'incoming';
  id: string;
  peer: string;
  status: 'sent' | 'rejected' | 'blocked' | 'failed' | 'outcome-unknown' | 'recorded-in-pi';
  at: string;
  kind?: string;
  sourceEntryId?: string;
  sourceLeafId?: string;
  messageId?: string;
  excerpt?: string;
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : undefined;
}
function field(value: RecordValue | undefined, name: string): string | undefined {
  const valueAtKey = value?.[name];
  return typeof valueAtKey === 'string' && valueAtKey.length ? valueAtKey : undefined;
}
function excerpt(value: string | undefined): string | undefined {
  return value?.replace(/\s+/g, ' ').trim().slice(0, 120) || undefined;
}

/** Never equate 'sent' or 'recorded-in-pi' with model consumption or approval. */
export function projectHandoffHistory(rawEntries: readonly unknown[], max = 40): HandoffHistoryRow[] {
  const sent = new Map<string, HandoffHistoryRow>();
  const inbound: HandoffHistoryRow[] = [];
  const sentBodies = new Map<string, string>();
  for (const value of rawEntries) {
    const entry = record(value);
    if (!entry) continue;
    const at = field(entry, 'timestamp') || '';
    if (entry.type === 'custom') {
      const data = record(entry.data);
      const requestId = field(data, 'requestId');
      if (entry.customType === 'compose_handoff_request' && requestId) {
        sent.set(requestId, {
          direction: 'outgoing',
          id: requestId,
          peer: field(data, 'recipientIntercomId') || 'unknown recipient',
          kind: field(data, 'kind'),
          sourceLeafId: field(data, 'sourceLeafId'),
          sourceEntryId: field(data, 'sourceEntryId'),
          status: 'outcome-unknown',
          at,
        });
      } else if ((entry.customType === 'compose_handoff_delivery' ||
                  entry.customType === 'intercom_outbox_result') && requestId) {
        const previous = sent.get(requestId);
        if (!previous) continue;
        const status = field(data, 'status');
        sent.set(requestId, {
          ...previous,
          status: status === 'sent' || status === 'rejected' ||
            status === 'blocked' || status === 'failed' ? status : 'outcome-unknown',
          messageId: field(data, 'messageId'),
        });
      } else if (entry.customType === 'intercom_sent') {
        const messageId = field(data, 'messageId');
        const msg = record(data?.message);
        if (messageId) {
          const body = field(msg, 'text');
          if (body) sentBodies.set(messageId, body);
        }
      }
    }
    if (entry.type === 'custom_message' && entry.customType === 'intercom_message') {
      const details = record(entry.details);
      const sender = record(details?.from);
      const message = record(details?.message);
      inbound.push({
        direction: 'incoming',
        id: field(message, 'id') || field(entry, 'id') || 'unknown message',
        peer: field(sender, 'name') || field(sender, 'id') || 'unknown sender',
        status: 'recorded-in-pi',
        at,
        messageId: field(message, 'id'),
        excerpt: excerpt(typeof entry.content === 'string' ? entry.content : undefined),
      });
    }
  }
  const outgoing = Array.from(sent.values()).map(value => ({
    ...value,
    excerpt: excerpt(value.messageId ? sentBodies.get(value.messageId) : undefined),
  }));
  const count = Number.isSafeInteger(max) && max > 0 ? max : 40;
  return [...outgoing, ...inbound]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, count);
}
