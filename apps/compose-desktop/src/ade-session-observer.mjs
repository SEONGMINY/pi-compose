import { writeFileSync } from 'node:fs';

// Observes exact active Pi session identity, never reads or forwards chat content.
export default function adeSessionObserver(pi) {
  pi.on('session_start', (_event, ctx) => {
    const path = process.env.PIC_ADE_OBSERVATION_FILE;
    if (!path) return;
    try {
      writeFileSync(path, JSON.stringify({
        sessionId: ctx.sessionManager.getSessionId(),
        sessionFile: ctx.sessionManager.getSessionFile(),
        cwd: ctx.cwd,
      }), { mode: 0o600 });
    } catch { /* observing must not prevent Pi from starting */ }
  });
}
