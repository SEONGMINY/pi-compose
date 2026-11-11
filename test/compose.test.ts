import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import composeExtension from '../extensions/compose.ts';

function setup() {
  const commands = new Map<string, (args: string, ctx: ExtensionCommandContext) => Promise<void>>();
  const registeredEvents: string[] = [];
  const registeredTools: string[] = [];
  const notifications: string[] = [];
  const api = {
    on(name: string) {
      registeredEvents.push(name);
      return () => undefined;
    },
    events: {
      on: () => () => undefined,
      emit: () => undefined,
    },
    registerCommand(name: string, command: {
      handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    }) {
      commands.set(name, command.handler);
    },
    registerTool(tool: { name: string }) {
      registeredTools.push(tool.name);
    },
  } as unknown as ExtensionAPI;
  composeExtension(api);
  const ctx = {
    hasUI: true,
    ui: { notify: (message: string) => { notifications.push(message); } },
  } as unknown as ExtensionCommandContext;
  return { commands, registeredEvents, registeredTools, notifications, ctx };
}

test('Compose core uses Pi input and lifecycle without exposing autonomous or legacy spawn tools', () => {
  const result = setup();
  assert.deepEqual([...result.commands.keys()], ['compose']);
  assert.deepEqual(result.registeredTools, []);
  assert.ok(result.registeredEvents.includes('input'));
  assert.ok(result.registeredEvents.includes('agent_settled'));
});

test('old tmux/workmux slash commands are not available from the new Core', async () => {
  const result = setup();
  const command = result.commands.get('compose');
  assert.ok(command);
  await command('launch old-tool', result.ctx);
  await command('resume', result.ctx);
  assert.equal(result.notifications.length, 2);
  assert.ok(result.notifications.every(message => message.startsWith('사용법:')));
  assert.ok(result.notifications.every(message =>
    message.includes('Main에서 >w') &&
    message.includes('Work에서 <') &&
    message.includes('Main에서 <')
  ));
  assert.ok(result.notifications.every(message => !message.includes('tmux target')));
  assert.ok(result.notifications.every(message =>
    !message.includes('/compose launch') &&
    !message.includes('/compose resume')
  ));
  // New convenience shortcuts may be added without erasing existing help.
  assert.ok(result.notifications.every(message =>
    message.includes('>r 기존 Work 재개') &&
    message.includes('Work에서 ?p')
  ));
});
