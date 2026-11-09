#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAgentBootstrap, encodeAgentBootstrap, AGENT_BOOTSTRAP_ENV } from '../src/agent-bootstrap.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coreExtension = resolve(root, 'extensions/compose.ts');
const optionalPackage = resolve(root, 'packages/optional');

function runPi(args, options = {}) {
  return new Promise((done) => {
    const child = spawn('pi', args, {
      stdio: 'inherit', cwd: options.cwd ?? process.cwd(), env: options.env ?? process.env,
    });
    let failed = false;
    child.once('error', (error) => {
      failed = true;
      console.error(error.code === 'ENOENT'
        ? 'pic: Pi was not found on PATH. Install @earendil-works/pi-coding-agent first.'
        : 'pic: Could not start Pi: ' + error.message);
      done(error.code === 'ENOENT' ? 127 : 1);
    });
    child.once('close', (code, signal) => {
      if (failed) return;
      done(signal ? 128 + (constants.signals[signal] || 1) : (code ?? 1));
    });
  });
}

const args = process.argv.slice(2);
const command = args[0];

// A one-time, explicit opt-in to the optional feature bundle. All three features
// are initially enabled by Pi on installation; pi config owns later selection.
if (!command) {
  // Every bare 'pic' starts a NEW Main in this terminal, just as bare 'pi'
  // starts a new session. Resume remains an explicit Pi-owned operation.
  const cwd = realpathSync(process.cwd());
  const projectKey = createHash('sha256').update(cwd).digest('hex').slice(0, 24);
  const bootstrap = createAgentBootstrap({
    role: 'main',
    product: 'cwd-' + projectKey,
    label: basename(cwd) || 'Main',
    workspaceCwd: cwd,
  });
  const env = { ...process.env, [AGENT_BOOTSTRAP_ENV]: encodeAgentBootstrap(bootstrap) };
  delete env.PI_COMPOSE_OVERVIEW_TERMINAL_ID;
  process.exitCode = await runPi(
    ['--extension', coreExtension, '--session-id', bootstrap.sessionId],
    { cwd, env },
  );
} else if (command === 'features') {
  const flags = args.slice(1);
  if (flags.length > 1 || (flags.length === 1 && flags[0] !== '--local' && flags[0] !== '-l')) {
    console.error('Usage: pic features [--local]');
    process.exitCode = 2;
  } else {
    const scope = flags.length ? ['--local'] : [];
    console.log('pic: Installing the optional Pi Compose package. Dashboard, Handoff, and Verify start ENABLED; disable any you do not want in the Pi config screen. These choices are shared with regular pi.');
    const result = await runPi(['install', optionalPackage, ...scope]);
    process.exitCode = result === 0 ? await runPi(['config', ...scope]) : result;
  }
} else if (new Set(['config', 'install', 'remove', 'uninstall', 'update', 'list', 'auth', 'mcp']).has(command)) {
  // Pi already owns package configuration, persistence, and authentication.
  process.exitCode = await runPi(args);
} else {
  // Pi owns cwd, models, providers, session storage, project settings, and TUI.
  // Explicit -e is the only difference from an ordinary "pi" invocation.
  // Pi --resume / --continue / --session must load the saved relationship
  // from its own transcript, not inherit a parent's one-shot bootstrap.
  const env = { ...process.env };
  delete env[AGENT_BOOTSTRAP_ENV];
  delete env.PI_COMPOSE_OVERVIEW_TERMINAL_ID;
  process.exitCode = await runPi(['--extension', coreExtension, ...args], { env });
}
