import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

export const AGENT_BOOTSTRAP_ENV = 'PI_COMPOSE_AGENT_BOOTSTRAP_V1';

export type ComposeAgentRole = 'main' | 'work' | 'support';

export type ComposeAgentBootstrap = {
  version: 1;
  launchRequestId: string;
  sessionId: string;
  role: ComposeAgentRole;
  product: string;
  label: string;
  workspaceCwd: string;
  requesterSessionId?: string;
  requesterSessionFile?: string;
  forkSourceSessionId?: string;
  forkSourceLeafId?: string;
};

function validId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value) &&
    value.length <= 128;
}

function requiredText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.length <= maxLength && !/[\r\n\x00-\x08\x0B-\x1F]/.test(value);
}

export function parseAgentBootstrap(value: unknown): ComposeAgentBootstrap | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;
  const role = raw.role;
  if (raw.version !== 1 || (role !== 'main' && role !== 'work' && role !== 'support')) return;
  if (!validId(raw.sessionId) || !validId(raw.launchRequestId)) return;
  if (!requiredText(raw.product, 120) || !requiredText(raw.label, 120)) return;
  if (!requiredText(raw.workspaceCwd, 4096) || !isAbsolute(raw.workspaceCwd)) return;
  for (const name of ['requesterSessionId', 'forkSourceSessionId', 'forkSourceLeafId']) {
    if (raw[name] !== undefined && !validId(raw[name])) return;
  }
  if (raw.requesterSessionFile !== undefined &&
    (!requiredText(raw.requesterSessionFile, 4096) || !isAbsolute(raw.requesterSessionFile))) return;
  if (role === 'work' && (!raw.forkSourceSessionId || !raw.forkSourceLeafId)) return;
  if (role !== 'work' && (raw.forkSourceSessionId || raw.forkSourceLeafId)) return;
  return {
    version: 1,
    launchRequestId: raw.launchRequestId,
    sessionId: raw.sessionId,
    role,
    product: raw.product,
    label: raw.label,
    workspaceCwd: raw.workspaceCwd,
    requesterSessionId: raw.requesterSessionId,
    requesterSessionFile: raw.requesterSessionFile,
    forkSourceSessionId: raw.forkSourceSessionId,
    forkSourceLeafId: raw.forkSourceLeafId,
  };
}

/**
 * A launch ticket identifies a newly created Pi session before Ghostty starts it.
 * Never use source/fork session IDs as the child's identity.
 */
export function createAgentBootstrap(
  args: Omit<ComposeAgentBootstrap, 'version' | 'launchRequestId' | 'sessionId'>,
): ComposeAgentBootstrap {
  const value = parseAgentBootstrap({
    version: 1,
    launchRequestId: randomUUID(),
    sessionId: randomUUID(),
    ...args,
  });
  if (!value) throw new Error('Cannot create Pi Compose Agent identity from invalid launch metadata.');
  return value;
}

export function encodeAgentBootstrap(data: ComposeAgentBootstrap): string {
  const checked = parseAgentBootstrap(data);
  if (!checked) throw new Error('Invalid Pi Compose Agent bootstrap.');
  return Buffer.from(JSON.stringify(checked), 'utf8').toString('base64url');
}

export function decodeAgentBootstrap(encoded: string | undefined): ComposeAgentBootstrap | undefined {
  if (!encoded || encoded.length > 12000 || !/^[\w-]+$/.test(encoded)) return;
  try {
    return parseAgentBootstrap(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
  } catch {
    return undefined;
  }
}
