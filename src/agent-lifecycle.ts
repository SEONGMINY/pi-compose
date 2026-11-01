import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type RuntimeReceipt = {
  version: 1;
  sessionId: string;
  launchRequestId: string;
  terminalId: string;
  pid?: number;
  processStart?: string;
  event: 'awaiting-split' | 'pi-starting' | 'pi-spawned' | 'pi-exited' | 'pi-spawn-failed';
  at: string;
  exitCode?: number | null;
  signal?: string | null;
  detail?: string;
};

export type AgentProcessState =
  | 'no-runtime-evidence'
  | 'starting-unverified'
  | 'process-observed'
  | 'process-unconfirmed'
  | 'exited-observed'
  | 'launch-failed';

export type AgentLifecycleObservation = {
  state: AgentProcessState;
  source: string;
  pid?: number;
  observedAt?: string;
  exitCode?: number | null;
  detail?: string;
};

function isReceipt(value: unknown): value is RuntimeReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return r.version === 1 &&
    typeof r.sessionId === 'string' &&
    typeof r.launchRequestId === 'string' &&
    typeof r.terminalId === 'string' &&
    typeof r.at === 'string' &&
    ['awaiting-split', 'pi-starting', 'pi-spawned', 'pi-exited', 'pi-spawn-failed'].includes(String(r.event));
}

/**
 * Child wrapper emits atomic process facts, not a broker/registry and not
 * model events. A PID alone is insufficient because macOS can reuse it.
 */
export async function observeAgentLifecycle(
  runtimeFile: string | undefined,
  expected: { sessionId: string; launchRequestId?: string; terminalId?: string },
): Promise<AgentLifecycleObservation> {
  if (!runtimeFile || !runtimeFile.startsWith('/')) {
    return { state: 'no-runtime-evidence', source: 'no runtime receipt in Pi session' };
  }
  let receipt: RuntimeReceipt;
  try {
    const raw = await readFile(runtimeFile, 'utf8');
    if (raw.length > 8192) throw new Error('receipt too large');
    const value: unknown = JSON.parse(raw);
    if (!isReceipt(value)) throw new Error('invalid receipt');
    receipt = value;
  } catch {
    return { state: 'process-unconfirmed', source: 'runtime receipt missing or unreadable' };
  }
  if (receipt.sessionId !== expected.sessionId ||
      (expected.launchRequestId && receipt.launchRequestId !== expected.launchRequestId) ||
      (expected.terminalId && receipt.terminalId !== expected.terminalId)) {
    return { state: 'process-unconfirmed', source: 'runtime receipt identity mismatch' };
  }
  const common = { observedAt: receipt.at, pid: receipt.pid, exitCode: receipt.exitCode };
  if (receipt.event === 'pi-exited') {
    return { state: 'exited-observed', source: 'child process exit event', ...common };
  }
  if (receipt.event === 'pi-spawn-failed') {
    return { state: 'launch-failed', source: 'child process spawn error', detail: receipt.detail, ...common };
  }
  if (receipt.event !== 'pi-spawned' || !receipt.pid || !receipt.processStart) {
    return { state: 'starting-unverified', source: 'native launch wrapper receipt', ...common };
  }
  if (process.platform !== 'darwin') {
    return { state: 'process-unconfirmed', source: 'macOS process identity not available', ...common };
  }
  try {
    // A PID is only treated as the same child if its OS process-start string
    // also equals the fingerprint recorded immediately after spawn.
    const { stdout } = await exec('/bin/ps', ['-p', String(receipt.pid), '-o', 'lstart='], {
      timeout: 2500, maxBuffer: 2048,
    });
    if (stdout.trim() === receipt.processStart) {
      return { state: 'process-observed', source: 'same OS PID and start time', ...common };
    }
    return { state: 'process-unconfirmed', source: 'process missing or PID was reused', ...common };
  } catch {
    return { state: 'process-unconfirmed', source: 'OS process presence could not be confirmed', ...common };
  }
}
