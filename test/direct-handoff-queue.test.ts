import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { registerDirectHandoff } from '../extensions/direct-handoff.ts';

type EventHandler = (event: any, ctx: ExtensionContext) => unknown;

function setup() {
  const handlers = new Map<string, EventHandler[]>();
  const notifications: string[] = [];
  const widget: string[] = [];
  const calls: Array<Record<string, unknown>> = [];
  const sessionId = 'work-session-1';
  let idle = false;
  let leafId = 'leaf-before';
  const entries: any[] = [{
    type: 'custom',
    customType: 'compose_agent_identity',
    data: {
      sessionId, role: 'work', product: 'project-a',
      label: 'Work A', workspaceCwd: '/project',
    },
  }];
  const ctx = {
    mode: 'tui',
    hasUI: true,
    isIdle: () => idle,
    sessionManager: {
      getSessionId: () => sessionId,
      getEntries: () => entries,
      getBranch: () => entries,
      getLeafId: () => leafId,
    },
    ui: {
      addAutocompleteProvider: () => undefined,
      setEditorText: () => undefined,
      notify: (text: string) => { notifications.push(text); },
      setWidget: (_key: string, value?: string[]) => {
        widget.splice(0, widget.length, ...(value ?? []));
      },
    },
  } as unknown as ExtensionContext;

  const pi = {
    on(name: string, handler: EventHandler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return () => undefined;
    },
  } as unknown as ExtensionAPI;

  registerDirectHandoff(pi, async (_ctx, options) => {
    calls.push((options ?? {}) as Record<string, unknown>);
  }, async () => new Set<string>());

  const emit = async (name: string, event: unknown = {}) => {
    const result = [];
    for (const handler of handlers.get(name) ?? []) result.push(await handler(event, ctx));
    return result;
  };
  const completeTurn = (aborted = false) => {
    idle = true;
    leafId = 'leaf-after';
    if (!aborted) entries.push({
      type: 'message',
      id: leafId,
      message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Finished' }] },
    });
  };
  return { ctx, calls, widget, notifications, emit, completeTurn };
}

test('busy Work < is consumed without model steering and never auto-delivers', async () => {
  const rig = setup();
  await rig.emit('session_start');
  const result = await rig.emit('input', {
    type: 'input', source: 'interactive', text: '<', streamingBehavior: 'steer',
  });
  assert.deepEqual(result, [{ action: 'handled' }]);
  assert.equal(rig.calls.length, 0);
  assert.match(rig.widget.join(' '), /요청 접수됨/);

  rig.completeTurn();
  await rig.emit('agent_settled', { type: 'agent_settled', aborted: false });
  assert.equal(rig.calls.length, 0, 'agent_settled must not generate/send a handoff');
  assert.match(rig.widget.join(' '), /검토 가능/);

  const reviewed = await rig.emit('input', { type: 'input', source: 'interactive', text: '<' });
  assert.deepEqual(reviewed, [{ action: 'handled' }]);
  assert.equal(rig.calls.length, 1);
  assert.equal(rig.calls[0]?.draft, true);
  assert.equal(rig.calls[0]?.sameProductOnly, true);
  assert.equal(rig.calls[0]?.preferParentMain, true);
});

test('queued explicit recipient survives until review; no send on settle', async () => {
  const rig = setup();
  await rig.emit('session_start');
  await rig.emit('input', {
    type: 'input', source: 'interactive', text: '< @main-session-2',
    streamingBehavior: 'followUp',
  });
  rig.completeTurn();
  await rig.emit('agent_settled', { type: 'agent_settled', aborted: false });
  assert.equal(rig.calls.length, 0);
  await rig.emit('input', { type: 'input', source: 'interactive', text: '<' });
  assert.equal(rig.calls[0]?.recipientQuery, 'main-session-2');
  assert.equal(rig.calls[0]?.preferParentMain, undefined);
});

test('aborted Work turn discards the queued request without pretending completion', async () => {
  const rig = setup();
  await rig.emit('session_start');
  await rig.emit('input', {
    type: 'input', source: 'interactive', text: '<', streamingBehavior: 'steer',
  });
  rig.completeTurn(true);
  await rig.emit('agent_settled', { type: 'agent_settled', aborted: true });
  assert.equal(rig.calls.length, 0);
  assert.match(rig.notifications.join(' '), /without a completed report/);
});
