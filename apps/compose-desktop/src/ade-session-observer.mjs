import { writeFileSync } from 'node:fs';

// Read-only Pi TUI observer. No transcript, tool arguments, or result body leaves
// its owning session: only session identity and lifecycle state are exposed.
export default function adeSessionObserver(pi) {
  const path = process.env.PIC_ADE_OBSERVATION_FILE;
  let state = { sessionId: null, sessionFile: null, cwd: null, phase: 'unknown',
    tool: null, observedAt: 0 };
  const persist = () => {
    if (!path) return;
    try { writeFileSync(path, JSON.stringify(state), { mode: 0o600 }); }
    catch { /* Observability cannot block Pi or change its context. */ }
  };
  pi.on('session_start', (_event, ctx) => {
    state = { sessionId: ctx.sessionManager.getSessionId(),
      sessionFile: ctx.sessionManager.getSessionFile(), cwd: ctx.cwd,
      phase: 'idle', tool: null, observedAt: Date.now() };
    persist();
  });
  pi.on('agent_start', () => {
    state = { ...state, phase: 'responding', tool: null, observedAt: Date.now() };
    persist();
  });
  pi.on('tool_execution_start', event => {
    state = { ...state, phase: 'tool', tool: event.toolName || 'tool', observedAt: Date.now() };
    persist();
  });
  pi.on('tool_execution_end', () => {
    state = { ...state, phase: 'responding', tool: null, observedAt: Date.now() };
    persist();
  });
  pi.on('agent_end', () => {
    state = { ...state, phase: 'idle', tool: null, observedAt: Date.now() };
    persist();
  });
}
