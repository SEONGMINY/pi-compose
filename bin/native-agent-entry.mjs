#!/usr/bin/env node
// One-shot child bootstrap within the exact new Ghostty Surface.
// Native Pi owns its session and transcript. This wrapper records only OS
// spawn/exit facts; it is not a daemon, agent registry or message broker.
import { spawn, execFile } from 'node:child_process';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const execFileAsync = promisify(execFile);
const launchFile = process.env.PI_COMPOSE_LAUNCH_TICKET;
if (!launchFile || !launchFile.startsWith('/')) {
  console.error('Pi Compose: a private launch ticket is required.');
  process.exitCode = 2;
} else {
  let ticket;
  for (let i = 0; i < 200; i++) {
    try {
      const value = JSON.parse(await readFile(launchFile, 'utf8'));
      if (value.ready === true) { ticket = value; break; }
    } catch {
      // The initiating Ghostty AppleScript call may still be completing.
    }
    await delay(75);
  }

  if (!ticket) {
    console.error('Pi Compose: Ghostty split receipt missing; Pi was NOT started.');
    process.exitCode = 1;
  } else {
    const { bootstrap, task, composeExtensionFile, sessionFile, overviewTerminalId } = ticket;
    const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    const good =
      bootstrap?.version === 1 &&
      uuid.test(bootstrap.terminalId || '') &&
      uuid.test(bootstrap.sessionId || '') &&
      uuid.test(overviewTerminalId || '') &&
      typeof bootstrap.launchRequestId === 'string' &&
      typeof bootstrap.runtimeReceiptFile === 'string' &&
      bootstrap.runtimeReceiptFile === join(dirname(launchFile), 'runtime.json') &&
      typeof composeExtensionFile === 'string' && composeExtensionFile.startsWith('/') &&
      ['main', 'work', 'support'].includes(bootstrap.role) &&
      (bootstrap.role === 'main' ? task === undefined :
        typeof task === 'string' && task.trim().length > 0) &&
      (sessionFile === undefined ||
        (typeof sessionFile === 'string' && sessionFile.startsWith('/'))) &&
      (bootstrap.role !== 'work' || typeof sessionFile === 'string');
    if (!good) {
      console.error('Pi Compose: invalid/incomplete native Agent launch ticket.');
      process.exitCode = 2;
    } else {
      // The task itself stays in the one-shot private launch permit, not in
      // a long-lived status file or in the caller's Main conversation.
      await rm(launchFile, { force: true });
      const runtimeFile = bootstrap.runtimeReceiptFile;
      let receiptQueue = Promise.resolve();
      const record = (event, extra = {}) => {
        const value = {
          version: 1,
          sessionId: bootstrap.sessionId,
          launchRequestId: bootstrap.launchRequestId,
          terminalId: bootstrap.terminalId,
          event, at: new Date().toISOString(), ...extra,
        };
        receiptQueue = receiptQueue.then(async () => {
          const next = runtimeFile + '.' + randomUUID() + '.next';
          await writeFile(next, JSON.stringify(value), { mode: 0o600 });
          await rename(next, runtimeFile);
        }).catch(err => {
          console.error('Pi Compose: runtime evidence not recorded:', String(err));
        });
        return receiptQueue;
      };

      const args = ['--extension', composeExtensionFile];
      if (sessionFile) args.push('--session', sessionFile);
      else args.push('--session-id', bootstrap.sessionId);
      if (bootstrap.role !== 'main') args.push('--', task);
      const env = {
        ...process.env,
        PI_COMPOSE_AGENT_BOOTSTRAP_V1: Buffer.from(JSON.stringify(bootstrap), 'utf8').toString('base64url'),
        PI_COMPOSE_OVERVIEW_TERMINAL_ID: overviewTerminalId,
      };
      delete env.PI_COMPOSE_LAUNCH_TICKET;
      await record('pi-starting');

      try {
        const child = spawn('pi', args, { cwd: bootstrap.workspaceCwd, stdio: 'inherit', env });
        let failed = false;
        let spawnEvidence = Promise.resolve();
        let exitEvidence;
        child.once('spawn', () => {
          // ps lstart is an OS process identity fingerprint. A PID alone
          // could refer to a different process after reuse.
          spawnEvidence = (async () => {
            let processStart;
            try {
              const result = await execFileAsync('/bin/ps', ['-p', String(child.pid), '-o', 'lstart='], {
                timeout: 2500, maxBuffer: 2048,
              });
              processStart = result.stdout.trim();
            } catch { /* A missing fingerprint remains an unconfirmed process. */ }
            await record('pi-spawned', { pid: child.pid, processStart });
          })();
        });
        child.once('error', error => {
          failed = true;
          void record('pi-spawn-failed', { detail: String(error) });
          process.exitCode = 127;
        });
        child.once('exit', (code, signal) => {
          exitEvidence = { pid: child.pid, exitCode: code, signal };
          process.exitCode = code ?? (signal ? 1 : process.exitCode ?? 0);
        });
        await new Promise(resolve => child.once('close', resolve));
        // Never allow a delayed OS start-time lookup to overwrite the final
        // exit result with a stale 'pi-spawned' event.
        await spawnEvidence;
        if (!failed) await record('pi-exited', exitEvidence ?? { pid: child.pid });
        await receiptQueue;
      } catch (error) {
        await record('pi-spawn-failed', { detail: String(error) });
        console.error('Pi Compose: Agent launch failed:', String(error));
        process.exitCode = 1;
      }
    }
  }
}
