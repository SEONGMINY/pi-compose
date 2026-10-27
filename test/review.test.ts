import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectReview } from '../src/review.ts';

test('review compares actual worktree to approved base without needing Handoff', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pic-review-'));
  t.after(async () => rm(root, {recursive:true,force:true}));
  const git = (...args: string[]) => execFileSync('git', args, {cwd:root,encoding:'utf8'}).trim();
  git('init','-q');
  git('config','user.name','Compose Test');
  git('config','user.email','test@example.invalid');
  await writeFile(join(root,'file.txt'),'original\n');
  git('add','file.txt');
  git('commit','-qm','baseline');
  const base = git('rev-parse','HEAD');
  git('checkout','-qb','feat/review-example');
  await writeFile(join(root,'file.txt'),'changed\n');
  await writeFile(join(root,'untracked.txt'),'new file\n');
  const result = await inspectReview(root,'feat/review-example',base);
  assert.equal(result.base,base);
  assert.match(result.patch,/changed/);
  assert.match(result.changes,/untracked.txt/);
  assert.match(result.stat,/file.txt/);
  assert.equal(result.warning,undefined);
  assert.equal(result.truncated,false);
});

test('review rejects incorrect branch identity and reports missing legacy base', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pic-review-legacy-'));
  t.after(async () => rm(root, {recursive:true,force:true}));
  const git = (...args: string[]) => execFileSync('git', args, {cwd:root,encoding:'utf8'}).trim();
  git('init','-q');
  git('config','user.name','Compose Test');
  git('config','user.email','test@example.invalid');
  await writeFile(join(root,'a'),'a\n');
  git('add','a');
  git('commit','-qm','init');
  git('checkout','-qb','feat/legacy');
  await assert.rejects(inspectReview(root,'feat/wrong'),/branch has changed/);
  const review=await inspectReview(root,'feat/legacy');
  assert.equal(review.base,'HEAD');
  assert.match(review.warning||'',/legacy task/);
});
