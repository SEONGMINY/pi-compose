import test from 'node:test';
import assert from 'node:assert/strict';
import verifier from '../extensions/optional/verify.ts';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';

type Command = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };
const readTools = ['read,grep,find,ls'];
function prepare() {
  let command: Command | undefined;
  const calls: Array<{ binary: string; args: string[] }> = [];
  const messages: string[] = [];
  const notices: string[] = [];
  const exec = async (binary: string, args: string[]) => {
    calls.push({ binary, args });
    if (binary === 'pi') return { code: 0, stdout: '결론: 확인한 범위에서 중요한 문제 없음. 미검증: 원래 사용자 지시.', stderr: '' };
    assert.equal(binary, 'git');
    const all = args.join(' ');
    if (all === 'rev-parse --show-toplevel') return { code: 0, stdout: '/tmp/repo\n', stderr: '' };
    if (all === 'rev-parse HEAD') return { code: 0, stdout: 'abc123\n', stderr: '' };
    if (all === 'status --porcelain=v1 -z --untracked-files=all') return { code: 0, stdout: '?? new.ts\0', stderr: '' };
    if (all === 'diff --check' || all === 'diff --cached --check') return { code: 0, stdout: '', stderr: '' };
    if (all === 'diff --cached --name-only -z') return { code: 0, stdout: 'src/changed.ts\0', stderr: '' };
    if (all === 'diff --name-only -z') return { code: 0, stdout: '', stderr: '' };
    if (all === 'ls-files --others --exclude-standard -z') return { code: 0, stdout: 'new.ts\0', stderr: '' };
    if (all === 'diff --cached --no-ext-diff --no-color') return { code: 0, stdout: 'diff --git a/src/changed.ts b/src/changed.ts\n+something\n', stderr: '' };
    if (all === 'diff --no-ext-diff --no-color') return { code: 0, stdout: '', stderr: '' };
    throw new Error('Unexpected git invocation ' + all);
  };
  verifier({
    registerCommand: (_name: string, registered: Command) => { command = registered; },
    sendMessage: ({ content }: { content: string }) => { messages.push(content); },
    exec,
  } as unknown as ExtensionAPI);
  if (!command) throw new Error('Missing compose-verify command');
  const ctx = (approve: boolean) => ({
    cwd: '/tmp/repo', hasUI: true,
    ui: {
      confirm: async () => approve,
      notify: (msg: string) => { notices.push(msg); },
    },
  } as unknown as ExtensionCommandContext);
  return { command, calls, messages, notices, ctx };
}

test('verification requires a real user confirmation and never auto-spawns an agent', async () => {
  const v = prepare();
  await v.command.handler('', v.ctx(false));
  assert.ok(v.calls.some(call => call.binary === 'git'));
  assert.equal(v.calls.filter(call => call.binary === 'pi').length, 0);
  assert.deepEqual(v.messages, []);
});

test('approved verification runs a separate read-only, non-persistent Pi with no Extensions or MCP', async () => {
  const v = prepare();
  await v.command.handler('', v.ctx(true));
  const invocations = v.calls.filter(call => call.binary === 'pi');
  assert.equal(invocations.length, 1);
  const args = invocations[0]?.args ?? [];
  assert.deepEqual(args.slice(0, 7), [
    '--print', '--no-session', '--no-extensions', '--no-mcp',
    '--tools', readTools[0], '--',
  ]);
  assert.match(args[7] ?? '', /Untracked file contents are NOT in the patch/);
  assert.match(args[7] ?? '', /new.ts/);
  assert.match(args[7] ?? '', /original WHY unavailable/);
  assert.ok(!args.includes('bash'));
  assert.ok(!args.includes('edit'));
  assert.ok(!args.includes('write'));
  assert.match(v.messages[0] ?? '', /NOT an approval or integration/);
});

test('missing interactive UI prevents even evidence inspection or model execution', async () => {
  const v = prepare();
  await v.command.handler('', {
    cwd: '/tmp/repo', hasUI: false,
    ui: { notify: (msg: string) => { v.notices.push(msg); } },
  } as unknown as ExtensionCommandContext);
  assert.equal(v.calls.length, 0);
  assert.match(v.notices[0] ?? '', /confirmation is required/);
});
