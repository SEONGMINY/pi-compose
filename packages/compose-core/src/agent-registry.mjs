import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';

const runGit = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 20_000 }).trim();
const shortName = (task) =>
  task.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'work';

/**
 * Pi JSONL and Git remain the sources of truth. This only persists the ADE's
 * display relationships: a related Support Agent does NOT inherit Main context.
 */
export class AgentRegistry {
  constructor(dataDir) {
    mkdirSync(dataDir, { recursive: true });
    this.path = join(dataDir, 'agents.json');
    this.observationDir = join(dataDir, 'observations');
    mkdirSync(this.observationDir, { recursive: true });
    this.project = null;
    this.projects = [];
    this.agents = [];
    if (existsSync(this.path)) {
      try {
        const saved = JSON.parse(readFileSync(this.path, 'utf8'));
        this.project = saved.project || null;
        this.projects = Array.isArray(saved.projects) ? saved.projects : [];
        if (this.project && !this.projects.includes(this.project)) this.projects.push(this.project);
        this.agents = Array.isArray(saved.agents) ? saved.agents : [];
      } catch { /* damaged display index must not delete Pi sessions */ }
    }
  }
  save() {
    const tmp = this.path + '.tmp';
    writeFileSync(tmp, JSON.stringify({ project: this.project, projects: this.projects, agents: this.agents }, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }
  selectProject(path) {
    const root = resolve(runGit(path, 'rev-parse', '--show-toplevel'));
    if (!this.projects.includes(root)) this.projects.push(root);
    this.project = root;
    this.save();
    return this.list();
  }
  switchProject(path) {
    const root = resolve(path);
    if (!this.projects.includes(root)) throw new Error('등록되지 않은 프로젝트입니다.');
    if (!existsSync(root)) throw new Error('프로젝트 디렉터리가 없습니다. 폴더를 다시 선택하세요.');
    this.project = root;
    this.save();
    return this.list();
  }
  list() {
    return { project: this.project, projects: this.projects, agents: this.agents };
  }
  get(id) {
    const agent = this.agents.find((item) => item.id === id);
    if (!agent) throw new Error('해당 Agent를 찾을 수 없습니다.');
    return agent;
  }
  add(record) {
    this.agents.push(record);
    this.save();
    return record;
  }
  createMain(title) {
    if (!this.project) throw new Error('먼저 Git 프로젝트를 선택하세요.');
    const id = randomUUID();
    return this.add({
      id, role: 'main', title: title?.trim() || '새 메인 대화',
      project: this.project, cwd: this.project, sessionId: randomUUID(), sessionFile: null,
      relatedMainId: null, sourceSession: null, workspace: 'shared',
    });
  }
  locateSession(agent) {
    // Prefer the identity reported by the *actual* Pi TUI (including custom
    // session directories). Never use an arbitrary latest Pi conversation.
    const observation = this.observationFile(agent.id);
    if (existsSync(observation)) {
      try {
        const active = JSON.parse(readFileSync(observation, 'utf8'));
        if (active.sessionId === agent.sessionId && active.sessionFile &&
            existsSync(active.sessionFile) && resolve(active.cwd) === resolve(agent.cwd)) {
          agent.sessionFile = active.sessionFile;
          this.save();
          return active.sessionFile;
        }
      } catch { /* malformed observation is not an authority */ }
    }
    if (agent.sessionFile && existsSync(agent.sessionFile)) return agent.sessionFile;
    const file = SessionManager.findById(agent.cwd, agent.sessionId);
    if (file) {
      agent.sessionFile = file;
      this.save();
    }
    return file || null;
  }
  observationFile(id) { return join(this.observationDir, id + '.json'); }
  assertCurrentMain(main) {
    const observation = this.observationFile(main.id);
    if (!existsSync(observation)) return;
    let active;
    try { active = JSON.parse(readFileSync(observation, 'utf8')); }
    catch { throw new Error('현재 Main의 Pi 세션 출처를 확인할 수 없습니다.'); }
    if (active.sessionId !== main.sessionId || resolve(active.cwd) !== resolve(main.cwd)) {
      throw new Error('Main 터미널에서 다른 Pi 대화로 전환됐습니다. 잘못된 컨텍스트를 Fork하지 않도록 위임을 중단했습니다. 원래 대화로 돌아오거나 ADE에서 별도 Main을 생성하세요.');
    }
  }
  createWork(mainId, task, workspace = 'worktree') {
    const main = this.get(mainId);
    if (main.role !== 'main') throw new Error('Main Agent의 세션만 이어받을 수 있습니다.');
    if (!task?.trim()) throw new Error('작업 지시를 입력하세요.');
    if (!['worktree', 'shared'].includes(workspace)) throw new Error('잘못된 작업 공간입니다.');
    // Never infer a latest session; the exact selected Main must be saved first.
    this.assertCurrentMain(main);
    const source = this.locateSession(main);
    if (!source || !existsSync(source)) {
      throw new Error('Main Agent에서 먼저 Pi 대화를 저장한 뒤 작업을 위임하세요.');
    }
    const id = randomUUID();
    const root = main.project || main.cwd;
    const cwd = workspace === 'worktree'
      ? join(dirname(root), basename(root) + '-compose-' + id.slice(0, 8))
      : main.cwd;
    const branch = workspace === 'worktree'
      ? 'compose/' + shortName(task) + '-' + id.slice(0, 8) : null;
    const baseSha = runGit(root, 'rev-parse', 'HEAD');
    if (workspace === 'worktree') {
      runGit(root, 'worktree', 'add', '-b', branch, cwd, baseSha);
    }
    let manager;
    try {
      manager = SessionManager.forkFrom(source, cwd, undefined, { id: randomUUID() });
    } catch (error) {
      // Never auto-delete a potentially populated checkout on launch failure.
      throw new Error('Fork 실패. 생성된 Git 작업 폴더가 있다면 그대로 보존됩니다: ' + cwd +
        '\n' + (error instanceof Error ? error.message : String(error)));
    }
    const original = SessionManager.open(source);
    const originEntry = original.getLeafEntry();
    return this.add({
      id, role: 'work', project: root, title: task.trim().slice(0, 70), task: task.trim(),
      relatedMainId: main.id, sessionId: manager.getSessionId(),
      sessionFile: manager.getSessionFile(), sourceSession: source,
      sourceEntryId: originEntry?.id || null, context: 'fork',
      cwd, branch, baseSha, workspace,
      initialPromptPending: true,
    });
  }
  createSupport(mainId, task, workspace = 'shared') {
    const main = this.get(mainId);
    if (main.role !== 'main') throw new Error('관련 Main Agent를 선택하세요.');
    if (!task?.trim()) throw new Error('조사 또는 테스트 지시를 입력하세요.');
    if (!['worktree', 'shared'].includes(workspace)) throw new Error('잘못된 작업 공간입니다.');
    const id = randomUUID();
    const root = main.project || main.cwd;
    const cwd = workspace === 'worktree'
      ? join(dirname(root), basename(root) + '-compose-' + id.slice(0, 8))
      : main.cwd;
    const branch = workspace === 'worktree'
      ? 'compose/support-' + id.slice(0, 8) : null;
    const baseSha = runGit(root, 'rev-parse', 'HEAD');
    if (workspace === 'worktree') runGit(root, 'worktree', 'add', '-b', branch, cwd, baseSha);
    return this.add({
      id, role: 'support', project: root, title: task.trim().slice(0, 70),
      task: task.trim(), relatedMainId: main.id, sessionId: randomUUID(),
      sessionFile: null, sourceSession: null, sourceEntryId: null,
      context: 'independent', cwd, branch, baseSha, workspace,
      initialPromptPending: true,
    });
  }
  launchConfig(id) {
    const item = this.get(id);
    const path = this.locateSession(item);
    // Pi --session-id can create the exact chosen ID without a forged message.
    // Work Agent uses --session on the already forked on-disk JSONL.
    const args = path ? ['--session', path] : ['--session-id', item.sessionId];
    // New sessions default to Luna. Resumed/Forked sessions retain their own model selection.
    if (!path) args.push('--model', 'gpt-5.6-luna');
    if (item.initialPromptPending && item.task) args.push('--', item.task);
    return { cwd: item.cwd, args };
  }
  markLaunched(id) {
    const item = this.get(id);
    item.initialPromptPending = false;
    this.save();
  }
  context(id) {
    const agent = this.get(id);
    const path = this.locateSession(agent);
    const records = [];
    if (path && existsSync(path)) {
      // Pi's recorded active branch, not a generated or speculative summary.
      const manager = SessionManager.open(path);
      for (const entry of manager.getBranch()) {
        if (entry.type !== 'message') continue;
        const m = entry.message;
        if (!m || !['user', 'assistant'].includes(m.role)) continue;
        const text = typeof m.content === 'string'
          ? m.content
          : (m.content || []).filter(part => part.type === 'text')
            .map(part => part.text || '').join('\n');
        if (text.trim()) records.push({ role: m.role, text: text.slice(0, 3000) });
      }
    }
    return {
      title: agent.title, role: agent.role, task: agent.task || null,
      sourceSession: agent.sourceSession, sourceEntryId: agent.sourceEntryId || null,
      sessionFile: path, totalMessages: records.length, messages: records.slice(-30),
      relatedMainTitle: agent.relatedMainId ? this.get(agent.relatedMainId).title : null,
      note: 'Pi 세션의 실제 대화 발췌입니다. 자동으로 핵심 결정이라고 판단하거나 다른 Agent에 전달하지 않습니다.',
    };
  }
  review(id) {
    const item = this.get(id);
    if (!item.baseSha) throw new Error('코드 검토 기준 커밋이 없습니다.');
    const diff = execFileSync('git', ['diff', '--no-ext-diff', '--no-color', item.baseSha], {
      cwd: item.cwd, encoding: 'utf8', maxBuffer: 3 * 1024 * 1024,
    });
    return {
      baseSha: item.baseSha, diff: diff.slice(0, 180_000),
      status: runGit(item.cwd, 'status', '--short'),
      untracked: runGit(item.cwd, 'ls-files', '--others', '--exclude-standard'),
    };
  }
}
