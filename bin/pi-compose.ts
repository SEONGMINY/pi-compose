#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { executeLaunch, planLaunch } from '../src/launch.ts';
import { openDashboard } from '../src/dashboard.ts';
import { inspectWorktree, planResume, executeResume } from '../src/resume.ts';

const help = `Usage:
  pi-compose dashboard [--session] [--tab agents|worktrees]
  pi-compose inspect --cwd /path/to/repo --branch feat/member-api
  pi-compose resume --workspace shared|worktree --session-file /path/to/agent.jsonl \\
    [--cwd /path/to/repo] [--branch feat/member-api] [--tmux-target tmux-name] [--dry-run]
  pi-compose launch --task "Implement member API" --context fork|independent \
    --workspace shared|worktree --cwd /path/to/repo \
    [--source-session-file /path/to/main.jsonl] [--branch feat/member-api] \
    [--base HEAD] [--dry-run]

Launch and resume are explicit user actions. inspect and --dry-run never create sessions or Worktrees.
No package installation, merge or cleanup is performed by this command.`;

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  if (command === 'help' || command === '--help' || !command) { console.log(help); return; }
  if (command === 'dashboard') {
    const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
      session: { type: 'boolean' }, tab: { type: 'string' },
    } });
    if (values.tab && values.tab !== 'agents' && values.tab !== 'worktrees') {
      throw new Error('--tab must be agents|worktrees');
    }
    await openDashboard({ sessionOnly: values.session, tab: values.tab as 'agents' | 'worktrees' | undefined });
    return;
  }
  if (command === 'inspect') {
    const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
      cwd: { type: 'string' }, branch: { type: 'string' },
    } });
    console.log(JSON.stringify(await inspectWorktree({ cwd: values.cwd, branch: values.branch }), null, 2));
    return;
  }
  if (command === 'resume') {
    const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
      workspace: { type: 'string' }, cwd: { type: 'string' },
      'session-file': { type: 'string' }, branch: { type: 'string' },
      'tmux-target': { type: 'string' }, 'dry-run': { type: 'boolean' },
    } });
    const plan = await planResume({
      workspace: values.workspace, cwd: values.cwd, sessionFile: values['session-file'],
      branch: values.branch, tmuxTarget: values['tmux-target'],
    });
    if (values['dry-run']) {
      console.log(JSON.stringify({ mode: 'dry-run', plan }, null, 2));
      return;
    }
    console.log(JSON.stringify(await executeResume(plan), null, 2));
    return;
  }
  if (command !== 'launch') throw new Error(`Unknown command: ${command}\n${help}`);
  const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
    task: { type: 'string' }, context: { type: 'string' }, workspace: { type: 'string' },
    cwd: { type: 'string' }, 'source-session-file': { type: 'string' },
    branch: { type: 'string' }, base: { type: 'string' }, 'dry-run': { type: 'boolean' },
  }});
  const plan = await planLaunch({ task: values.task, context: values.context,
    workspace: values.workspace, cwd: values.cwd,
    sourceSessionFile: values['source-session-file'], branch: values.branch, base: values.base });
  if (values['dry-run']) {
    console.log(JSON.stringify({ mode: 'dry-run', plan }, null, 2)); return;
  }
  console.log(JSON.stringify(await executeLaunch(plan), null, 2));
}

main().catch((error: unknown) => {
  console.error(`pi-compose: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
