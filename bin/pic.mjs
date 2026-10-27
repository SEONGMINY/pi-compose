#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maybeOnboard, setupRecommended, printDoctor } from './setup.mjs';
import { diagnosticsCli } from './diagnostics.mjs';
import { installedProvenance, installedExecutables } from '../src/provenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coreExtension = resolve(root, 'extensions/compose.ts');
const optionalPackage = resolve(root, 'packages/optional');
const navigationPackage = resolve(root, 'packages/navigation');

function runPi(args) {
  return new Promise((done) => {
    const isComposeSession = args[0] === '--extension' && args[1] === coreExtension;
    const env = isComposeSession ? { ...process.env, PIC_COMPOSE_CORE: '1', PIC_COMPOSE_MAIN: '1' } : process.env;
    const child = spawn('pi', args, { stdio: 'inherit', cwd: process.cwd(), env });
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

function runWorkmux(args) {
  return new Promise(done => {
    const child = spawn('workmux', args, { stdio: 'inherit', cwd: process.cwd() });
    let failed = false;
    child.once('error', error => {
      failed = true;
      console.error('pic: workmux could not start: ' + error.message);
      done(127);
    });
    child.once('close', (code, signal) => {
      if (!failed) done(signal ? 128 + (constants.signals[signal] || 1) : (code ?? 1));
    });
  });
}

// Bare interactive pic starts in a project-scoped tmux session. No user
// tmux configuration is changed; subsequent calls attach to the same target.
function quoteShell(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
function runInProjectTmux() {
  const cwd = realpathSync(process.cwd());
  const name = 'pic-' + createHash('sha256').update(cwd).digest('hex').slice(0, 12);
  const commandLine = 'PIC_SETUP_SKIP=1 exec ' + [process.execPath, fileURLToPath(import.meta.url)].map(quoteShell).join(' ');
  return new Promise((done) => {
    const child = spawn('tmux', ['new-session', '-A', '-s', name, '-c', cwd,
      '-e', 'PATH=' + (process.env.PATH || '/usr/local/bin:/usr/bin:/bin'), commandLine],
    { cwd, env: process.env, stdio: 'inherit' });
    let failed = false;
    child.once('error', (error) => {
      failed = true;
      console.error(error.code === 'ENOENT'
        ? 'pic: tmux was not found on PATH. Install tmux, then run pic again.'
        : 'pic: Could not start tmux: ' + error.message);
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

// Core Compose packages are the default. Pi still owns their settings,
// including individually disabled resources. External Hook changes require consent.
if (command === 'diagnostics') {
  process.exitCode = diagnosticsCli(args.slice(1));
} else if (command === 'version') {
  const p=installedProvenance(root);
  console.log('Pi Compose: '+p.version);
  console.log('Installed Git commit: '+(p.revision||'UNKNOWN — not attestable from this install'));
  console.log('Source Ref: '+(p.ref||'unknown')+' / evidence: '+p.origin);
  console.log('Package root: '+p.packageRoot);
  const bins=installedExecutables();
  if(bins.length>1)console.log('WARNING: More than one pic installation on PATH: '+bins.map(b=>b.command+' -> '+b.path).join(', '));
} else if (command === 'doctor') {
  if (args.length !== 1) { console.error('Usage: pic doctor'); process.exitCode = 2; }
  else process.exitCode = printDoctor(root);
} else if (command === 'setup') {
  if (args.length !== 1) { console.error('Usage: pic setup'); process.exitCode = 2; }
  else process.exitCode = await setupRecommended(root, { runPi, runWorkmux, manual: true });
} else if (command === 'navigation') {
  const [operation, ...extra] = args.slice(1);
  if (!new Set(['enable', 'disable']).has(operation) || extra.length) {
    console.error('Usage: pic navigation enable|disable');
    process.exitCode = 2;
  } else {
    // Explicit opt-in. Pi owns all installed package configuration and removal.
    process.exitCode = await runPi([operation === 'enable' ? 'install' : 'remove', navigationPackage]);
    if (process.exitCode === 0) console.log('pic: Navigation-only Extension ' + (operation === 'enable' ? 'enabled' : 'disabled')
      + '. Restart open child Pi sessions to apply it.');
  }
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
  // Pi flags and noninteractive calls keep their previous behavior. Only bare
  // interactive pic automatically manages tmux; inside tmux never nest it.
  // All installation paths (git SHA, development branch, macOS installer) pass
  // through this same first-run gate. It never runs for flags or scripts.
  if (!command) await maybeOnboard(root, { runPi, runWorkmux });
  process.exitCode = !command && process.stdin.isTTY && process.stdout.isTTY
    && !process.env.TMUX && process.platform !== 'win32'
    ? await runInProjectTmux()
    : await runPi(['--extension', coreExtension, ...args]);
}
