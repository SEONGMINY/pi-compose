import { SessionManager } from '@earendil-works/pi-coding-agent';
import { realpath, stat } from 'node:fs/promises';

export type NativeWorkForkRequest = {
  sourceSessionFile: string;
  sourceSessionId: string;
  sourceLeafId: string;
  targetCwd: string;
};

export type NativeWorkForkResult = {
  sessionId: string;
  sessionFile: string;
  sourceSessionId: string;
  sourceLeafId: string;
  sourceSessionFile: string;
  targetCwd: string;
};

/**
 * Pi 1.4.0 CLI --fork copies the full JSONL. For Compose's exact-active-leaf
 * contract we instead use the native Pi SessionManager.createBranchedSession.
 *
 * The manager opens the source file with a NEW target directory; the branching
 * operation creates another session file and never rewrites the source JSONL.
 * The selected leaf must be an explicitly verified COMPLETED answer, not an
 * interrupted or uncompleted tool call.
 *
 * Call only after an explicit user instruction to create Work.
 */
export async function createNativeWorkFork(
  request: NativeWorkForkRequest,
): Promise<NativeWorkForkResult> {
  const [sourceFile, targetCwd] = await Promise.all([
    realpath(request.sourceSessionFile),
    realpath(request.targetCwd),
  ]);
  if (!(await stat(sourceFile)).isFile() || !(await stat(targetCwd)).isDirectory()) {
    throw new Error('Pi Compose Fork requires a real source JSONL and target directory.');
  }

  // A fresh manager is used only to discover Pi's default target session dir.
  // It is never switched into the original Main or sent a model message.
  const targetSessionDir = SessionManager.create(targetCwd).getSessionDir();
  const source = SessionManager.open(sourceFile, targetSessionDir, targetCwd);
  if (source.getHeader()?.id !== request.sourceSessionId) {
    throw new Error('Fork source session ID does not match the exact requested Pi session.');
  }
  const branch = source.getBranch(request.sourceLeafId);
  if (!branch.length || branch[branch.length - 1].id !== request.sourceLeafId) {
    throw new Error('Fork leaf is not in the named source session.');
  }

  const lastConversationMessage = [...branch].reverse().find(
    entry => entry.type === 'message' &&
      (entry.message.role === 'user' || entry.message.role === 'assistant'),
  );
  if (!lastConversationMessage || lastConversationMessage.type !== 'message' ||
      lastConversationMessage.message.role !== 'assistant' ||
      lastConversationMessage.message.stopReason !== 'stop') {
    throw new Error('The selected Fork leaf is not after a completed Assistant turn.');
  }

  // Includes original Compaction/ContextEdit semantics and only the selected
  // ancestry, unlike blindly copying the entire source JSONL.
  const forkFile = source.createBranchedSession(request.sourceLeafId);
  if (!forkFile) throw new Error('Pi did not persist the selected Fork branch.');
  return {
    sessionId: source.getSessionId(),
    sessionFile: forkFile,
    sourceSessionId: request.sourceSessionId,
    sourceLeafId: request.sourceLeafId,
    sourceSessionFile: sourceFile,
    targetCwd,
  };
}
