#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coreExtension = resolve(root, 'extensions/compose.ts');
const optionalPackage = resolve(root, 'packages/optional');

function runPi(args) {
  return new Promise((done) => {
    const child = spawn('pi', args, { stdio: 'inherit', cwd: process.cwd(), env: process.env });
    let failed = false;
    child.once('error', (error) => {
      failed = true;
      console.error(error.code === 'ENOENT'
        ? 'pico: Pi was not found on PATH. Install @earendil-works/pi-coding-agent first.'
        : 'pico: Could not start Pi: ' + error.message);
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
if (command === 'features') {
  const flags = args.slice(1);
  if (flags.length > 1 || (flags.length === 1 && flags[0] !== '--local' && flags[0] !== '-l')) {
    console.error('Usage: pico features [--local]');
    process.exitCode = 2;
  } else {
    const scope = flags.length ? ['--local'] : [];
    const result = await runPi(['install', optionalPackage, ...scope]);
    process.exitCode = result === 0 ? await runPi(['config', ...scope]) : result;
  }
} else if (new Set(['config', 'install', 'remove', 'uninstall', 'update', 'list', 'auth', 'mcp']).has(command)) {
  // Pi already owns package configuration, persistence, and authentication.
  process.exitCode = await runPi(args);
} else {
  // Pi owns cwd, models, providers, session storage, project settings, and TUI.
  // Explicit -e is the only difference from an ordinary "pi" invocation.
  process.exitCode = await runPi(['--extension', coreExtension, ...args]);
}
