import { SessionManager, type SessionInfo } from '@earendil-works/pi-coding-agent';
import { readAgentRelationship } from './agent-relationships.ts';

export type ForkSessionCandidate = {
  id: string;
  file: string;
  name: string;
  recentTask: string;
  cwd: string;
  role: 'main' | 'work' | 'support';
  leafId: string;
  modified: Date;
};

function textContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(part =>
    part && typeof part === 'object' && part.type === 'text' &&
    typeof part.text === 'string',
  ).map(part => part.text).join('\n');
}
function lastGroundedTask(manager: SessionManager, fallback: SessionInfo): string {
  const messages = manager.getBranch().filter(entry =>
    entry.type === 'message' && entry.message.role === 'user',
  );
  const last = messages[messages.length - 1];
  if (last?.type === 'message' && last.message.role === 'user') {
    return textContent(last.message.content).replace(/\s+/g, ' ').trim().slice(0, 110);
  }
  return fallback.firstMessage.replace(/\s+/g, ' ').trim().slice(0, 110);
}
function completedLeaf(manager: SessionManager): string | undefined {
  const leafId = manager.getLeafId();
  if (!leafId) return;
  const ancestry = manager.getBranch(leafId);
  if (!ancestry.length || ancestry[ancestry.length - 1].id !== leafId) return;
  const last = [...ancestry].reverse().find(entry => entry.type === 'message' &&
    (entry.message.role === 'assistant' || entry.message.role === 'user'));
  if (last?.type !== 'message' || last.message.role !== 'assistant' ||
      last.message.stopReason !== 'stop') return;
  return leafId;
}

/**
 * Native Pi sessions across projects, restricted to the product recorded by
 * Compose. No cwd/name heuristics and no automatic resume of a candidate.
 */
export async function listProductForkSessions(product: string): Promise<ForkSessionCandidate[]> {
  const sessions = await SessionManager.listAll();
  const result: ForkSessionCandidate[] = [];
  for (const info of sessions) {
    let manager: SessionManager;
    try { manager = SessionManager.open(info.path); } catch { continue; }
    if (manager.getSessionId() !== info.id) continue;
    const identity = readAgentRelationship(info.id, manager.getEntries());
    if (!identity || identity.product !== product) continue;
    const leafId = completedLeaf(manager);
    if (!leafId) continue;
    result.push({
      id: info.id, file: info.path, cwd: identity.workspaceCwd,
      name: identity.label, role: identity.role,
      recentTask: lastGroundedTask(manager, info),
      leafId, modified: info.modified,
    });
  }
  return result.sort((a,b) => b.modified.getTime() - a.modified.getTime());
}

export function searchProductForkSessions(
  candidates: readonly ForkSessionCandidate[],
  query: string,
): ForkSessionCandidate[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...candidates];
  return candidates.filter(session =>
    [session.id, session.name, session.recentTask].some(text =>
      text.toLocaleLowerCase().includes(normalized),
    ));
}
