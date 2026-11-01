import { mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAgentBootstrap,
  createAgentBootstrapForSession,
  type ComposeAgentBootstrap,
} from './agent-bootstrap.ts';
import {
  focusGhosttyTerminal,
  getFocusedGhosttyTerminalId,
  listGhosttyTerminals,
  splitGhosttyTerminal,
} from './ghostty-native.ts';
import { createNativeWorkFork } from './native-work-fork.ts';

const launcher = fileURLToPath(new URL('../bin/native-agent-entry.mjs', import.meta.url));

export type NativeAgentLaunchRequest = {
  role: 'work' | 'support';
  product: string;
  label: string;
  task: string;
  requesterSessionId: string;
  requesterSessionFile?: string;
  targetCwd: string;
  // Must be supplied by the actual pic Overview. A Main/Work tab is not an
  // acceptable fallback anchor, even if it is the focused terminal.
  overviewAnchorTerminalId: string;
  source?: { sessionFile: string; sessionId: string; leafId: string };
};

export type NativeAgentLaunchReceipt = {
  launchRequestId: string;
  sessionId: string;
  terminalId: string;
  role: 'work' | 'support';
  // A Split receipt is NOT Pi readiness and not a completed task.
  state: 'ghostty-split-created-pi-unverified';
};

function shellWord(arg: string): string {
  // Ghostty's surface command is a single command string. Quote the two
  // filesystem paths as shell words; never interpolate task text here.
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

async function writeTicketAtomic(path: string, ticket: unknown): Promise<void> {
  const staged = path + '.next';
  await writeFile(staged, JSON.stringify(ticket), { mode: 0o600 });
  await rename(staged, path);
}

/**
 * Explicit user-approved launch, intended ONLY for the real pic Overview
 * controller once its native Terminal anchor exists.
 *
 * No creation on Main/Work Tab as a fallback, no model-authored dispatch,
 * no generic daemon, no Git worktree manipulation and no automatic retry.
 */
export async function startNativeAgentInOverview(
  request: NativeAgentLaunchRequest,
): Promise<NativeAgentLaunchReceipt> {
  if (process.platform !== 'darwin') {
    throw new Error('Ghostty native Agent creation requires macOS.');
  }
  if (!request.task.trim() || !request.label.trim() || !request.product.trim()) {
    throw new Error('Explicit task, product and label are required.');
  }
  if ((request.role === 'work') !== Boolean(request.source)) {
    throw new Error('Work requires a selected source; Support must remain independent.');
  }
  if (!request.overviewAnchorTerminalId) {
    throw new Error('A real pic Overview Ghostty Terminal anchor is required.');
  }
  const existing = await listGhosttyTerminals();
  if (!existing.some(term => term.id === request.overviewAnchorTerminalId)) {
    throw new Error('The specified pic Overview Terminal no longer exists.');
  }

  const targetCwd = resolve(request.targetCwd);
  let bootstrap: ComposeAgentBootstrap;
  let sessionFile: string | undefined;
  if (request.role === 'work') {
    const source = request.source!;
    const fork = await createNativeWorkFork({
      sourceSessionFile: source.sessionFile,
      sourceSessionId: source.sessionId,
      sourceLeafId: source.leafId,
      targetCwd,
    });
    sessionFile = fork.sessionFile;
    bootstrap = createAgentBootstrapForSession({
      sessionId: fork.sessionId,
      role: 'work',
      product: request.product,
      label: request.label,
      requesterSessionId: request.requesterSessionId,
      requesterSessionFile: request.requesterSessionFile,
      workspaceCwd: targetCwd,
      forkSourceSessionId: fork.sourceSessionId,
      forkSourceLeafId: fork.sourceLeafId,
    });
  } else {
    bootstrap = createAgentBootstrap({
      role: 'support',
      product: request.product,
      label: request.label,
      requesterSessionId: request.requesterSessionId,
      requesterSessionFile: request.requesterSessionFile,
      workspaceCwd: targetCwd,
    });
  }

  // Private one-shot ticket. The child Pi waits until Ghostty's own AppleScript
  // call returns the exact Terminal UUID. This is NOT a project contract DB.
  const ticketDir = await mkdtemp(join(tmpdir(), 'pi-compose-launch-'));
  const ticketPath = join(ticketDir, 'ticket.json');
  const base = {
    bootstrap,
    task: request.task,
    sessionFile,
    composeExtensionFile: fileURLToPath(new URL('../extensions/compose.ts', import.meta.url)),
  };
  await writeTicketAtomic(ticketPath, { ...base, ready: false });
  const previousFocusedId = await getFocusedGhosttyTerminalId().catch(() => undefined);

  const command = shellWord(process.execPath) + ' ' + shellWord(launcher);
  const terminalId = await splitGhosttyTerminal(
    request.overviewAnchorTerminalId,
    targetCwd,
    command,
    ['PI_COMPOSE_LAUNCH_TICKET=' + ticketPath],
  );

  // The child starts its real Pi process only after it sees this receipt.
  // If writing it fails, the child times out and does not start Pi. We never
  // blindly recreate the split or retransmit the initial user prompt.
  await writeTicketAtomic(ticketPath, {
    ...base, ready: true,
    bootstrap: { ...bootstrap, terminalId },
  });

  // Splitting may move focus. Return it ONLY if Ghostty still focuses the
  // just-created Surface. Never steal focus back after the user switched tabs.
  if (previousFocusedId && previousFocusedId !== terminalId) {
    const current = await getFocusedGhosttyTerminalId().catch(() => undefined);
    if (current === terminalId) {
      await focusGhosttyTerminal(previousFocusedId).catch(() => undefined);
    }
  }

  return {
    launchRequestId: bootstrap.launchRequestId,
    sessionId: bootstrap.sessionId,
    terminalId,
    role: request.role,
    state: 'ghostty-split-created-pi-unverified',
  };
}
