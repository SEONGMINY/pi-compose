import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSetup } from '../bin/setup.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('setup inspection reads only Pi settings and identifies existing packages and workmux Hook', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pic-setup-status-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });
  const initial = inspectSetup(repoRoot);
  assert.deepEqual(initial.packages, { navigation: 'missing', features: 'missing' });
  assert.equal(initial.hook, 'not-detected');
  const original = JSON.stringify({
    theme: 'my-personal-theme',
    packages: [
      join(repoRoot, 'packages', 'navigation'),
      { source: join(repoRoot, 'packages', 'optional'), extensions: ['extensions/handoff.ts'] },
      'npm:my-other-package',
    ],
    skills: ['~/my-skills'],
  });
  await writeFile(join(dir, 'settings.json'), original);
  await mkdir(join(dir, 'extensions'));
  await writeFile(join(dir, 'extensions', 'workmux-status.ts'), '// provided by workmux');
  const state = inspectSetup(repoRoot);
  assert.equal(state.packages.navigation, 'configured');
  assert.equal(state.packages.features, 'custom');
  assert.equal(state.hook, 'detected');
  assert.equal(await readFile(join(dir, 'settings.json'), 'utf8'), original,
    'inspection must not rewrite unrelated extensions, themes or skills');
});

test('malformed existing Pi settings disable automated setup instead of overwriting them', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pic-setup-invalid-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });
  await writeFile(join(dir, 'settings.json'), '{ broken json');
  const state = inspectSetup(repoRoot);
  assert.equal(state.settingsOk, false);
  assert.equal(state.packages.navigation, 'unknown');
  assert.equal(await readFile(join(dir, 'settings.json'), 'utf8'), '{ broken json');
});

test('project-only configuration is not mistaken for a missing global package', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pic-local-package-'));
  const project = join(dir, 'project');
  const agentDir = join(dir, 'agent');
  await mkdir(join(project, '.pi'), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousCwd = process.cwd();
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.chdir(project);
  t.after(async () => {
    process.chdir(previousCwd);
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  const before = JSON.stringify({
    theme: 'custom',
    packages: [join(repoRoot, 'packages/navigation')],
  });
  await writeFile(join(project, '.pi', 'settings.json'), before);
  const state = inspectSetup(repoRoot);
  assert.equal(state.packages.navigation, 'project-only');
  assert.equal(state.packages.features, 'missing');
  assert.equal(await readFile(join(project, '.pi', 'settings.json'), 'utf8'), before);
});
