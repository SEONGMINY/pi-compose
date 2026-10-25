import test from 'node:test';
import assert from 'node:assert/strict';
import handoffExtension from '../extensions/optional/handoff.ts';
import type { ExtensionAPI, ExtensionCommandContext, ExtensionToolContext } from '@earendil-works/pi-coding-agent';

type ToolInput = {
  summary: string; why: string; checks: string; outstanding: string;
  baseRef?: string; recipient?: string;
};
type ToolOutput = { content: Array<{ type: string; text: string }>; details: { status: string; delivery: string; changedFileCount: number } };
type HandoffTool = { execute: (id: string, input: ToolInput, signal: undefined, update: undefined, ctx: ExtensionToolContext) => Promise<ToolOutput> };
type HandoffCommand = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };

function setup(allowSend = false) {
  let command: HandoffCommand | undefined;
  let tool: HandoffTool | undefined;
  let userMessage = '';
  const invoked: string[] = [];
  const exec = async (bin: string, args: string[]) => {
    invoked.push(bin + ' ' + args.join(' '));
    if (bin === 'workmux') {
      if (!allowSend) throw new Error('External recipient must not be contacted');
      return { code: 0, stdout: '', stderr: '' };
    }
    assert.equal(bin, 'git');
    const command = args.join(' ');
    if (command === 'rev-parse --show-toplevel') return { code: 0, stdout: '/tmp/project\n', stderr: '' };
    if (command === 'rev-parse HEAD') return { code: 0, stdout: 'abc123\n', stderr: '' };
    if (command === 'branch --show-current') return { code: 0, stdout: 'feat/ui\n', stderr: '' };
    if (command.startsWith('diff --cached --name-only')) return { code: 0, stdout: 'src/ui.ts\0', stderr: '' };
    if (command.startsWith('diff --name-only')) return { code: 0, stdout: '', stderr: '' };
    if (command.startsWith('ls-files')) return { code: 0, stdout: 'src/new.ts\0', stderr: '' };
    if (command.includes('--check')) return { code: 0, stdout: '', stderr: '' };
    throw new Error('Unexpected Git command: ' + command);
  };
  handoffExtension({
    exec,
    sendUserMessage: (message: string) => { userMessage = message; },
    registerCommand: (_name: string, value: HandoffCommand) => { command = value; },
    registerTool: (value: HandoffTool) => { tool = value; },
  } as unknown as ExtensionAPI);
  if (!command || !tool) throw new Error('Handoff entry points not registered');
  return { command, tool, invoked, getMessage: () => userMessage };
}
const input: ToolInput = {
  summary: 'UI implemented',
  why: 'NEVER change the original data contract because external clients depend on it.',
  checks: 'Not run',
  outstanding: 'Needs integration check',
};

function context(confirm?: () => Promise<boolean>): ExtensionToolContext {
  return {
    cwd: '/tmp/project',
    hasUI: Boolean(confirm),
    sessionManager: { getSessionFile: () => '/tmp/agent.jsonl' },
    ui: { confirm },
  } as unknown as ExtensionToolContext;
}

test('optional handoff slash command starts only on explicit request and preserves WHY instructions', async () => {
  const fixture = setup();
  await fixture.command.handler('other-project:ui', { hasUI: true } as ExtensionCommandContext);
  assert.match(fixture.getMessage(), /original reasons \(WHY\)/);
  assert.match(fixture.getMessage(), /other-project:ui/);
  assert.deepEqual(fixture.invoked, []);
});

test('handoff reports real changed paths but labels its report unverified; no automatic send', async () => {
  const fixture = setup();
  const result = await fixture.tool.execute('one', input, undefined, undefined, context());
  assert.equal(result.details.status, 'handoff_prepared_not_verified');
  assert.equal(result.details.delivery, 'not_requested');
  assert.equal(result.details.changedFileCount, 2);
  assert.match(result.content[0]?.text ?? '', /NEVER change/);
  assert.match(result.content[0]?.text ?? '', /src\/new.ts/);
  assert.match(result.content[0]?.text ?? '', /untracked=1/);
  assert.ok(!fixture.invoked.some(command => command.startsWith('workmux')));
});

test('sending to another agent requires explicit approval and does not imply receipt', async () => {
  const declined = setup();
  const cancelled = await declined.tool.execute('two', { ...input, recipient: 'other-project:ui' },
    undefined, undefined, context(async () => false));
  assert.equal(cancelled.details.delivery, 'cancelled');
  assert.ok(!declined.invoked.some(command => command.startsWith('workmux')));

  const approved = setup(true);
  const submitted = await approved.tool.execute('three', { ...input, recipient: 'other-project:ui' },
    undefined, undefined, context(async () => true));
  assert.equal(submitted.details.delivery, 'submitted_unverified');
  assert.match(submitted.content[0]?.text ?? '', /Receipt\/read not confirmed/);
  assert.equal(approved.invoked.filter(command => command.startsWith('workmux send ')).length, 1);
});
