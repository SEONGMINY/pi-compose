import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pic = fileURLToPath(new URL('../bin/pic.mjs', import.meta.url));
type ObservedPi = {
  args: string[];
  cwd: string;
  bootstrap: string | null;
  overview: string | null;
};

test('bare pic starts a fresh identified Main; -r resumes without inventing identity', t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-compose-pic-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const project = join(root, 'project');
  mkdirSync(bin);
  mkdirSync(project);
  const capture = join(root, 'capture.json');

  // Replace only the external pi executable: inspect the real launcher
  // arguments and environment without starting a model or Ghostty.
  writeFileSync(join(bin, 'pi'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.PI_CAPTURE_FILE, JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  bootstrap: process.env.PI_COMPOSE_AGENT_BOOTSTRAP_V1 || null,
  overview: process.env.PI_COMPOSE_OVERVIEW_TERMINAL_ID || null,
}));
`, { mode: 0o755 });

  const invoke = (args: string[]): ObservedPi => {
    const run = spawnSync(process.execPath, [pic, ...args], {
      cwd: project,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: bin + ':' + (process.env.PATH ?? ''),
        PI_CAPTURE_FILE: capture,
        PI_COMPOSE_AGENT_BOOTSTRAP_V1: 'inherited-foreign-session',
        PI_COMPOSE_OVERVIEW_TERMINAL_ID: 'inherited-sidebar',
      },
      timeout: 10_000,
    });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(readFileSync(capture, 'utf8')) as ObservedPi;
  };

  const a = invoke([]);
  const b = invoke([]);
  assert.equal(a.cwd, realpathSync(project));
  assert.equal(a.overview, null);
  assert.ok(a.bootstrap);
  assert.ok(b.bootstrap);
  const mainA = JSON.parse(Buffer.from(a.bootstrap, 'base64url').toString('utf8'));
  const mainB = JSON.parse(Buffer.from(b.bootstrap, 'base64url').toString('utf8'));
  assert.equal(mainA.role, 'main');
  assert.equal(mainA.product, mainB.product);
  assert.notEqual(mainA.sessionId, mainB.sessionId);
  assert.deepEqual(a.args.slice(-2), ['--session-id', mainA.sessionId]);
  assert.equal(a.args[0], '--extension');

  const resumed = invoke(['-r']);
  assert.equal(resumed.bootstrap, null);
  assert.equal(resumed.overview, null);
  assert.equal(resumed.args.at(-1), '-r');
  assert.equal(resumed.args[0], '--extension');
});
