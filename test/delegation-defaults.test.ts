import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DELEGATION, needsSource, proposedBranch } from '../src/delegation-defaults.ts';

test('default delegation keeps exact Pi Fork independent of the Worktree setting', () => {
  assert.deepEqual(DEFAULT_DELEGATION, {context:'fork',workspace:'worktree'});
  assert.equal(needsSource({context:'fork',workspace:'shared'}),true);
  assert.equal(needsSource({context:'independent',workspace:'worktree'}),false);
});

test('branch suggestion requires no Git mutation and handles non-Latin tasks', () => {
  assert.equal(proposedBranch('Profile Display Name','a1b2c3d4'),'feat/profile-display-name-a1b2c3d4');
  assert.equal(proposedBranch('프로필 구현','a1b2c3d4'),'feat/task-a1b2c3d4');
  assert.notEqual(proposedBranch('Same','a1b2c3d4'),proposedBranch('Same','a1b2c3d5'));
  assert.throws(()=>proposedBranch('task','unsafe'), /Invalid branch nonce/);
});
