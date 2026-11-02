import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Ghostty 1.3.1 AppleScript dictionary is our compatibility baseline.
// AppleScript terminal.id is a UUID and is NOT GHOSTTY_SURFACE_ID.
export type GhosttyTerminal = {
  id: string;
  windowId: string;
  tabId: string;
  name: string;
  cwd: string;
};

export class GhosttyAutomationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GhosttyAutomationError';
  }
}

const FIELD = String.fromCharCode(31);
const ROW = String.fromCharCode(30);

const LIST_TERMINALS = `
on run argv
  set fieldDelimiter to ASCII character 31
  set rowDelimiter to ASCII character 30
  set terminalRows to {}
  tell application "Ghostty"
    repeat with w in windows
      set windowIdentifier to (id of w) as text
      repeat with t in tabs of w
        set tabIdentifier to (id of t) as text
        repeat with term in terminals of t
          set terminalIdentifier to (id of term) as text
          set terminalName to ""
          set terminalDirectory to ""
          try
            set terminalName to (name of term) as text
          end try
          try
            set terminalDirectory to (working directory of term) as text
          end try
          set end of terminalRows to terminalIdentifier & fieldDelimiter & windowIdentifier & fieldDelimiter & tabIdentifier & fieldDelimiter & terminalName & fieldDelimiter & terminalDirectory
        end repeat
      end repeat
    end repeat
  end tell
  set AppleScript's text item delimiters to rowDelimiter
  set rendered to terminalRows as text
  set AppleScript's text item delimiters to ""
  return rendered
end run
`;

const FOCUSED_TERMINAL = `
on run argv
  tell application "Ghostty"
    set focusedTab to selected tab of front window
    set focusedTerm to focused terminal of focusedTab
    if focusedTerm is missing value then error "No Ghostty terminal is focused" number 1003
    return (id of focusedTerm) as text
  end tell
end run
`;

const QUERY_FOCUSED_TERMINAL = `
on run argv
  tell application "Ghostty"
    if not frontmost then return "not-frontmost"
    set focusedTab to selected tab of front window
    set focusedTerm to focused terminal of focusedTab
    if focusedTerm is missing value then return "unknown"
    return (id of focusedTerm) as text
  end tell
end run
`;

const FOCUS_TERMINAL = `
on run argv
  set wantedId to item 1 of argv
  tell application "Ghostty"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with term in terminals of t
          if ((id of term) as text) is wantedId then
            focus term
            return (id of term) as text
          end if
        end repeat
      end repeat
    end repeat
  end tell
  error "Ghostty terminal no longer exists" number 1001
end run
`;

const CLOSE_TERMINAL = `
on run argv
  set wantedId to item 1 of argv
  tell application "Ghostty"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with term in terminals of t
          if ((id of term) as text) is wantedId then
            close term
            return wantedId
          end if
        end repeat
      end repeat
    end repeat
  end tell
  error "Exact Ghostty Terminal not found; nothing closed" number 1001
end run
`;

// macOS System Events may require Accessibility/Automation permission.
// If unavailable, Overview stays active and the user can press Cmd+H manually.
const HIDE_GHOSTTY = `
on run argv
  tell application "System Events"
    set targetProcesses to every application process whose name is "Ghostty"
    if (count of targetProcesses) is 0 then error "Ghostty process not found" number 1001
    set visible of item 1 of targetProcesses to false
  end tell
  return "hidden"
end run
`;

const SPLIT_TERMINAL = `
on run argv
  set wantedId to item 1 of argv
  set newCwd to item 2 of argv
  set newCommand to item 3 of argv
  set environmentLines to {}
  if (count of argv) > 3 then set environmentLines to items 4 thru -1 of argv
  tell application "Ghostty"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with term in terminals of t
          if ((id of term) as text) is wantedId then
            set cfg to new surface configuration
            set initial working directory of cfg to newCwd
            set command of cfg to newCommand
            if (count of environmentLines) > 0 then
              set environment variables of cfg to environmentLines
            end if
            set createdTerm to split term direction right with configuration cfg
            if createdTerm is missing value then error "Ghostty did not create the split" number 1002
            return (id of createdTerm) as text
          end if
        end repeat
      end repeat
    end repeat
  end tell
  error "Ghostty split anchor no longer exists" number 1001
end run
`;

async function runAppleScript(script: string, args: string[] = []): Promise<string> {
  if (process.platform !== 'darwin') {
    throw new GhosttyAutomationError('Ghostty AppleScript requires macOS.');
  }
  try {
    // No shell interpolation: all values are passed as separate arguments to
    // the static AppleScript program. macOS controls Automation permissions.
    const { stdout } = await execFileAsync('osascript', ['-e', script, ...args], {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trimEnd();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new GhosttyAutomationError(
      'Ghostty AppleScript unavailable or operation failed: ' + detail,
    );
  }
}

function validId(id: string): string {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    throw new GhosttyAutomationError('An exact Ghostty terminal UUID is required.');
  }
  return id;
}

export async function listGhosttyTerminals(): Promise<GhosttyTerminal[]> {
  const raw = await runAppleScript(LIST_TERMINALS);
  if (!raw) return [];
  return raw.split(ROW).map(item => {
    const fields = item.split(FIELD);
    if (fields.length !== 5 || !/^[0-9a-fA-F-]{36}$/.test(fields[0])) {
      throw new GhosttyAutomationError('Unexpected Ghostty AppleScript terminal data.');
    }
    const [id, windowId, tabId, name, cwd] = fields;
    return { id, windowId, tabId, name, cwd };
  });
}

/** Focus the *same* existing Ghostty Surface, even after manual Tab dragging. */
export async function getFocusedGhosttyTerminalId(): Promise<string> {
  const id = await runAppleScript(FOCUSED_TERMINAL);
  return validId(id);
}

/**
 * Read-only focus observation. Unknown or AppleScript permission failures
 * never imply that an Agent is unfocused.
 */
export async function isGhosttyTerminalFocused(id: string): Promise<boolean | undefined> {
  const observed = await runAppleScript(QUERY_FOCUSED_TERMINAL);
  if (observed === 'unknown') return undefined;
  if (observed === 'not-frontmost') return false;
  return observed === validId(id);
}

export async function focusGhosttyTerminal(id: string): Promise<void> {
  const focused = await runAppleScript(FOCUS_TERMINAL, [validId(id)]);
  if (focused !== id) {
    throw new GhosttyAutomationError('Ghostty did not confirm the targeted terminal.');
  }
}

/**
 * Low-level adapter for an explicit user-approved Agent creation.
 * Returns the native terminal UUID; the caller must separately confirm Pi
 * process/session readiness. Never infer an Agent identity from CWD or title.
 *
 * This does NOT automatically focus the new split or start another Agent
 * outside the supplied Ghostty command configuration.
 */
export async function splitGhosttyTerminal(
  anchorTerminalId: string,
  cwd: string,
  command: string,
  environmentVariables: string[] = [],
): Promise<string> {
  if (!cwd.startsWith('/') || !command.trim()) {
    throw new GhosttyAutomationError('Split requires an absolute cwd and a command.');
  }
  if (environmentVariables.some(value => !/^[A-Z_][A-Z0-9_]*=[^\r\n\0]*$/.test(value))) {
    throw new GhosttyAutomationError('Invalid Ghostty split environment entry.');
  }
  const newId = await runAppleScript(SPLIT_TERMINAL, [validId(anchorTerminalId), cwd, command, ...environmentVariables]);
  return validId(newId);
}

/**
 * Ghostty 1.3.1 close has no additional confirmation. Call only after the
 * user explicitly selects termination, never for an unverified process.
 */
export async function closeGhosttyTerminal(id: string): Promise<void> {
  const closed = await runAppleScript(CLOSE_TERMINAL, [validId(id)]);
  if (closed !== id) throw new GhosttyAutomationError('Targeted terminal closure was not confirmed.');
}

/** Hide Ghostty itself while leaving all native Surfaces and Pi processes alive. */
export async function hideGhosttyWithoutQuit(): Promise<void> {
  const value = await runAppleScript(HIDE_GHOSTTY);
  if (value !== 'hidden') throw new GhosttyAutomationError('Ghostty hide was not acknowledged.');
}
