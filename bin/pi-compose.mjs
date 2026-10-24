#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { executeLaunch, planLaunch } from '../src/launch.mjs';

const help = `Usage:
  pi-compose launch --task "Implement member API" --context fork|independent \
    --workspace shared|worktree --cwd /path/to/repo \
    [--source-session-file /path/to/main.jsonl] [--branch feat/member-api] \
    [--base HEAD] [--dry-run]

A launch is always an explicit user action. --dry-run prints the planned command without running it.
No package installation, merge or cleanup is performed by this command.`;

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command === 'help' || command === '--help' || !command) { console.log(help); return; }
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

main().catch(error => { console.error(`pi-compose: ${error.message}`); process.exitCode = 1; });
