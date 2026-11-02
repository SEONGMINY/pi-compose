import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Text, matchesKey, type Component } from '@earendil-works/pi-tui';
import { performance } from 'node:perf_hooks';
import { decodeAgentBootstrap, AGENT_BOOTSTRAP_ENV } from '../src/agent-bootstrap.ts';
import { isGhosttyTerminalFocused } from '../src/ghostty-native.ts';
import { projectSummaryEvidence, type SummaryEvidence } from '../src/summary-evidence.ts';

const UNFOCUSED_DELAY_MS = 30_000;
const FOCUS_OBSERVATION_INTERVAL_MS = 1_000;
 
// Summary takes priority within its own Pi Surface while it remains open.
// On focus it offers explicit Handoff or a return to the original Pi TUI.
// It never overlays neighboring Ghostty Splits or the Compose Sidebar.
const PANEL_BACKGROUND = '\x1b[48;2;29;35;46m\x1b[38;2;242;246;252m';
const PANEL_RESET = '\x1b[0m';
const paintPanel = (text: string): string => PANEL_BACKGROUND + text + PANEL_RESET;

type SummaryAction = 'handoff' | 'pi';

class FullTerminalSummary implements Component {
  private choice: SummaryAction = 'handoff';

  constructor(
    private readonly content: Text,
    private readonly terminalRows: () => number,
    private readonly setChoice: (choice: SummaryAction) => void,
    private readonly onAction: (action: SummaryAction) => void,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, 'h')) return this.onAction('handoff');
    if (matchesKey(data, 'p') || matchesKey(data, 'escape')) return this.onAction('pi');
    if (matchesKey(data, 'up') || matchesKey(data, 'down') || matchesKey(data, 'tab')) {
      this.choice = this.choice === 'handoff' ? 'pi' : 'handoff';
      this.setChoice(this.choice);
      return;
    }
    if (matchesKey(data, 'enter')) this.onAction(this.choice);
  }

  render(width: number): string[] {
    const height = Math.max(1, this.terminalRows());
    const contentRows = this.content.render(width).slice(0, height);
    // Painting every row with opaque spaces prevents underlying Pi text/tool
    // output from visually bleeding through when the Summary is short.
    const empty = paintPanel(' '.repeat(Math.max(1, width)));
    return [
      ...contentRows,
      ...Array.from({ length: height - contentRows.length }, () => empty),
    ];
  }

  invalidate(): void {
    this.content.invalidate();
  }
}

/**
 * The Summary lives in the original Pi TUI's *own* renderer.
 * No terminal mirroring, replacement of the editor, or automatic model input.
 *
 * This is a factual, source-linked fallback; semantic summarization with a
 * separately bounded model and decision candidate detection are NOT supplied
 * by this extension yet.
 */
export function registerSummaryOverlay(
  pi: ExtensionAPI,
  handoff: (ctx: ExtensionContext) => Promise<void>,
): void {
  const ticket = decodeAgentBootstrap(process.env[AGENT_BOOTSTRAP_ENV]);
  if (!ticket?.terminalId) return;

  let activeSessionId: string | undefined;
  let ctx: ExtensionContext | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let lastBlurAt: number | undefined;
  let wasFocused: boolean | undefined;
  let status: SummaryEvidence['status'] = 'idle-or-unknown';
  let currentTool: string | undefined;
  let overlayActive = false;
  let closingSummaryPrompt = false;
  let closingOverlay: ((action?: SummaryAction) => void) | undefined;
  let handoffRunning = false;
  let overlaySequence = 0;
  let dismissedOnTurn = -1;
  let turnNumber = 0;
  let textComponent: Text | undefined;
  let redraw: (() => void) | undefined;
  let polling = false;
  let generation = 0;

  function currentEvidence(): SummaryEvidence | undefined {
    if (!ctx || ctx.sessionManager.getSessionId() !== activeSessionId) return;
    return projectSummaryEvidence(
      ctx.sessionManager.getBranch(),
      activeSessionId!,
      ctx.sessionManager.getLeafId(),
      status,
      currentTool,
    );
  }
  function visual(choice: SummaryAction = 'handoff'): string {
    const evidence = currentEvidence();
    if (!evidence) return 'Pi Compose — source session changed';
    return [
      'PI COMPOSE  /  ' + ticket!.label,
      'SUMMARY  ·  확인된 Pi 기록',
      '────────────────────────────────',
      '',
      evidence.headline,
      '',
      ...evidence.facts.map(fact => '• ' + fact.text + ' [' + fact.sourceEntryId.slice(0, 8) + ']'),
      '',
      '────────────────────────────────',
      choice === 'handoff' ? '> H  Main/다른 Agent에 Handoff' : '  H  Main/다른 Agent에 Handoff',
      choice === 'pi' ? '> P  원래 Pi 화면 보기' : '  P  원래 Pi 화면 보기',
      '↑/↓ 선택 · Enter 실행 · Esc 원래 Pi 화면',
      '',
      'Handoff는 수신자·근거·본문을 사용자가 검토한 뒤에만 요청합니다.',
      '응답 종료 ≠ 실제 작업 완료/검증 완료',
    ].join('\n');
  }
  function update(): void {
    if (!overlayActive || !textComponent) return;
    textComponent.setText(visual());
    redraw?.();
  }
  function close(action?: SummaryAction): void {
    if (!overlayActive) return;
    overlayActive = false;
    const done = closingOverlay;
    closingSummaryPrompt = true;
    closingOverlay = undefined;
    textComponent = undefined;
    redraw = undefined;
    done?.(action);
  }

  function show(): void {
    if (!ctx || !ctx.hasUI || overlayActive || handoffRunning ||
        dismissedOnTurn === turnNumber ||
        (status === 'idle-or-unknown' &&
         !ctx.sessionManager.getBranch().some(e => e.type === 'message'))) return;
    overlayActive = true;
    const thisGeneration = generation;
    const thisOverlay = ++overlaySequence;
    const source = ctx;
    const promise = ctx.ui.custom<SummaryAction | undefined>((tui, _theme, _keys, done) => {
      if (generation !== thisGeneration) {
        done(undefined);
        return new Text('', 0, 0);
      }
      closingOverlay = done;
      textComponent = new Text(visual(), 2, 1, paintPanel);
      redraw = () => tui.requestRender();
      const setChoice = (choice: SummaryAction) => {
        textComponent?.setText(visual(choice));
        redraw?.();
      };
      return new FullTerminalSummary(
        textComponent, () => tui.terminal.rows, setChoice, action => close(action),
      );
    }, {
      overlay: true,
      overlayOptions: {
        row: 0,
        col: 0,
        width: '100%',
        maxHeight: '100%',
        margin: 0,
        // The focused Summary owns its own Terminal's keyboard, allowing the
        // user to choose Handoff or Pi. Neighboring Ghostty Splits are untouched.
        nonCapturing: false,
      },
    });
    // Opening Summary does not await or block the Agent's model turn.
    void promise.then(async action => {
      if (generation !== thisGeneration || ctx !== source) return;
      if (action === 'pi') {
        // An explicit Pi return suppresses this stale Summary on the next blur.
        // A subsequent Agent response may produce a new Summary.
        dismissedOnTurn = turnNumber;
      } else if (action === 'handoff') {
        handoffRunning = true;
        try {
          // Reuse the existing human-selected recipient/source/type/editor flow.
          // Merely pressing H never sends anything.
          await handoff(source);
        } finally {
          handoffRunning = false;
        }
        if (generation === thisGeneration && ctx === source &&
            source.sessionManager.getSessionId() === activeSessionId) {
          show(); // Preserve the Summary after success, failure, or cancellation.
        }
      }
    }).catch(error => {
      source.ui.notify('Summary Handoff failed: ' + String(error), 'error');
    }).finally(() => {
      // A stale overlay resolution must not dismiss the newer Summary.
      if (overlayActive && overlaySequence === thisOverlay) close();
    });
  }
  async function observeFocus(): Promise<void> {
    if (!ctx || polling) return;
    polling = true;
    try {
      const focused = await isGhosttyTerminalFocused(ticket!.terminalId!);
      if (focused === undefined) return; // fail closed on unavailable focus evidence
      if (focused) {
        wasFocused = true;
        lastBlurAt = undefined;
        // Focus is an opportunity to interact with Summary, not a dismissal.
        // Explicit Pi return is available via P / Escape.
      } else {
        if (wasFocused !== false) lastBlurAt = performance.now();
        wasFocused = false;
        if (lastBlurAt !== undefined &&
            performance.now() - lastBlurAt >= UNFOCUSED_DELAY_MS) show();
      }
    } catch {
      // No guessed blur time or overlay on AppleScript/accessibility failure.
      lastBlurAt = undefined;
      wasFocused = undefined;
      close();
    } finally {
      polling = false;
    }
  }
  function cleanup(): void {
    generation++;
    if (interval) clearInterval(interval);
    interval = undefined;
    close();
    ctx = undefined;
    activeSessionId = undefined;
    lastBlurAt = undefined;
    wasFocused = undefined;
    status = 'idle-or-unknown';
    currentTool = undefined;
    closingSummaryPrompt = false;
    handoffRunning = false;
    dismissedOnTurn = -1;
    turnNumber = 0;
  }

  pi.on('session_start', (_ev, current) => {
    cleanup();
    if (!current.hasUI || current.sessionManager.getSessionId() !== ticket.sessionId) return;
    ctx = current;
    activeSessionId = ticket.sessionId;
    interval = setInterval(() => { void observeFocus(); }, FOCUS_OBSERVATION_INTERVAL_MS);
    interval.unref?.();
    void observeFocus();
  });
  pi.on('session_before_switch', () => { cleanup(); });
  pi.on('session_shutdown', () => { cleanup(); });
  pi.on('agent_start', () => {
    turnNumber++;
    dismissedOnTurn = -1;
    status = 'responding';
    currentTool = undefined;
    update();
  });
  pi.on('tool_execution_start', e => {
    status = 'responding'; currentTool = e.toolName; update();
  });
  pi.on('tool_execution_end', () => { currentTool = undefined; update(); });
  pi.on('ui_prompt_start', e => {
    // A Summary custom overlay isn't a model-initiated request for approval.
    if (e.kind === 'custom' && overlayActive) return;
    // The real Handoff UI owns the user's focus; never cover its selectors
    // or misclassify Handoff's selection prompts as an Agent work status.
    if (handoffRunning) return;
    if (overlayActive) close();
    status = 'waiting-for-ui'; update();
  });
  pi.on('ui_prompt_end', e => {
    if (e.kind === 'custom' && closingSummaryPrompt) {
      closingSummaryPrompt = false;
      return;
    }
    if (handoffRunning) return;
    status = 'responding'; update();
  });
  pi.on('message_end', () => { update(); });
  pi.on('agent_settled', e => {
    status = e.aborted ? 'idle-or-unknown' : 'response-ended';
    currentTool = undefined;
    update();
    // A completed response in an unfocused Agent bypasses the 30s delay.
    // Completion is the Pi turn boundary, NEVER proof of implementation.
    if (wasFocused === false && !e.aborted) show();
  });
}
