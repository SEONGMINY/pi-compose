#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOrcaOverlay } from './orca-native-overlay.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const orcaDir = resolve(process.env.PI_COMPOSE_ORCA_DIR || join(root, '.cache', 'orca-upstream-context-first'));
const binDir = join(root, '.cache', 'orca-bin');
// Pin real Orca upstream: 2026-10-27, rather than accidentally following breaking changes.
const pinned = '4a39d186da72a496b29a9ec5c523bbbf0a3460d8';
const revision = process.env.PI_COMPOSE_ORCA_REV || pinned;
const cmd = process.argv[2] || 'prepare';

function run(exe, args, cwd = root, env = process.env) {
  const child = spawnSync(exe, args, { cwd, env, stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(exe + ' 실패 (exit ' + child.status + ')');
}
function output(exe, args, cwd) {
  const child = spawnSync(exe, args, { cwd, encoding: 'utf8' });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(exe + ' 실행 오류: ' + child.stderr);
  return child.stdout.trim();
}
function check() {
  if (!process.platform.startsWith('darwin')) {
    console.warn('Orca 데스크톱 실행은 우선 macOS에서 검증합니다.');
  }
  if (Number(process.versions.node.split('.')[0]) < 24) {
    throw new Error('Orca upstream 개발 환경에는 Node.js 24 이상이 필요합니다. 현재: ' + process.version);
  }
}
function prepare() {
  check();
  mkdirSync(dirname(orcaDir), { recursive: true });
  if (!existsSync(join(orcaDir, '.git'))) {
    if (existsSync(orcaDir)) throw new Error('기존 폴더가 Git Orca 저장소가 아닙니다. 삭제하지 않고 중단합니다: ' + orcaDir);
    run('git', ['clone', '--filter=blob:none', '--depth', '1', '--no-checkout',
      'https://github.com/stablyai/orca.git', orcaDir]);
    run('git', ['fetch', '--depth', '1', 'origin', revision], orcaDir);
    run('git', ['-c', 'advice.detachedHead=false', 'checkout', '--detach', revision], orcaDir);
  }
  const origin = output('git', ['remote', 'get-url', 'origin'], orcaDir);
  if (!/^https:\/\/github\.com\/stablyai\/orca(\.git)?$/.test(origin) &&
      !/^git@github\.com:stablyai\/orca\.git$/.test(origin)) {
    throw new Error('Orca upstream 원본 저장소가 아닙니다: ' + origin);
  }
  const sha = output('git', ['rev-parse', 'HEAD'], orcaDir);
  if (sha !== revision) {
    throw new Error('Orca 버전이 고정 커밋과 다릅니다. 기존 변경을 덮어쓰지 않습니다.\n' +
      '예상: ' + revision + '\n현재: ' + sha);
  }
  mkdirSync(binDir, { recursive: true });
  const link = join(binDir, 'pic-orca');
  const wrapper = '#!/bin/sh\nexec ' + "'node'" + ' ' +
    "'" + resolve(root, 'bin/pic-orca.mjs').replaceAll("'", "'\\''") + "'" + ' "$@"\n';
  if (!existsSync(link)) {
    writeFileSync(link, wrapper, { mode: 0o755, flag: 'wx' });
  } else if (readFileSync(link, 'utf8') !== wrapper) {
    throw new Error('기존 pic-orca 실행 파일을 덮어쓰지 않습니다: ' + link);
  }
  applyOrcaOverlay(orcaDir, root);
  console.log('\nOrca 원본 체크아웃:', orcaDir);
  console.log('Orca commit:', sha);
  console.log('Pi Compose 확장 명령: pic-orca\n');
}
try {
  if (!['prepare', 'dev', 'info'].includes(cmd)) {
    throw new Error('사용법: node scripts/orca-upstream.mjs [prepare|dev|info]');
  }
  if (cmd === 'info') {
    console.log('Orca upstream: https://github.com/stablyai/orca');
    console.log('commit: ' + revision);
    console.log('directory: ' + orcaDir);
  } else {
    prepare();
    if (cmd === 'dev') {
      console.log('Orca 원본 UI에 Pi Compose Agent 생성 메뉴를 연결했습니다.');
      const env = { ...process.env, PI_COMPOSE_ROOT: root, PATH: binDir + ':' + process.env.PATH };
      if (!existsSync(join(orcaDir, 'node_modules'))) run('pnpm', ['install'], orcaDir, env);
      run('pnpm', ['dev'], orcaDir, env);
    }
  }
} catch (error) {
  console.error('Pi Compose Orca 실행 준비 실패: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
