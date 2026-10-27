#!/usr/bin/env node
/**
 * Model-free, isolated ADE fork smoke test for Pi v1.4.0.
 * Run from pi-compose after npm install: node scripts/ade-fork-smoke.mjs
 * Does not touch the user's existing Pi sessions or working tree.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';

const root = mkdtempSync(join(tmpdir(), 'pic-ade-smoke-'));
const repo = join(root, 'repo');
const worktree = join(root, 'child-worktree');
const mainSessions = join(root, 'pi-main-sessions');
const childSessions = join(root, 'pi-child-sessions');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const userMessage = text => ({
  role: 'user',
  content: [{ type: 'text', text }],
  timestamp: Date.now(),
});

try {
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '--quiet', '--initial-branch=main');
  writeFileSync(join(repo, 'README.md'), 'Original checkout\n');
  git(repo, 'add', 'README.md');
  git(repo, '-c', 'user.name=Pi Compose Spike', '-c', 'user.email=spike@example.invalid', 'commit', '--quiet', '-m', 'seed');
  git(repo, 'worktree', 'add', '--quiet', '-b', 'spike/child', worktree);

  const source = SessionManager.create(repo, mainSessions);
  const contract = 'Earlier clients depend on name; NEVER remove name. Keep backwards compatibility.';
  source.appendMessage(userMessage(contract));
  const sourcePath = source.getSessionFile();
  assert(sourcePath, 'Pi source session file must exist');
  const sourceBefore = readFileSync(sourcePath, 'utf8');
  const sourceEntries = source.getBranch();
  assert(sourceEntries.length > 0, 'source Main must have a persisted conversation');

  // Real Pi SessionManager: exact source, independent Git checkout and cwd.
  const child = SessionManager.forkFrom(sourcePath, worktree, childSessions);
  const childPath = child.getSessionFile();
  assert(childPath && childPath !== sourcePath, 'Child must have its own session file');
  assert.notEqual(child.getSessionId(), source.getSessionId());

  const [header, ...forkedEntries] = readFileSync(childPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const [, ...originalEntries] = sourceBefore.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(header.type, 'session');
  assert.equal(resolve(header.parentSession), resolve(sourcePath), 'exact Main lineage');
  assert.equal(resolve(header.cwd), resolve(worktree), 'Child worktree cwd');
  assert.deepEqual(forkedEntries, originalEntries, 'full saved Main entries copied without summary');
  assert.deepEqual(child.getBranch(), sourceEntries, 'active branch must match selected Main context');

  child.appendMessage(userMessage('Implement the feature in the child checkout.'));
  writeFileSync(join(worktree, 'README.md'), 'Modified in child only\n');
  assert.equal(readFileSync(sourcePath, 'utf8'), sourceBefore, 'Main transcript must not change');
  assert.equal(readFileSync(join(repo, 'README.md'), 'utf8'), 'Original checkout\n', 'Main checkout unchanged');
  assert.match(git(worktree, 'status', '--porcelain'), /README\.md/, 'Child Git change observed');
  assert.equal(git(repo, 'status', '--porcelain'), '', 'Main Git checkout remains clean');

  console.log('PASS: exact Main session fork; lineage; conversation copy; isolated Child writes; isolated Git worktree.');
  console.log('NOT TESTED: model comprehension, prompt delivery, events, macOS lifecycle or notifications.');
} finally {
  // Every file is owned by this temporary fixture; never delete user resources.
  rmSync(root, { recursive: true, force: true });
}
