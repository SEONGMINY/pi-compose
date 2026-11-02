import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Text, type Component } from '@earendil-works/pi-tui';
import { performance } from 'node:perf_hooks';
import { decodeAgentBootstrap, AGENT_BOOTSTRAP_ENV } from '../src/agent-bootstrap.ts';
import { isGhosttyTerminalFocused } from '../src/ghostty-native.ts';
import { projectSummaryEvidence, type SummaryEvidence } from '../src/summary-evidence.ts';

const UNFOCUSED_DELAY_MS = 30_000;
const FOCUS_OBSERVATION_INTERVAL_MS = 1_000;
 
// The Summary takes visual priority within an UNFOCUSED Pi Surface.
// A non-capturing overlay keeps the original Pi TUI and process untouched;
// focusing that exact Surface closes it and reveals the original screen.
const PANEL_BACKGROUND = '\x1b[48;2;29;35;46m\x1b[38;2;242;246;252m';
const PANEL_RESET = '\x1b[0m';
const paintPanel = (text: string): string => PANEL_BACKGROUND + text + PANEL_RESET;

class FullTerminalSummary implements Component {
  constructor(
    private readonly content: Text,
    private readonly terminalRows: () => number,
  ) {}

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
export function registerSummaryOverlay(pi: ExtensionAPI): void {
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
  let closingPassivePrompt = false;
  let closingOverlay: (() => void) | undefined;
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
  function visual(): string {
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
      '해당 Agent를 선택하면 원래 Pi 화면으로 돌아갑니다.',
      'Main/다른 Agent 공유: /compose handoff에서 직접 선택',
      '응답 종료는 실제 작업 완료나 검증 완료를 뜻하지 않습니다.',
    ].join('\n');
  }
  function update(): void {
    if (!overlayActive || !textComponent) return;
    textComponent.setText(visual());
    redraw?.();
  }
  function close(): void {
    if (!overlayActive) return;
    overlayActive = false;
    const done = closingOverlay;
    closingPassivePrompt = true;
    closingOverlay = undefined;
    textComponent = undefined;
    redraw = undefined;
    done?.();
  }
  function show(): void {
    if (!ctx || !ctx.hasUI || overlayActive || status === 'idle-or-unknown' &&
        !ctx.sessionManager.getBranch().some(e => e.type === 'message')) return;
    overlayActive = true;
    const thisGeneration = generation;
    const promise = ctx.ui.custom<void>((tui, _theme, _keys, done) => {
      if (generation !== thisGeneration) { done(); return new Text('', 0, 0); }
      closingOverlay = () => done();
      textComponent = new Text(visual(), 2, 1, paintPanel);
      redraw = () => tui.requestRender();
      return new FullTerminalSummary(textComponent, () => tui.terminal.rows);
    }, {
      overlay: true,
      overlayOptions: {
        row: 0,
        col: 0,
        width: '100%',
        maxHeight: '100%',
        margin: 0,
        nonCapturing: true,
      },
    });
    // Do not await: the passive UI must never block the running Pi turn.
    void promise.catch(() => {}).finally(() => {
      if (generation === thisGeneration) close();
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
        close();
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
    closingPassivePrompt = false;
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
  pi.on('agent_start', () => { status = 'responding'; currentTool = undefined; update(); });
  pi.on('tool_execution_start', e => {
    status = 'responding'; currentTool = e.toolName; update();
  });
  pi.on('tool_execution_end', () => { currentTool = undefined; update(); });
  pi.on('ui_prompt_start', e => {
    // Our passive custom overlay is NOT a Pi request for user decision.
    if (overlayActive && e.kind === 'custom') return;
    status = 'waiting-for-ui'; update();
  });
  pi.on('ui_prompt_end', e => {
    if (e.kind === 'custom' && (overlayActive || closingPassivePrompt)) {
      closingPassivePrompt = false;
      return;
    }
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
