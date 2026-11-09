import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  prepareWorkHandoffCandidates, latestPreparedHandoff, CANDIDATE_ENTRY,
} from '../extensions/handoff-candidates.ts';

function fixture(outcome: 'reported-complete' | 'in-progress' | 'blocked' | 'unclear' = 'reported-complete',
  quote = 'The profile filter implementation is complete.') {
  const report = 'The profile filter implementation is complete. Tests were not run.';
  const branch: any[] = [
    { id: 'user-1', type: 'message', message: {
      role: 'user', content: [{ type: 'text', text: 'Implement a profile filter without touching payments.' }],
    } },
    { id: 'report-1', type: 'message', message: {
      role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: report }],
    } },
  ];
  let leaf = 'report-1';
  let response = {
    outcome, candidates: outcome === 'reported-complete'
      ? [{ title: 'Profile filter implemented', kind: 'finding',
        description: 'Reported complete, but tests were not run. Do not infer a passed test.',
        sourceEntryId: 'report-1', quote }] : [],
  };
  const ctx = {
    mode: 'tui',
    model: { id: 'test-model' },
    sessionManager: {
      getSessionId: () => 'work-1',
      getLeafId: () => leaf,
      getBranch: () => branch,
    },
    modelRegistry: {
      streamSimple: () => ({ result: async () => ({
        stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(response) }],
      }) }),
    },
  } as unknown as ExtensionContext;
  return {
    ctx, branch,
    persist(data: unknown) { branch.push({ id: 'saved-1', type: 'custom', customType: CANDIDATE_ENTRY, data }); leaf = 'saved-1'; },
    moveLeaf() { leaf = 'changed-branch'; },
    setResponse(value: typeof response) { response = value; },
  };
}

test('complete Work report yields source-backed candidates ready for durable storage', async () => {
  const env = fixture();
  const result = await prepareWorkHandoffCandidates(env.ctx);
  assert.equal(result.status, 'prepared');
  if (result.status !== 'prepared') return;
  assert.equal(result.draft.reportEntryId, 'report-1');
  assert.equal(result.draft.sourceLeafId, 'report-1');
  assert.equal(result.draft.candidates[0]?.sourceEntryId, 'report-1');
  env.persist(result.draft);
  assert.equal(latestPreparedHandoff(env.ctx)?.candidates.length, 1);
  assert.equal((await prepareWorkHandoffCandidates(env.ctx)).status, 'already-prepared');
});

test('mere settled turn, blocked progress and unclear reports do not generate completed Work candidates', async () => {
  for (const state of ['in-progress', 'blocked', 'unclear'] as const) {
    const env = fixture(state);
    assert.equal((await prepareWorkHandoffCandidates(env.ctx)).status, 'not-complete');
  }
});

test('reported-complete Work with no shareable candidates is still recognized as finished', async () => {
  const env = fixture();
  env.setResponse({ outcome: 'reported-complete', candidates: [] });
  assert.equal((await prepareWorkHandoffCandidates(env.ctx)).status, 'complete-no-candidates');
});

test('fabricated evidence is rejected instead of persisted', async () => {
  const env = fixture('reported-complete', 'Tests passed in CI');
  const result = await prepareWorkHandoffCandidates(env.ctx);
  assert.equal(result.status, 'failed');
  assert.equal(latestPreparedHandoff(env.ctx), undefined);
});

test('a changed Pi leaf invalidates a prepared snapshot', async () => {
  const env = fixture();
  env.setResponse({ outcome: 'reported-complete', candidates: [{
    title: 'Done', kind: 'finding', description: 'Reported completion, not independently verified',
    sourceEntryId: 'report-1', quote: 'The profile filter implementation is complete.',
  }] });
  // This validates the stale guard via the separate model result hook.
  const original = (env.ctx.modelRegistry as any).streamSimple;
  (env.ctx.modelRegistry as any).streamSimple = (...args: unknown[]) => {
    const stream = original(...args);
    return { result: async () => {
      env.moveLeaf();
      return stream.result();
    } };
  };
  assert.equal((await prepareWorkHandoffCandidates(env.ctx)).status, 'stale');
});
