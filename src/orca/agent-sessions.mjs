import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { captureCompletedMain, forkCompletedMain } from './completed-main-fork.mjs';

const STATE_DIR = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'pi-compose', 'orca');
const q = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const runGit = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', timeout: 20_000,
}).trim();
// A linked Git Worktree has its own --show-toplevel, but shares Git's
// common dir with the primary checkout. Context is grouped by repository.
function projectRootOf(cwd) {
  const common = resolve(cwd, runGit(cwd, 'rev-parse', '--git-common-dir'));
  return basename(common) === '.git' ? dirname(common)
    : runGit(cwd, 'rev-parse', '--show-toplevel');
}

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
    const projectRoot = projectRootOf(cwd);
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
    // The Main may still be writing its last JSONL entry. Its completed
    // conversation is validated by captureCompletedMain(), which tolerates
    // only an unfinished trailing line without changing the source file.
    if (main.sessionFile !== resolve(file)) {
      main.sessionFile = resolve(file);
      atomicJSON(this.path(main.id), main);
    }
    return main;
  }
  registerExistingMain({cwd, sessionFile, sessionId, title, launcherPath}) {
    const main = this.registerMain({cwd,sessionFile,sessionId,title});
    if (main.launcher && existsSync(main.launcher)) return main;
    const scriptPath = join(this.launchersDir, sessionId + '.sh');
    const command = [q(launcherPath.piBinary || 'pi'),
      '--extension', q(resolve(launcherPath.extension)),
      '--session', q(resolve(sessionFile))].join(' ');
    if (!existsSync(scriptPath)) {
      writeFileSync(scriptPath, '#!/bin/sh\ncd ' + q(resolve(cwd)) +
        '\nexec ' + command + '\n', { mode: 0o700, flag: 'wx' });
    } else {
      const actual=readFileSync(scriptPath,'utf8');
      if (!actual.includes(q(resolve(sessionFile)))) {
        throw new Error('기존 Main 실행 파일이 다른 Pi 세션을 가리킵니다. 덮어쓰지 않습니다.');
      }
    }
    main.launcher=scriptPath;
    atomicJSON(this.path(main.id),main);
    return main;
  }
  registerMain({ cwd, sessionFile, sessionId, title }) {
    if (!sessionFile || !existsSync(sessionFile)) {
      throw new Error('Main 대화를 Pi에 먼저 저장하세요. 빈 대화는 Fork 출처가 될 수 없습니다.');
    }
    const sourceFile = resolve(sessionFile);
    const header = headerOf(sourceFile);
    if (header.id !== sessionId) throw new Error('현재 Main Pi 세션의 ID와 파일이 일치하지 않습니다.');
    const root = projectRootOf(cwd);
    const id = 'main-' + sessionId;
    const existing = this.get(id);
    if (existing) {
      if (existing.role !== 'main' || (existing.sessionFile && existing.sessionFile !== sourceFile) ||
          existing.projectRoot !== root) throw new Error('Main 세션 식별자 충돌입니다.');
      if (!existing.sessionFile) {
        existing.sessionFile=sourceFile;
        atomicJSON(this.path(existing.id),existing);
      }
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
  /**
   * Prepare an independent Pi session WITHOUT sending a task prompt.
   * Work inherits exactly the selected Main's last finished branch point.
   * Support has an independent context; relatedWorkId is a UI/result link.
   */
  prepare({ role, main, title, task, workspace, SessionManager, projectCwd,
    launcherPath, relatedWorkId = null, activeLeafId }) {
    if (!['work','support'].includes(role)) throw new Error('Work 또는 Support만 만들 수 있습니다.');
    if (!['shared','worktree'].includes(workspace)) throw new Error('잘못된 작업 공간입니다.');
    if (!main || main.role !== 'main' || !this.get(main.id)) {
      throw new Error('등록된 Main에서만 작업을 시작할 수 있습니다.');
    }
    const root = projectRootOf(main.projectRoot);
    if (root !== main.projectRoot) throw new Error('Git 프로젝트 정체성이 변경됐습니다.');
    if (relatedWorkId !== null) {
      const linked = this.get(relatedWorkId);
      if (role !== 'support' || !linked || linked.role !== 'work' ||
          linked.parentMainId !== main.id || linked.projectRoot !== root) {
        throw new Error('Support의 연결 대상은 동일한 Main에 속한 Work여야 합니다.');
      }
    }
    const id = randomUUID();
    const branch = workspace === 'worktree'
      ? 'compose/' + role + '-' + id.slice(0, 8) : null;
    const cwd = workspace === 'worktree'
      ? join(dirname(root), basename(root) + '-compose-' + id.slice(0, 8))
      : resolve(projectCwd || main.cwd);
    const selectedCwd = resolve(projectCwd || main.cwd);
    if (projectRootOf(selectedCwd) !== root) {
      throw new Error('선택한 작업 디렉터리는 Main과 같은 Git 프로젝트여야 합니다.');
    }
    const baseSha = runGit(selectedCwd, 'rev-parse', 'HEAD');
    const sourceFile = role === 'work'
      ? this.mainWithSavedSession(main.id, SessionManager).sessionFile : null;
    // Capture the source BEFORE mutating Git. Main's original JSONL is read-only.
    const snapshot = role === 'work'
      ? captureCompletedMain({
          sessionFile: sourceFile, sessionId: main.sessionId, activeLeafId
        }) : null;
    if (workspace === 'worktree') {
      // Never overwrite an existing checkout. Orca registration remains a
      // separate host operation; do not imply the workspace already exists in Orca.
      runGit(root, 'worktree', 'add', '-b', branch, cwd, baseSha);
    }

    let sessionId;
    let sessionFile = null;
    if (snapshot) {
      try {
        const fork = forkCompletedMain({ snapshot, targetCwd: cwd, id, SessionManager });
        sessionId = fork.sessionId;
        sessionFile = fork.sessionFile;
      } catch (error) {
        throw new Error('Work Fork 실패. 기존 Main과 만들어진 Worktree는 보존됩니다: ' +
          (error instanceof Error ? error.message : String(error)));
      }
    } else {
      sessionId = id; // Pi creates its independent session on the first real message.
    }
    const scriptPath = join(this.launchersDir, id + '.sh');
    const args = ['--extension', resolve(launcherPath.extension),
      ...(snapshot ? ['--session', sessionFile] : ['--session-id', sessionId])];
    const command = [q(launcherPath.piBinary || 'pi'), ...args.map(q)].join(' ');
    // This launch only opens an existing/fresh session. Never auto-submit an
    // initial development instruction; each Work starts when the user types.
    writeFileSync(scriptPath, '#!/bin/sh\ncd ' + q(cwd) + '\nexec ' + command + '\n',
      { mode: 0o700, flag: 'wx' });
    chmodSync(scriptPath, 0o700);

    const label = (title || task || (role === 'work' ? '새 Work' : '새 Support')).trim();
    return this.put({
      id, role, title: label.slice(0, 100),
      ...(typeof task === 'string' && task.trim() ? { task: task.trim() } : {}),
      parentMainId: main.id,
      ...(relatedWorkId ? { relatedWorkId } : {}),
      projectRoot: root, cwd, workspace, branch, baseSha,
      sourceSessionFile: sourceFile, sourceSessionId: snapshot?.sourceSessionId || null,
      sourceEntryId: snapshot?.sourceEntryId || null,
      sourceEntryIds: snapshot?.sourceEntryIds || [],
      sourceEntryCount: snapshot?.entries.length || 0,
      excludedInProgress: snapshot?.excludedInProgress || false,
      sessionId, sessionFile,
      launcher: scriptPath, state: 'prepared', createdAt: new Date().toISOString(),
    });
  }
  prepareForMain({ mainId, role, title, task, workspace, relatedWorkId,
    activeLeafId, SessionManager, launcherPath, projectCwd }) {
    const main = this.get(mainId);
    if (!main || main.role !== 'main') throw new Error('등록된 Main을 선택하세요.');
    return this.prepare({ main, role, title, task, workspace, relatedWorkId,
      activeLeafId, SessionManager, projectCwd: projectCwd || main.cwd,
      launcherPath });
  }
  verifyCopiedEntries({ sourceFile, sessionFile, sourceEntryCount,
    sourceEntryIds, sourceEntryId }) {
    if (!sourceFile || !sessionFile || !existsSync(sessionFile) || !existsSync(sourceFile)) {
      return { allMatch: false, copied: 0, expected: sourceEntryCount || 0 };
    }
    const original = readEntries(sourceFile).filter(entry => entry.type !== 'session');
    const selected = sourceEntryIds?.length
      ? sourceEntryIds.map(id => original.find(entry => entry.id === id))
      : original.slice(0, sourceEntryCount);
    const targetRows = readEntries(sessionFile);
    const header = targetRows[0];
    const target = targetRows.filter(entry => entry.type !== 'session');
    const copied = selected.filter((entry, index) =>
      entry && JSON.stringify(entry) === JSON.stringify(target[index])).length;
    const expected = selected.length;
    const leafMatches = !sourceEntryId || target.at(-1)?.id === sourceEntryId;
    const allMatch = resolve(header?.parentSession || '') === resolve(sourceFile) &&
      leafMatches && copied === expected && target.length === expected;
    return { allMatch, copied, expected, leafMatches };
  }
  supportResult({ id, SessionManager }) {
    const support = this.get(id);
    if (!support || support.role !== 'support') {
      throw new Error('결과를 확인할 Support Agent가 없습니다.');
    }
    const file = support.sessionFile && existsSync(support.sessionFile)
      ? support.sessionFile
      : SessionManager.findById(support.cwd, support.sessionId);
    if (!file || !existsSync(file) || headerOf(file).id !== support.sessionId) {
      throw new Error('Support 대화가 아직 저장되지 않았습니다. 실제 작업을 수행한 뒤 결과를 확인하세요.');
    }
    const branch = SessionManager.open(file).getBranch();
    const finished = branch.filter(entry =>
      entry.type === 'message' &&
      entry.message?.role === 'assistant' &&
      entry.message?.stopReason === 'stop' &&
      entry.message?.endTurn !== false).at(-1);
    if (!finished) throw new Error('Support의 완료된 응답을 아직 찾지 못했습니다.');
    const text = (finished.message.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text).join('\n').trim();
    if (!text) throw new Error('Support의 최신 완료 응답에 전달할 텍스트가 없습니다.');
    return {
      supportId: support.id, supportTitle: support.title,
      relatedWorkId: support.relatedWorkId || null,
      sessionId: support.sessionId, sessionFile: resolve(file),
      observedAt: finished.timestamp, entryId: finished.id,
      text: text.slice(0, 12000),
      truncated: text.length > 12000
    };
  }
  markConnectionFailed({ id, message }) {
    const record = this.get(id);
    if (!record || record.role !== 'work') throw new Error('Work Agent를 찾을 수 없습니다.');
    if (record.state === 'ready') return record;
    record.state = 'connection-error';
    record.connectionError = String(message || 'Native Chat 연결 실패').slice(0, 500);
    atomicJSON(this.path(id), record);
    return record;
  }
  attachNativeChat({ id, orcaSessionId, worktreeId }) {
    const record = this.get(id);
    if (!record || record.role !== 'work') {
      throw new Error('검증된 Work Agent에만 기존 Pi 세션을 연결할 수 있습니다.');
    }
    if (!/^pi_[A-Za-z0-9_]{8,120}$/.test(orcaSessionId) ||
        typeof worktreeId !== 'string' || !worktreeId.trim() || worktreeId.length > 512) {
      throw new Error('Orca Native Chat 식별자가 올바르지 않습니다.');
    }
    if (record.orcaSessionId && record.orcaSessionId !== orcaSessionId) {
      throw new Error('이미 연결된 Native Chat을 중복 생성하지 않습니다.');
    }
    record.orcaSessionId = orcaSessionId;
    record.orcaWorktreeId = worktreeId;
    record.state = 'ready';
    delete record.connectionError;
    atomicJSON(this.path(record.id), record);
    return record;
  }
  attachTerminal({ id, tabId, worktreeId }) {
    const record = this.get(id);
    if (!record) throw new Error('연결할 Agent가 없습니다.');
    if (typeof tabId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(tabId) ||
        typeof worktreeId !== 'string' || !worktreeId.trim() || worktreeId.length > 512) {
      throw new Error('잘못된 Orca 터미널 식별자입니다.');
    }
    record.orcaTabId = tabId;
    record.orcaWorktreeId = worktreeId;
    atomicJSON(this.path(record.id),record);
    return record;
  }
  inspect(id) {
    const record = this.get(id);
    if (!record) throw new Error('Agent를 찾을 수 없습니다.');
    if (record.role !== 'work') return { record, fork: null };
    return { record, fork: this.verifyCopiedEntries({
      sourceFile: record.sourceSessionFile, sessionFile: record.sessionFile,
      sourceEntryCount: record.sourceEntryCount,
      sourceEntryIds: record.sourceEntryIds,
      sourceEntryId: record.sourceEntryId,
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
