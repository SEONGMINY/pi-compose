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
  set records to {}
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
          set end of records to terminalIdentifier & fieldDelimiter & windowIdentifier & fieldDelimiter & tabIdentifier & fieldDelimiter & terminalName & fieldDelimiter & terminalDirectory
        end repeat
      end repeat
    end repeat
  end tell
  set AppleScript's text item delimiters to rowDelimiter
  set rendered to records as text
  set AppleScript's text item delimiters to ""
  return rendered
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

const SPLIT_TERMINAL = `
on run argv
  set wantedId to item 1 of argv
  set newCwd to item 2 of argv
  set newCommand to item 3 of argv
  tell application "Ghostty"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with term in terminals of t
          if ((id of term) as text) is wantedId then
            set cfg to new surface configuration
            set initial working directory of cfg to newCwd
            set command of cfg to newCommand
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
): Promise<string> {
  if (!cwd.startsWith('/') || !command.trim()) {
    throw new GhosttyAutomationError('Split requires an absolute cwd and a command.');
  }
  const newId = await runAppleScript(SPLIT_TERMINAL, [validId(anchorTerminalId), cwd, command]);
  return validId(newId);
}
