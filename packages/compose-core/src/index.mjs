import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 20000 }).trim();
const textOf = (message) => {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  return (message.content || []).filter((part) => part.type === 'text').map((part) => part.text || '').join('\n');
};
const messagesOf = (session) => (session.state.messages || [])
  .filter((message) => message.role === 'user' || message.role === 'assistant')
  .map((message) => ({ role: message.role, text: textOf(message) }));
const safeError = (error) => error instanceof Error ? error.message : String(error);
const shortTask = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'task';

export class ComposeCore extends EventEmitter {
  constructor({ dataDir }) {
    super();
    this.dataDir = dataDir;
    this.registryFile = join(dataDir, 'ade-sessions.json');
    this.agents = new Map();
    this.project = null;
    this.saved = { project: null, sessions: [] };
    mkdirSync(dataDir, { recursive: true });
    if (existsSync(this.registryFile)) {
      try {
        const saved = JSON.parse(readFileSync(this.registryFile, 'utf8'));
        if (Array.isArray(saved.sessions)) this.saved = saved;
      } catch { /* The ADE can start without a corrupted view registry. */ }
    }
    this.project = this.saved.project;
  }

  snapshot() {
    return {
      project: this.project,
      sessions: [...this.agents.values()].map((item) => ({
        id: item.id, role: item.role, title: item.title,
        parentId: item.parentId || null, cwd: item.cwd, branch: item.branch || null,
        status: item.status, error: item.error || null,
        sessionFile: item.session.sessionFile || null,
        messages: messagesOf(item.session),
        stream: item.stream, activity: item.activity.slice(-60),
        task: item.task || null,
      })),
    };
  }
  notify() { this.emit('change', this.snapshot()); }
  persist() {
    const index = {
      project: this.project,
      sessions: [...this.agents.values()].map((item) => ({
        id: item.id, role: item.role, title: item.title, parentId: item.parentId || null,
        cwd: item.cwd, branch: item.branch || null, task: item.task || null,
        sessionFile: item.session.sessionFile || null,
      })),
    };
    writeFileSync(this.registryFile, JSON.stringify(index, null, 2), { mode: 0o600 });
    this.saved = index;
  }
  openProject(path) {
    const cwd = resolve(path);
    if (!existsSync(cwd)) throw new Error('Project directory does not exist.');
    const root = git(cwd, 'rev-parse', '--show-toplevel');
    this.project = resolve(root);
    this.persist();
    this.notify();
    return this.snapshot();
  }
  async restore() {
    const previous = [...this.saved.sessions];
    for (const record of previous) {
      try {
        if (!record.sessionFile || !existsSync(record.sessionFile) || !existsSync(record.cwd)) continue;
        const manager = SessionManager.open(record.sessionFile, undefined, record.cwd);
        await this.attach({ ...record, manager, status: 'stopped' });
      } catch (error) {
        this.emit('notice', { type: 'restore-error', title: record.title, message: safeError(error) });
      }
    }
    this.notify();
  }
  async attach({ id = randomUUID(), role, title, parentId, cwd, branch, task, manager, status = 'idle' }) {
    const { session } = await createAgentSession({ cwd, sessionManager: manager });
    const item = { id, role, title, parentId, cwd, branch, task, session,
      status, error: null, stream: '', activity: [], busy: false };
    this.agents.set(id, item);
    item.unsubscribe = session.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        item.stream += event.assistantMessageEvent.delta || '';
        this.notify();
      } else if (event.type === 'tool_execution_start') {
        item.activity.push('▶ ' + (event.toolName || 'tool'));
        this.notify();
      } else if (event.type === 'tool_execution_end') {
        item.activity.push((event.isError ? '✕ ' : '✓ ') + (event.toolName || 'tool'));
        this.notify();
      } else if (event.type === 'message_end') {
        item.stream = '';
        this.notify();
      }
    });
    this.persist();
    this.notify();
    return item;
  }
  async createMain(title = 'New Main') {
    if (!this.project) throw new Error('Open a Git project first.');
    const manager = SessionManager.create(this.project);
    const item = await this.attach({ role: 'main', title: title.trim() || 'New Main',
      cwd: this.project, manager });
    return item.id;
  }
  async createChild(mainId, task) {
    const main = this.agents.get(mainId);
    if (!main || main.role !== 'main') throw new Error('Select an exact Main conversation.');
    if (main.busy) throw new Error('Wait for the Main reply before forking this conversation.');
    if (!task?.trim()) throw new Error('A development task is required.');
    const parentFile = main.session.sessionFile;
    if (!parentFile || !existsSync(parentFile)) {
      throw new Error('The Main conversation must contain at least one saved message before it can be forked.');
    }
    const root = git(main.cwd, 'rev-parse', '--show-toplevel');
    const id = randomUUID();
    const branch = 'compose/' + shortTask(task) + '-' + id.slice(0, 8);
    const cwd = join(dirname(root), basename(root) + '-compose-' + id.slice(0, 8));
    // Git owns the checkout. On later Pi errors retain the worktree: never destroy user changes.
    git(root, 'worktree', 'add', '-b', branch, cwd, 'HEAD');
    const manager = SessionManager.forkFrom(parentFile, cwd);
    const item = await this.attach({ id, role: 'child', title: task.trim().slice(0, 72),
      parentId: mainId, cwd, branch, task: task.trim(), manager });
    // First development instruction is sent to the fork, not inserted into Main.
    this.send(item.id, task.trim());
    return item.id;
  }
  send(id, prompt) {
    const item = this.agents.get(id);
    if (!item) throw new Error('Session not found.');
    if (!prompt?.trim()) throw new Error('Message is empty.');
    if (item.busy) throw new Error('Agent is already responding.');
    item.busy = true;
    item.status = 'running';
    item.error = null;
    item.stream = '';
    this.notify();
    // Deliberately return immediately so the renderer can observe the run as it streams.
    void item.session.prompt(prompt.trim()).then(() => {
      item.status = item.role === 'child' ? 'reviewable' : 'idle';
    }).catch((error) => {
      item.error = safeError(error);
      item.status = 'error';
      this.emit('notice', { type: 'agent-error', id: item.id, title: item.title, message: item.error });
    }).finally(() => {
      item.busy = false;
      item.stream = '';
      this.persist();
      this.notify();
    });
    this.notify();
  }
  async stop(id) {
    const item = this.agents.get(id);
    if (!item) return;
    if (item.busy) await item.session.abort();
    item.busy = false;
    item.status = 'stopped';
    this.notify();
  }
  review(id) {
    const item = this.agents.get(id);
    if (!item || item.role !== 'child') throw new Error('Choose a Child worktree.');
    if (!existsSync(item.cwd)) throw new Error('Worktree directory is missing.');
    const base = git(item.cwd, 'merge-base', 'HEAD', item.branch ? 'HEAD' : 'HEAD');
    const tracked = execFileSync('git', ['diff', '--no-ext-diff', '--no-color', base], {
      cwd: item.cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    });
    const untracked = git(item.cwd, 'ls-files', '--others', '--exclude-standard');
    const committed = git(item.cwd, 'log', '--oneline', 'HEAD', '-10');
    const dirty = git(item.cwd, 'status', '--short');
    return { diff: tracked.slice(0, 160000), untracked, committed, dirty,
      note: 'Diff is relative to the original worktree HEAD; untracked files are listed separately. No merge performed.' };
  }
  async shutdown() {
    for (const item of this.agents.values()) {
      try {
        if (item.busy) await item.session.abort();
        item.unsubscribe?.();
        item.session.dispose();
      } catch (error) {
        this.emit('notice', { type: 'stop-error', id: item.id, title: item.title, message: safeError(error) });
      }
      item.status = 'stopped';
    }
    this.persist();
  }
}
