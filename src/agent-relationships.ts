import type { GhosttyTerminal } from './ghostty-native.ts';

export type AgentRole = 'main' | 'work' | 'support';

/**
 * Native Pi session entries are the record of origin for Compose-owned agents.
 * Fork lineage and requester/creator are separate: NEVER infer one from another.
 */
export type AgentRelationship = {
  sessionId: string;
  product: string;
  role: AgentRole;
  label: string;
  requesterSessionId?: string;
  forkSourceSessionId?: string;
  forkSourceLeafId?: string;
  workspaceCwd: string;
  launchRequestId?: string;
  terminalId?: string;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
function asRole(value: unknown): AgentRole | undefined {
  return value === 'main' || value === 'work' || value === 'support' ? value : undefined;
}

/**
 * Only explicitly recorded, current-session ownership metadata is accepted.
 * Forked Pi sessions inherit earlier JSONL entries, including custom entries:
 * matching sessionId avoids mistaking an inherited role/creator for the child.
 */
export function readAgentRelationship(
  currentSessionId: string,
  entries: readonly unknown[],
): AgentRelationship | undefined {
  let relationship: AgentRelationship | undefined;
  for (const raw of entries) {
    const entry = object(raw);
    if (entry?.type !== 'custom' || entry.customType !== 'compose_agent_identity') continue;
    const d = object(entry.data);
    if (!d || str(d.sessionId) !== currentSessionId) continue;
    const role = asRole(d.role);
    const product = str(d.product);
    const label = str(d.label);
    const workspaceCwd = str(d.workspaceCwd);
    if (!role || !product || !label || !workspaceCwd) continue;
    relationship = {
      sessionId: currentSessionId,
      product,
      role,
      label,
      workspaceCwd,
      requesterSessionId: str(d.requesterSessionId),
      forkSourceSessionId: str(d.forkSourceSessionId),
      forkSourceLeafId: str(d.forkSourceLeafId),
      launchRequestId: str(d.launchRequestId),
    };
  }

  if (!relationship) return undefined;
  // A binding is valid only if it explicitly identifies this Pi session and a
  // real UUID. No mapping from GHOSTTY_SURFACE_ID, cwd, title, or foreground PID.
  let terminalId: string | undefined;
  for (const raw of entries) {
    const entry = object(raw);
    if (entry?.type !== 'custom' || entry.customType !== 'compose_surface_binding') continue;
    const d = object(entry.data);
    if (str(d?.sessionId) !== currentSessionId) continue;
    const id = str(d?.terminalId);
    if (id && /^[0-9a-fA-F-]{36}$/.test(id)) terminalId = id;
  }
  return { ...relationship, terminalId };
}

/**
 * Resolve only exact known native terminal IDs. If the user drags a Surface to
 * another tab, Ghostty still owns that terminal and its current location.
 */
export function findLiveTerminal(
  agent: AgentRelationship,
  terminals: readonly GhosttyTerminal[],
): GhosttyTerminal | undefined {
  if (!agent.terminalId) return undefined;
  return terminals.find(terminal => terminal.id === agent.terminalId);
}

/** Stable creation/request hierarchy, distinct from context Fork lineage. */
export function buildAgentTree(agents: readonly AgentRelationship[]): {
  byProduct: Map<string, AgentRelationship[]>;
  unlinked: AgentRelationship[];
} {
  const byProduct = new Map<string, AgentRelationship[]>();
  const validIds = new Set(agents.map(agent => agent.sessionId));
  const unlinked: AgentRelationship[] = [];
  for (const agent of agents) {
    if (agent.requesterSessionId && !validIds.has(agent.requesterSessionId)) {
      unlinked.push(agent);
    }
    const group = byProduct.get(agent.product) ?? [];
    group.push(agent);
    byProduct.set(agent.product, group);
  }
  // Arrays preserve the caller's creation order; runtime changes never sort.
  return { byProduct, unlinked };
}
