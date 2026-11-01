#!/usr/bin/env node
// A one-shot adapter inside the NEW Ghostty Surface, not an agent daemon.
// It waits only for the initiating Ghostty split to return its exact native ID.
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const launchFile = process.env.PI_COMPOSE_LAUNCH_TICKET;
if (!launchFile || !launchFile.startsWith('/')) {
  console.error('Pi Compose: a private launch ticket is required.');
  process.exitCode = 2;
} else {
  let ticket;
  for (let i = 0; i < 200; i++) {
    try {
      const parsed = JSON.parse(await readFile(launchFile, 'utf8'));
      if (parsed.ready === true) {
        ticket = parsed;
        break;
      }
    } catch (error) {
      // A ticket being atomically written may not be available yet.
      if (i === 199) console.error('Pi Compose: cannot read launch ticket:', String(error));
    }
    await delay(75);
  }

  if (!ticket) {
    console.error('Pi Compose: Ghostty split receipt was not confirmed; Pi was not started.');
    process.exitCode = 1;
  } else {
    const { bootstrap, task, composeExtensionFile, sessionFile } = ticket;
    const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (bootstrap?.version !== 1 ||
        !uuid.test(bootstrap.terminalId || '') ||
        !uuid.test(bootstrap.sessionId || '') ||
        typeof composeExtensionFile !== 'string' || !composeExtensionFile.startsWith('/') ||
        typeof task !== 'string' || !task.trim() ||
        (bootstrap.role !== 'support' && bootstrap.role !== 'work') ||
        (bootstrap.role === 'work' && (typeof sessionFile !== 'string' || !sessionFile.startsWith('/')))) {
      console.error('Pi Compose: invalid or incomplete native Agent launch ticket.');
      process.exitCode = 2;
    } else {
      const args = ['--extension', composeExtensionFile];
      if (bootstrap.role === 'work') args.push('--session', sessionFile);
      else args.push('--session-id', bootstrap.sessionId);
      // A literal positional prompt: no summarization, rewriting, or parent
      // session insertion. The direct >w/>s prefix is removed by the caller.
      args.push('--', task);
      const env = {
        ...process.env,
        PI_COMPOSE_AGENT_BOOTSTRAP_V1: Buffer.from(JSON.stringify(bootstrap), 'utf8').toString('base64url'),
      };
      delete env.PI_COMPOSE_LAUNCH_TICKET;
      try {
        // Launch file is ephemeral control state, not a transcript or a database.
        // Tickets are per-request private temp directories, never shared state.
        if (dirname(launchFile).split('/').pop().startsWith('pi-compose-launch-')) {
          await rm(dirname(launchFile), { recursive: true, force: true });
        } else {
          await rm(launchFile, { force: true });
        }
        const child = spawn('pi', args, { cwd: bootstrap.workspaceCwd, stdio: 'inherit', env });
        child.on('error', error => {
          console.error('Pi Compose: cannot start Pi:', String(error));
          process.exitCode = 127;
        });
        child.on('exit', (code, signal) => {
          process.exitCode = code ?? (signal ? 1 : 0);
        });
        await new Promise(resolve => child.once('close', resolve));
      } catch (error) {
        console.error('Pi Compose: Agent process launch failed:', String(error));
        process.exitCode = 1;
      }
    }
  }
}
