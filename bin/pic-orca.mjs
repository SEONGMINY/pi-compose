#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = resolve(root, 'extensions/orca-compose.ts');
const pi = process.env.PI_COMPOSE_PI_BINARY || 'pi';
const args = ['--extension', extension, ...process.argv.slice(2)];

// Pi owns provider authentication, model choice, session JSONL and tools.
// This executable only loads commands which manage provenance externally.
const child = spawn(pi, args, { cwd: process.cwd(), env: process.env, stdio: 'inherit', shell: false });
child.on('error', error => {
  console.error('Pi 실행 실패: ' + (error.code === 'ENOENT' ? 'pi 명령이 PATH에 없습니다.' : error.message));
  process.exitCode = error.code === 'ENOENT' ? 127 : 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 128 + (constants.signals[signal] || 1) : (code ?? 1);
});
