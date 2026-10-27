import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const STATE_DIR = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'pi-compose', 'orca');
const q = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const runGit = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', timeout: 20_000,
}).trim();

function readEntries(path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}
function headerOf(path) {
  const header = readEntries(path)[0];
  if (!header || header.type !== 'session' || !header.id) throw new Error('유효한 Pi 세션 JSONL이 아닙니다: ' + path);
  return header;
}
function atomicJSON(path, data) {
  const tmp = path + '.' + randomUUID() + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(tmp, path);
}
export function stateDir() { return process.env.PI_COMPOSE_STATE_DIR || STATE_DIR; }

export class OrcaAgentStore {
  constructor(root = stateDir()) {
    this.root = resolve(root);
    this.recordsDir = join(this.root, 'agents');
    this.launchersDir = join(this.root, 'launchers');
    mkdirSync(this.recordsDir, { recursive: true, mode: 0o700 });
    mkdirSync(this.launchersDir, { recursive: true, mode: 0o700 });
  }
  path(id) {
    if (!/^(main-)?[a-f0-9-]{36}$/.test(id)) throw new Error('잘못된 Agent 식별자입니다.');
    return join(this.recordsDir, id + '.json');
  }
  get(id) {
    const path = this.path(id);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  }
  put(record) {
    const path = this.path(record.id);
    if (existsSync(path)) throw new Error('기존 Agent 정보를 덮어쓰지 않습니다.');
    atomicJSON(path, record);
    return record;
  }
  list() {
    return readdirSync(this.recordsDir).filter(name => name.endsWith('.json'))
      .map(name => {
        try { return JSON.parse(readFileSync(join(this.recordsDir, name), 'utf8')); }
        catch { return null; }
      }).filter(Boolean).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  }
  /**
   * Native Orca action can open a Main without requiring /compose-main.
   * Pi creates the actual JSONL after the first conversation message.
   * The UUID is pinned BEFORE launch so an arbitrary recent session is never used.
   */
  createMain({ cwd, title, launcherPath }) {
    const projectRoot = runGit(cwd, 'rev-parse', '--show-toplevel');
    const sessionId = randomUUID();
    const id = 'main-' + sessionId;
    const scriptPath = join(this.launchersDir, sessionId + '.sh');
    const command = [
      q(launcherPath.piBinary || 'pi'), '--extension', q(resolve(launcherPath.extension)),
      '--session-id', q(sessionId),
    ].join(' ');
    writeFileSync(scriptPath, '#!/bin/sh\ncd ' + q(resolve(cwd)) + '\nexec ' + command + '\n',
      { mode: 0o700, flag: 'wx' });
    return this.put({
      id, role: 'main', title: (title || '').trim() || basename(projectRoot),
      projectRoot, cwd: resolve(cwd), sessionId, sessionFile: null,
      launcher: scriptPath, state: 'prepared', createdAt: new Date().toISOString(),
    });
  }
  mainWithSavedSession(id, SessionManager) {
    const main = this.get(id);
    if (!main || main.role !== 'main') throw new Error('등록된 Main Agent를 선택하세요.');
    // Do not allow a stale Main file from another repo or another Pi session.
    const file = main.sessionFile && existsSync(main.sessionFile) ? main.sessionFile
      : SessionManager.findById(main.cwd, main.sessionId);
    if (!file || !existsSync(file)) {
      throw new Error('이 Main에서 먼저 Pi와 설계를 논의해 저장한 뒤 Work Agent를 만드세요.');
    }
    if (headerOf(file).id !== main.sessionId) throw new Error('Pi 세션 정본 식별자가 다릅니다.');
    const source = SessionManager.open(file);
    if (!source.getBranch().some(entry => entry.type === 'message')) {
      throw new Error('Main에 아직 실제 대화가 없습니다. 설계를 먼저 논의하세요.');
    }
    if (main.sessionFile !== resolve(file)) {
      main.sessionFile = resolve(file);
      atomicJSON(this.path(main.id), main);
    }
    return main;
  }
  registerMain({ cwd, sessionFile, sessionId, title }) {
    if (!sessionFile || !existsSync(sessionFile)) {
      throw new Error('Main 대화를 Pi에 먼저 저장하세요. 빈 대화는 Fork 출처가 될 수 없습니다.');
    }
    const sourceFile = resolve(sessionFile);
    const header = headerOf(sourceFile);
    if (header.id !== sessionId) throw new Error('현재 Main Pi 세션의 ID와 파일이 일치하지 않습니다.');
    const root = runGit(cwd, 'rev-parse', '--show-toplevel');
    const id = 'main-' + sessionId;
    const existing = this.get(id);
    if (existing) {
      if (existing.role !== 'main' || existing.sessionFile !== sourceFile ||
          existing.projectRoot !== root) throw new Error('Main 세션 식별자 충돌입니다.');
      return existing;
    }
    return this.put({
      id, role: 'main', title: title.trim() || basename(root),
      projectRoot: root, cwd: resolve(cwd), sessionId, sessionFile: sourceFile,
      createdAt: new Date().toISOString(),
    });
  }
  selectedMain({ sessionId, sessionFile, cwd }) {
    const main = this.get('main-' + sessionId);
    if (!main) throw new Error('먼저 이 Pi 대화에서 /compose-main 명령을 실행하세요.');
    if (!sessionFile || resolve(sessionFile) !== main.sessionFile ||
        resolve(cwd) !== main.cwd) {
      throw new Error('현재 Pi 대화가 등록된 Main 세션과 다릅니다. 다른 대화를 임의로 Fork하지 않습니다.');
    }
    return main;
  }

  /**
   * Context choice and Git workspace choice are independent.
   * This method PREPARES a child, but never claims to run an Agent in Orca.
   */
  prepare({ role, main, task, workspace, SessionManager, projectCwd, launcherPath }) {
    if (!['work','support'].includes(role)) throw new Error('Work 또는 Support만 만들 수 있습니다.');
    if (!['shared','worktree'].includes(workspace)) throw new Error('잘못된 작업 공간입니다.');
    if (typeof task !== 'string' || !task.trim()) throw new Error('실제 작업 지시를 입력하세요.');
    if (!main || main.role !== 'main' || !this.get(main.id)) {
      throw new Error('등록된 Main에서만 작업을 시작할 수 있습니다.');
    }
    const root = runGit(main.projectRoot, 'rev-parse', '--show-toplevel');
    if (root !== main.projectRoot) throw new Error('Git 프로젝트 정체성이 변경됐습니다.');
    const id = randomUUID();
    const branch = workspace === 'worktree'
      ? 'compose/' + role + '-' + id.slice(0, 8) : null;
    const cwd = workspace === 'worktree'
      ? join(dirname(root), basename(root) + '-compose-' + id.slice(0, 8))
      : resolve(projectCwd || main.cwd);
    const baseSha = runGit(root, 'rev-parse', 'HEAD');
    const sourceFile = role === 'work' ? this.mainWithSavedSession(main.id, SessionManager).sessionFile : null;
    let sourceEntryId = null;
    let sourceEntryCount = 0;

    if (role === 'work') {
      // Inspect the exact selected Main Pi JSONL, not the most recent session.
      if (!existsSync(sourceFile)) throw new Error('원본 Main Pi 세션을 찾을 수 없습니다.');
      const header = headerOf(sourceFile);
      if (header.id !== main.sessionId) throw new Error('원본 Main Pi 세션 식별자가 바뀌었습니다.');
      const source = SessionManager.open(sourceFile);
      sourceEntryId = source.getLeafEntry()?.id || null;
      sourceEntryCount = readEntries(sourceFile).filter(e => e.type !== 'session').length;
    }
    if (workspace === 'worktree') {
      // Existing worktree/branch is never overwritten; no automatic clean/reset.
      runGit(root, 'worktree', 'add', '-b', branch, cwd, baseSha);
    }

    let sessionId;
    let sessionFile = null;
    if (role === 'work') {
      try {
        const fork = SessionManager.forkFrom(sourceFile, cwd, undefined, { id });
        sessionId = fork.getSessionId();
        sessionFile = fork.getSessionFile();
        const proof = this.verifyCopiedEntries({ sourceFile, sessionFile, sourceEntryCount });
        if (!proof.allMatch) throw new Error('원본 Pi 대화의 전체 복제가 확인되지 않았습니다.');
      } catch (error) {
        throw new Error('Work Fork 실패. 이미 생성된 Worktree와 Pi 파일은 보존됩니다: ' +
          (error instanceof Error ? error.message : String(error)));
      }
    } else {
      sessionId = id; // Pi will create its own new JSONL at its FIRST user message.
    }
    const scriptPath = join(this.launchersDir, id + '.sh');
    const args = ['--extension', resolve(launcherPath.extension)];
    if (role === 'work') args.push('--session', sessionFile);
    else args.push('--session-id', sessionId);
    args.push('--', task.trim());
    const command = [q(launcherPath.piBinary || 'pi'), ...args.map(q)].join(' ');
    const resumeArgs = ['--extension', resolve(launcherPath.extension),
      ...(role === 'work' ? ['--session', sessionFile] : ['--session-id', sessionId])];
    const resumeCommand = [q(launcherPath.piBinary || 'pi'), ...resumeArgs.map(q)].join(' ');
    const firstLaunchMarker = join(this.launchersDir, id + '.started');
    // Atomic one-shot claim: reopening a crashed tab NEVER resubmits the original
    // development request. Session files / Git worktrees are always preserved.
    const script = '#!/bin/sh\ncd ' + q(cwd) +
      '\nif mkdir ' + q(firstLaunchMarker) + ' 2>/dev/null; then\n  exec ' +
      command + '\nelif [ -d ' + q(firstLaunchMarker) + ' ]; then\n  exec ' +
      resumeCommand + '\nelse\n  echo ' + q('Pi Compose: launch marker unavailable') +
      ' >&2\n  exit 1\nfi\n';
    writeFileSync(scriptPath, script, { mode: 0o700, flag: 'wx' });
    chmodSync(scriptPath, 0o700);

    return this.put({
      id, role, title: task.trim().slice(0, 100), task: task.trim(),
      parentMainId: main.id, projectRoot: root, cwd, workspace, branch, baseSha,
      sourceSessionFile: sourceFile, sourceSessionId: role === 'work' ? main.sessionId : null,
      sourceEntryId, sourceEntryCount, sessionId, sessionFile,
      launcher: scriptPath, state: 'prepared', createdAt: new Date().toISOString(),
    });
  }
  prepareForMain({ mainId, role, task, workspace, SessionManager, launcherPath }) {
    const main = this.get(mainId);
    if (!main || main.role !== 'main') throw new Error('등록된 Main을 선택하세요.');
    return this.prepare({ main, role, task, workspace, SessionManager,
      projectCwd: main.cwd, launcherPath });
  }
  verifyCopiedEntries({ sourceFile, sessionFile, sourceEntryCount }) {
    if (!sourceFile || !sessionFile || !existsSync(sessionFile)) {
      return { allMatch: false, copied: 0, expected: sourceEntryCount || 0 };
    }
    const source = readEntries(sourceFile).filter(e => e.type !== 'session').slice(0, sourceEntryCount);
    const targetRows = readEntries(sessionFile);
    const header = targetRows[0];
    const target = targetRows.filter(e => e.type !== 'session').slice(0, sourceEntryCount);
    const copied = source.filter((e,i) => JSON.stringify(e) === JSON.stringify(target[i])).length;
    const allMatch = resolve(header?.parentSession || '') === resolve(sourceFile) &&
      copied === sourceEntryCount && target.length === sourceEntryCount;
    return { allMatch, copied, expected: sourceEntryCount };
  }
  inspect(id) {
    const record = this.get(id);
    if (!record) throw new Error('Agent를 찾을 수 없습니다.');
    if (record.role !== 'work') return { record, fork: null };
    return { record, fork: this.verifyCopiedEntries({
      sourceFile: record.sourceSessionFile, sessionFile: record.sessionFile,
      sourceEntryCount: record.sourceEntryCount,
    }) };
  }
}

export function displayLaunch(record) {
  return [
    record.role === 'work' ? 'Work Agent 준비됨 (Main의 Pi 대화 Fork 복제)' :
      'Support Agent 준비됨 (새로운 독립 Pi 대화)',
    '원본 Main: ' + record.parentMainId,
    '작업 폴더: ' + record.cwd,
    'Orca에서 새 터미널을 열고 다음 명령을 실행하세요:',
    'sh ' + q(record.launcher),
    '※ 실행 전 상태는 준비됨입니다. 위 명령을 실행하기 전까지 실행 중이라고 표시하지 않습니다.',
  ].join('\n');
}
