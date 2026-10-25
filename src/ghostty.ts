import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/** An optional presentation adapter: never creates, forks or resumes a Pi process. */
export function ghosttyEnabled(): boolean {
  return process.platform === 'darwin' && process.env.TERM_PROGRAM === 'ghostty'
    && process.env.PIC_GHOSTTY_TABS === '1';
}

function appleString(text: string): string {
  return '"' + text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
    .replace(/[\r\n\u0000-\u001f]/g, ' ') + '"';
}
function shQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

/**
 * A Ghostty tab is presentation only. Reuse an exact tagged tab or attach to
 * an existing tmux session, never start a second Pi process.
 * Requires Ghostty >= 1.3 with AppleScript permission.
 */
export async function focusSharedTaskTab(
  pi: ExtensionAPI, title: string, id: string, target: string, cwd: string,
): Promise<{ ok: boolean; message: string }> {
  if (!ghosttyEnabled()) return { ok: false, message: 'Ghostty native tabs not enabled' };
  if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(target) || !/^[a-f0-9-]{36}$/.test(id)) {
    return { ok: false, message: 'Invalid tmux target or task ID' };
  }

  const tag = 'pic:' + id;
  const tabTitle = ('Pi · ' + title.slice(0, 48) + ' [' + tag + ']').replace(/[\r\n]/g, ' ');
  const command = 'cd ' + shQuote(cwd) + ' && tmux attach-session -t ' + shQuote('=' + target) + '\n';
  const script = [
    'tell application "Ghostty"',
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'if (name of t) contains ' + appleString(tag) + ' then',
    'select tab t',
    'activate window w',
    'return "focused"',
    'end if',
    'end repeat',
    'end repeat',
    'set w to front window',
    'set t to new tab in w',
    'set term to focused terminal of t',
    'perform action ' + appleString('set_tab_title:' + tabTitle) + ' on term',
    'input text ' + appleString(command) + ' to term',
    'return "opened"',
    'end tell',
  ].join('\n');
  try {
    const result = await pi.exec('osascript', ['-e', script], { cwd });
    return result.code === 0
      ? { ok: true, message: result.stdout.trim() || 'Ghostty tab selected' }
      : { ok: false, message: result.stderr.trim() || 'Ghostty automation failed' };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}
