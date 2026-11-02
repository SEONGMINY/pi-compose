import { mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';
import { readAgentRelationship } from './agent-relationships.ts';
import { observeAgentLifecycle } from './agent-lifecycle.ts';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
import { createNativeWorktree, type NativeWorktreeReceipt } from './native-worktree.ts';

const launcher = fileURLToPath(new URL('../bin/native-agent-entry.mjs', import.meta.url));


export type NativeMainLaunchRequest = {
  product: string;
  label: string;
  targetCwd: string;
  overviewAnchorTerminalId: string;
  /** A user-selected persisted Pi session, NOT the most recent session. */
  resume?: { sessionFile: string; sessionId: string; allowUnconfirmedProcess?: boolean };
};

export type NativeMainLaunchReceipt = {
  launchRequestId: string;
  sessionId: string;
  terminalId: string;
  runtimeReceiptFile: string;
  state: 'ghostty-split-created-pi-unverified';
  mode: 'new-main' | 'resume-main';
};

export type NativeAgentLaunchRequest = {
  role: 'work' | 'support';
  product: string;
  label: string;
  task: string;
  requesterSessionId: string;
  requesterSessionFile?: string;
  targetCwd: string;
  workspace?: 'shared' | 'worktree';
  // Must be supplied by the actual pic Overview. A Main/Work tab is not an
  // acceptable fallback anchor, even if it is the focused terminal.
  overviewAnchorTerminalId: string;
  source?: { sessionFile: string; sessionId: string; leafId: string };
};

export type NativeAgentLaunchReceipt = {
  launchRequestId: string;
  sessionId: string;
  terminalId: string;
  runtimeReceiptFile: string;
  role: 'work' | 'support';
  worktree?: NativeWorktreeReceipt;
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


async function launchNativeSplit(
  bootstrap: ComposeAgentBootstrap,
  task: string | undefined,
  sessionFile: string | undefined,
  overviewAnchorTerminalId: string,
  targetCwd: string,
): Promise<{ terminalId: string; runtimeReceiptFile: string }> {
  const existing = await listGhosttyTerminals();
  if (!existing.some(term => term.id === overviewAnchorTerminalId)) {
    throw new Error('The exact pic Overview anchor Terminal no longer exists.');
  }
  const ticketDir = await mkdtemp(join(tmpdir(), 'pi-compose-launch-'));
  const ticketPath = join(ticketDir, 'ticket.json');
  const runtimeReceiptFile = join(ticketDir, 'runtime.json');
  const bootstrapWithReceipt = { ...bootstrap, runtimeReceiptFile };
  const base = {
    bootstrap: bootstrapWithReceipt, task, sessionFile,
    overviewTerminalId: overviewAnchorTerminalId,
    composeExtensionFile: fileURLToPath(new URL('../extensions/compose.ts', import.meta.url)),
  };
  await writeTicketAtomic(ticketPath, { ...base, ready: false });
  const previousFocusedId = await getFocusedGhosttyTerminalId().catch(() => undefined);
  const command = shellWord(process.execPath) + ' ' + shellWord(launcher);
  // Ghostty creates a fresh login-managed Surface. Its default PATH may not
  // include the nvm/npm Pi executable found by the invoking terminal. Preserve
  // the explicit caller PATH, rather than guessing where `pi` is installed.
  const callerPath = process.env.PATH;
  if (!callerPath) {
    throw new Error('Cannot launch Pi: the invoking terminal has no PATH.');
  }
  const splitEnvironment = ['PI_COMPOSE_LAUNCH_TICKET=' + ticketPath, 'PATH=' + callerPath];
  let terminalId: string;
  try {
    terminalId = await splitGhosttyTerminal(
      overviewAnchorTerminalId, targetCwd, command,
      splitEnvironment,
    );
    await writeTicketAtomic(ticketPath, {
      ...base, ready: true,
      bootstrap: { ...bootstrapWithReceipt, terminalId },
    });
  } catch (error) {
    // Unknown split outcome must never cause an automatic second attempt.
    await rm(ticketDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  if (previousFocusedId && previousFocusedId !== terminalId) {
    const current = await getFocusedGhosttyTerminalId().catch(() => undefined);
    if (current === terminalId) {
      await focusGhosttyTerminal(previousFocusedId).catch(() => undefined);
    }
  }
  return { terminalId, runtimeReceiptFile };
}

/**
 * User-created Main or explicit existing-Main resume. Never generate an
 * initial prompt. Pi keeps a new blank session in memory until first chat.
 */
export async function startNativeMainInOverview(
  request: NativeMainLaunchRequest,
): Promise<NativeMainLaunchReceipt> {
  if (process.platform !== 'darwin') throw new Error('Ghostty Main creation requires macOS.');
  if (!request.overviewAnchorTerminalId) throw new Error('An exact Overview Terminal is required.');
  if (!request.product.trim() || !request.label.trim()) {
    throw new Error('Main product and display name must be user-selected.');
  }
  const cwd = await realpath(request.targetCwd);
  let sessionId: string;
  let sessionFile: string | undefined;
  if (request.resume) {
    sessionFile = await realpath(request.resume.sessionFile);
    const old = SessionManager.open(sessionFile);
    const sourceCwd = await realpath(old.getCwd());
    if (old.getSessionId() !== request.resume.sessionId || sourceCwd !== cwd) {
      throw new Error('The exact Main session ID or working directory did not match.');
    }
    const existing = readAgentRelationship(sessionId = old.getSessionId(), old.getEntries());
    if (existing && (existing.role !== 'main' ||
        existing.product !== request.product || existing.label !== request.label)) {
      throw new Error('The saved Pi session has a conflicting Compose Agent identity.');
    }
    // If this exact session already owns a live Ghostty Surface, the caller
    // must focus it instead of duplicating a running Pi process.
    if (existing?.terminalId &&
        (await listGhosttyTerminals()).some(term => term.id === existing.terminalId)) {
      throw new Error('Main has an existing Ghostty Surface. Focus it instead of resuming.');
    }
    const runtime = await observeAgentLifecycle(existing?.runtimeReceiptFile, {
      sessionId,
      launchRequestId: existing?.runtimeLaunchRequestId,
      terminalId: existing?.terminalId,
    });
    if (runtime.state === 'process-observed') {
      throw new Error('The selected Main OS process is still present. Do not start a duplicate Pi.');
    }
    if (runtime.state !== 'exited-observed' &&
        runtime.state !== 'launch-failed' &&
        request.resume.allowUnconfirmedProcess !== true) {
      throw new Error('The selected Main process status is unknown. Explicit user acknowledgement is required to resume.');
    }
  } else {
    sessionId = randomUUID();
  }

  const bootstrap = createAgentBootstrapForSession({
    sessionId, role: 'main', product: request.product,
    label: request.label, workspaceCwd: cwd,
  });
  const { terminalId, runtimeReceiptFile } = await launchNativeSplit(
    bootstrap, undefined, sessionFile, request.overviewAnchorTerminalId, cwd,
  );
  return {
    launchRequestId: bootstrap.launchRequestId,
    sessionId: bootstrap.sessionId,
    terminalId,
    runtimeReceiptFile,
    mode: request.resume ? 'resume-main' : 'new-main',
    state: 'ghostty-split-created-pi-unverified',
  };
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

  // The calling Agent's workspace remains the Git source of truth even when
  // the selected Fork transcript belongs to a different workspace.
  const callerCwd = await realpath(request.targetCwd);
  const worktree = request.workspace === 'worktree'
    ? await createNativeWorktree(callerCwd, request.role)
    : undefined;
  const targetCwd = worktree?.workspaceCwd ?? callerCwd;
  const gitWorktree = worktree ? {
    path: worktree.worktreePath,
    sourceRoot: worktree.root,
    branch: worktree.branch,
    baseBranch: worktree.baseBranch,
    baseCommit: worktree.baseCommit,
    hadUncommittedChanges: worktree.hadUncommittedChanges,
  } : undefined;
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
      gitWorktree,
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
      gitWorktree,
    });
  }

  const { terminalId, runtimeReceiptFile } = await launchNativeSplit(
    bootstrap, request.task, sessionFile,
    request.overviewAnchorTerminalId, targetCwd,
  );

  return {
    launchRequestId: bootstrap.launchRequestId,
    sessionId: bootstrap.sessionId,
    terminalId,
    runtimeReceiptFile,
    role: request.role,
    worktree,
    state: 'ghostty-split-created-pi-unverified',
  };
}
