import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { registerHandoffReady, latestReviewedDraft } from '../extensions/handoff-ready.ts';
import { latestPreparedHandoff } from '../extensions/handoff-candidates.ts';

type Handler = (event: any, ctx: ExtensionContext) => unknown;

function setup(withAskUser = true, withSendReview = false) {
  const handlers = new Map<string, Handler[]>();
  const notifications: string[] = [];
  const messages: any[] = [];
  let sendReviewPromptCount = 0;
  const widgets: string[][] = [];
  const writes: Array<{ kind: string; data: unknown }> = [];
  const workReport = 'Implemented the filter. The implementation is complete. Tests were not run.';
  const entries: any[] = [
    { id: 'identity', type: 'custom', customType: 'compose_agent_identity',
      data: { sessionId: 'work-1', role: 'work', label: 'Filter Work',
        product: 'project-1', workspaceCwd: '/project' } },
    { id: 'user-1', type: 'message', message: {
      role: 'user', content: [{ type: 'text', text: 'Build the filter.' }],
    } },
    { id: 'report-1', type: 'message', message: {
      role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: workReport }],
    } },
  ];
  let leaf = 'report-1';
  let tools = withAskUser ? ['read', 'ask_user', 'intercom'] : ['read', 'intercom'];
  let generated = 0;
  const ctx = {
    mode: 'tui', hasUI: true, model: { id: 'model-1' },
    isIdle: () => true,
    sessionManager: {
      getSessionId: () => 'work-1',
      getLeafId: () => leaf,
      getBranch: () => entries,
      getEntries: () => entries,
    },
    modelRegistry: {
      streamSimple: () => {
        generated++;
        return { result: async () => ({
          stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify({
            outcome: 'reported-complete',
            candidates: [{
              title: 'Filter finished',
              description: 'The Work agent reports completion but tests were not run.',
              kind: 'finding', sourceEntryId: 'report-1',
              quote: 'Tests were not run.',
            }],
          }) }],
        }) };
      },
    },
    ui: {
      setWidget: (_id: string, value?: string[]) => { widgets.push(value ?? []); },
      notify: (message: string) => { notifications.push(message); },
    },
  } as unknown as ExtensionContext;

  const pi = {
    on: (event: string, fn: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), fn]);
      return () => undefined;
    },
    getActiveTools: () => tools,
    setActiveTools: (names: string[]) => { tools = names; },
    appendEntry: (kind: string, data: unknown) => {
      writes.push({ kind, data });
      const id = 'custom-' + writes.length;
      entries.push({ id, type: 'custom', customType: kind, data });
      leaf = id;
    },
    sendMessage: (message: any, options: unknown) => {
      messages.push({ message, options });
    },
  } as unknown as ExtensionAPI;
  const controller = registerHandoffReady(pi, withSendReview
    ? async () => { sendReviewPromptCount++; } : undefined);
  const emit = async (event: string, payload: unknown = {}) => {
    for (const fn of handlers.get(event) ?? []) await fn(payload, ctx);
  };
  const answer = (cancelled = false) => {
    entries.push({ id: 'tool-review', type: 'message', message: {
      role: 'toolResult', toolName: 'ask_user', content: [{ type: 'text', text: 'selected' }],
      details: { cancelled, response: cancelled ? null :
        { kind: 'selection', selections: ['Filter finished'], comment: 'Include test status' } },
    } });
    entries.push({ id: 'assistant-review', type: 'message', message: {
      role: 'assistant', stopReason: 'stop',
      content: [{ type: 'text', text: 'Handoff draft: Filter finished. Tests were not run.' }],
    } });
    leaf = 'assistant-review';
  };
  return { controller, ctx, emit, answer, messages, widgets, notifications,
    writes, getTools: () => tools, getGenerated: () => generated,
    getSendReviewPromptCount: () => sendReviewPromptCount };
}

test('completed Work prepares durable candidates and triggers only the real ask_user tool', async () => {
  const rig = setup();
  await rig.emit('agent_settled', { type: 'agent_settled', aborted: false });
  assert.equal(rig.getGenerated(), 1);
  assert.equal(rig.writes[0]?.kind, 'compose_handoff_candidates');
  assert.equal(latestPreparedHandoff(rig.ctx)?.candidates.length, 1);
  assert.deepEqual(rig.getTools(), ['ask_user'], 'intercom/file tools disabled for review');
  assert.equal(rig.messages.length, 1);
  assert.equal(rig.messages[0]?.message.customType, 'compose_handoff_candidate_review');
  assert.equal(rig.messages[0]?.message.display, false);
  assert.deepEqual(rig.messages[0]?.options, { triggerTurn: true });
  assert.match(rig.messages[0]?.message.content, /allowMultiple:true/);
  assert.ok(rig.notifications.some(text => text.includes('nothing was sent')));
  assert.ok(rig.widgets.some(widget => widget.some(line => line.includes('1개 준비됨'))));

  rig.answer();
  await rig.emit('agent_settled', { type: 'agent_settled', aborted: false });
  assert.deepEqual(rig.getTools(), ['read', 'ask_user', 'intercom']);
  assert.equal(rig.getGenerated(), 1, 'ask_user review settlement is not another completed Work task');
  assert.match(latestReviewedDraft(rig.ctx)?.text ?? '', /Tests were not run/);
});

test('ask_user response automatically opens native Handoff send REVIEW, without requiring <', async () => {
  const rig = setup(true, true);
  await rig.emit('agent_settled', { type: 'agent_settled', aborted: false });
  assert.equal(rig.getSendReviewPromptCount(), 0, 'no send review before user selection');
  rig.answer();
  await rig.emit('agent_settled', { type: 'agent_settled', aborted: false });
  // The UI handoff is deferred to the next microtask, after settlement returns.
  await new Promise<void>(resolve => queueMicrotask(resolve));
  assert.equal(rig.getSendReviewPromptCount(), 1);
  assert.equal(rig.getGenerated(), 1);
});

test('prepared results survive missing ask_user without sending or stealing focus', async () => {
  const rig = setup(false);
  await rig.emit('agent_settled', { type: 'agent_settled', aborted: false });
  assert.ok(latestPreparedHandoff(rig.ctx));
  assert.equal(rig.messages.length, 0);
  rig.controller.openSavedReview(rig.ctx);
  assert.equal(rig.messages.length, 0);
  assert.ok(rig.notifications.some(text => text.includes('pi-ask-user')));
});

test('ask_user cancellation preserves prepared candidates and creates no reviewed draft', async () => {
  const rig = setup();
  await rig.emit('agent_settled', { type: 'agent_settled', aborted: false });
  rig.answer(true);
  await rig.emit('agent_settled', { type: 'agent_settled', aborted: false });
  assert.ok(latestPreparedHandoff(rig.ctx));
  assert.equal(latestReviewedDraft(rig.ctx), undefined);
  assert.equal(rig.messages.length, 1);
});
