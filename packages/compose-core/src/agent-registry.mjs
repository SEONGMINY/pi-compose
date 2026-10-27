import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, lstatSync, renameSync, writeFileSync } from 'node:fs';
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
        // Upgrade early ADE sessions without losing their Worktree relationship.
        for (const agent of this.agents) {
          if (!agent.project) {
            const main = agent.relatedMainId
              ? this.agents.find(item => item.id === agent.relatedMainId)
              : null;
            agent.project = main?.project || main?.cwd || agent.cwd;
          }
          if (agent.role === 'main' && !this.projects.includes(agent.project)) {
            this.projects.push(agent.project);
          }
        }
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
      relatedMainId: null, sourceSession: null, workspace: 'shared', pins: [],
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
  activity(id) {
    const item = this.get(id);
    const file = this.observationFile(id);
    if (!existsSync(file)) return null;
    try {
      const state = JSON.parse(readFileSync(file, 'utf8'));
      // Never attribute another Pi conversation's activity to this Agent.
      if (state.sessionId !== item.sessionId || resolve(state.cwd) !== resolve(item.cwd)) return null;
      return {
        phase: ['idle', 'responding', 'tool'].includes(state.phase) ? state.phase : 'unknown',
        tool: typeof state.tool === 'string' ? state.tool.slice(0, 40) : null,
        observedAt: state.observedAt || null,
      };
    } catch { return null; }
  }
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
  markContext(agentId, entryId, category) {
    const agent = this.get(agentId);
    if (agent.role !== 'main') throw new Error('중요한 맥락은 Main Agent에서 표시합니다.');
    if (!['decision', 'constraint'].includes(category)) throw new Error('결정 또는 제약만 표시할 수 있습니다.');
    const path = this.locateSession(agent);
    if (!path) throw new Error('저장된 Pi 대화가 없습니다.');
    const entry = SessionManager.open(path).getBranch().find(item => item.id === entryId);
    if (!entry || entry.type !== 'message' || !['user','assistant'].includes(entry.message?.role)) {
      throw new Error('현재 Main 대화에 없는 기록은 표시할 수 없습니다.');
    }
    agent.pins ||= [];
    const existing = agent.pins.find(item => item.entryId === entryId);
    if (existing) existing.category = category;
    else agent.pins.push({ entryId, category, markedAt: Date.now() });
    this.save();
    return this.context(agentId);
  }
  unmarkContext(agentId, entryId) {
    const agent = this.get(agentId);
    if (agent.role !== 'main') throw new Error('Main Agent의 표시만 변경할 수 있습니다.');
    agent.pins = (agent.pins || []).filter(item => item.entryId !== entryId);
    this.save();
    return this.context(agentId);
  }
  context(id) {
    const agent = this.get(id);
    const path = this.locateSession(agent);
    const records = [];
    let branch = [];
    if (path && existsSync(path)) {
      branch = SessionManager.open(path).getBranch();
      for (const entry of branch) {
        if (entry.type !== 'message') continue;
        const m = entry.message;
        if (!m || !['user','assistant'].includes(m.role)) continue;
        const content = typeof m.content === 'string'
          ? m.content : (m.content || []).filter(p => p.type === 'text').map(p => p.text || '').join('\n');
        if (content.trim()) records.push({ id: entry.id, role: m.role, text: content.slice(0, 5000) });
      }
    }
    const main = agent.role === 'main' ? agent
      : agent.relatedMainId ? this.get(agent.relatedMainId) : null;
    // A pin stores only a Pi entry ID; all displayed content is read again from the original.
    const sourcePath = main ? this.locateSession(main) : null;
    const sourceBranch = sourcePath && existsSync(sourcePath)
      ? SessionManager.open(sourcePath).getBranch() : [];
    const sourceRecords = new Map();
    for (const entry of sourceBranch) {
      if (entry.type !== 'message' || !entry.message) continue;
      const m = entry.message;
      const content = typeof m.content === 'string' ? m.content :
        (m.content || []).filter(p => p.type === 'text').map(p => p.text || '').join('\n');
      sourceRecords.set(entry.id, { role: m.role, text: content.slice(0, 5000) });
    }
    const presentIds = new Set(branch.map(e => e.id));
    const pins = (main?.pins || []).filter(pin => sourceRecords.has(pin.entryId))
      .map(pin => ({
        ...pin, ...sourceRecords.get(pin.entryId),
        includedInAgent: agent.role === 'main' ? true
          : agent.role === 'work' ? presentIds.has(pin.entryId) : false,
      }));
    let fork = null;
    if (agent.role === 'work') {
      let parentMatches = false;
      let inheritedEntryPresent = false;
      let snapshotFound = false;
      if (path && existsSync(path)) {
        try {
          const header = JSON.parse(readFileSync(path, 'utf8').split('\n')[0]);
          parentMatches = header.type === 'session' && resolve(header.parentSession || '') === resolve(agent.sourceSession);
        } catch {}
        inheritedEntryPresent = Boolean(agent.sourceEntryId && presentIds.has(agent.sourceEntryId));
        snapshotFound = Boolean(agent.sourceEntryId && sourceBranch.some(entry => entry.id === agent.sourceEntryId));
      }
      const cut = sourceBranch.findIndex(entry => entry.id === agent.sourceEntryId);
      const sourceAtFork = cut >= 0 ? sourceBranch.slice(0, cut + 1) : [];
      const targetEntries = new Map(branch.map(entry => [entry.id, entry]));
      const matchedCount = sourceAtFork.filter(entry => {
        const match = targetEntries.get(entry.id);
        return match && JSON.stringify(match) === JSON.stringify(entry);
      }).length;
      const completeCopyVerified = sourceAtFork.length > 0 && matchedCount === sourceAtFork.length;
      fork = {
        parentMatches, inheritedEntryPresent, snapshotFound,
        expectedCount: sourceAtFork.length, matchedCount, completeCopyVerified,
        verified: parentMatches && inheritedEntryPresent && snapshotFound && completeCopyVerified,
        sourceSession: agent.sourceSession, sourceEntryId: agent.sourceEntryId,
        explanation: '원본 활성 대화의 분기 시점까지 기록을 실제 Work 세션의 기록과 항목별로 대조합니다. Compaction 이후 모델에 전달된 세부 내용이나 의미 이해까지 보장하지는 않습니다.',
      };
    }
    return {
      agentId: agent.id, title: agent.title, role: agent.role, task: agent.task || null,
      sourceSession: agent.sourceSession, sourceEntryId: agent.sourceEntryId || null,
      sessionFile: path, totalMessages: records.length, messages: records.slice(-50),
      pinned: pins, fork,
      relatedMainTitle: main && agent.role !== 'main' ? main.title : null,
      note: 'Pi의 활성 대화 경로에서 읽은 기록입니다. 표시한 결정은 자동 요약이 아니며 다른 Agent에 자동 전송되지 않습니다.',
    };
  }

  review(id) {
    const item = this.get(id);
    if (!item.baseSha) throw new Error('코드 검토 기준 커밋이 없습니다.');
    const raw = args => execFileSync('git', args, {
      cwd: item.cwd, encoding: 'utf8', maxBuffer: 6 * 1024 * 1024,
    });
    const baseline = item.baseSha;
    const status = raw(['status', '--short']);
    const untracked = raw(['ls-files', '-z', '--others', '--exclude-standard']).split('\0').filter(Boolean);
    const changed = raw(['diff', '--name-status', '-z', baseline]).split('\0').filter(Boolean);
    const files = [];
    for (let i = 0; i < changed.length; ) {
      const kind = changed[i++];
      if (!kind) break;
      const from = changed[i++];
      const path = kind.startsWith('R') || kind.startsWith('C') ? changed[i++] : from;
      if (!path) continue;
      const diff = raw(['diff', '--no-ext-diff', '--no-color', baseline, '--', path]);
      files.push({ path, kind: kind[0], from: from !== path ? from : null,
        diff: diff.slice(0, 190000), untracked: false, preview: null });
      if (files.length >= 300) break;
    }
    for (const path of untracked) {
      if (files.length >= 300) break;
      const full = resolve(item.cwd, path);
      let preview = null;
      try {
        if (full.startsWith(resolve(item.cwd) + '/')) {
          const stat = lstatSync(full);
          if (stat.isFile() && stat.size <= 150000) {
            const data = readFileSync(full);
            if (!data.includes(0)) preview = data.toString('utf8').slice(0, 25000);
          }
        }
      } catch { /* not a safe text preview */ }
      files.push({ path, kind: '?', from: null, diff: '', untracked: true, preview });
    }
    return {
      baseSha: baseline, status, untracked: untracked.join('\n'),
      files, count: files.length, hasMore: files.length >= 300,
      attribution: item.workspace === 'shared'
        ? '공유 폴더의 Git 변경은 해당 Agent만 작성했다고 판단할 수 없습니다.'
        : '이 Worktree의 변경입니다. 완료 및 계약 준수 여부는 별도 검토가 필요합니다.',
    };
  }
}
