import pty from 'node-pty';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_SCROLLBACK_BYTES = 220_000;

// Actual PTYs, never fake chat transcripts. Each Pi session owns its context.
export class TerminalProcesses {
  constructor(registry, changed, stream) {
    this.registry = registry;
    this.changed = changed;
    this.stream = stream;
    this.processes = new Map();
    this.seqCounters = new Map();
    this.exits = new Map();
  }
  status(id) { return this.processes.has(id) ? 'running' : 'stopped'; }
  snapshot() {
    const state = this.registry.list();
    return { ...state, agents: state.agents.map(a => ({
      ...a,
      sessionFile: a.sessionFile || null, processStatus: this.status(a.id),
      activity: this.registry.activity(a.id),
    })) };
  }
  start(id) {
    this.registry.get(id);
    const existing = this.processes.get(id);
    if (existing) return { seq: existing.seq, buffer: existing.buffer, running: true };
    if (this.exits.get(id) === 'stopping') throw new Error('이전 터미널이 종료 중입니다.');
    const { cwd, args } = this.registry.launchConfig(id);
    const observationFile = this.registry.observationFile(id);
    const observer = join(dirname(fileURLToPath(import.meta.url)), 'ade-session-observer.mjs');
    const promptIndex = args.indexOf('--');
    const fullArgs = [...args];
    fullArgs.splice(promptIndex < 0 ? fullArgs.length : promptIndex, 0, '--extension', observer);
    // node-pty runs the real interactive Pi TUI. No shell command interpolation.
    let child;
    try {
      child = pty.spawn(process.env.PIC_PI_BIN || 'pi', fullArgs, {
        name: 'xterm-256color', cols: 110, rows: 32, cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor',
          PIC_ADE_OBSERVATION_FILE: observationFile },
      });
    } catch (error) {
      throw new Error('Pi 실행 실패. PATH에서 pi 명령을 확인하세요: ' +
        (error instanceof Error ? error.message : String(error)));
    }
    const entry = { process: child, seq: this.seqCounters.get(id) || 0, buffer: '' };
    this.processes.set(id, entry);
    this.exits.delete(id);
    // Never replay the initial task after a crash without user action.
    this.registry.markLaunched(id);
    child.onData(data => {
      entry.seq += 1;
      this.seqCounters.set(id, entry.seq);
      entry.buffer = (entry.buffer + data).slice(-MAX_SCROLLBACK_BYTES);
      this.stream({ id, seq: entry.seq, data });
    });
    child.onExit(({ exitCode, signal }) => {
      if (this.processes.get(id) === entry) this.processes.delete(id);
      this.exits.set(id, 'exited');
      this.stream({ id, exit: true, code: exitCode, signal });
      this.changed();
    });
    this.changed();
    return { seq: entry.seq, buffer: entry.buffer, running: true };
  }
  attach(id) {
    this.registry.get(id);
    const item = this.processes.get(id);
    return item
      ? { seq: item.seq, buffer: item.buffer, running: true }
      : { seq: this.seqCounters.get(id) || 0, buffer: '', running: false };
  }
  write(id, data) {
    const item = this.processes.get(id);
    if (!item) throw new Error('실행 중인 터미널이 아닙니다.');
    item.process.write(data);
  }
  resize(id, cols, rows) {
    const item = this.processes.get(id);
    if (item && cols >= 2 && rows >= 2) item.process.resize(cols, rows);
  }
  stop(id) {
    const item = this.processes.get(id);
    if (!item) return;
    this.exits.set(id, 'stopping');
    item.process.kill('SIGTERM');
  }
  stopAll() {
    for (const id of this.processes.keys()) this.stop(id);
  }
  runningCount() { return this.processes.size; }
}
