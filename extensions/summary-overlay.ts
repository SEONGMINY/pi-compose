import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { performance } from 'node:perf_hooks';
import { decodeAgentBootstrap, AGENT_BOOTSTRAP_ENV } from '../src/agent-bootstrap.ts';
import { isGhosttyTerminalFocused } from '../src/ghostty-native.ts';
import { projectSummaryEvidence, type SummaryEvidence } from '../src/summary-evidence.ts';

const UNFOCUSED_DELAY_MS = 30_000;
const FOCUS_OBSERVATION_INTERVAL_MS = 1_000;

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
      'PI COMPOSE · SUMMARY (factual fallback)',
      '───────────────',
      evidence.headline,
      ...evidence.facts.map(fact => '• ' + fact.text + ' [' + fact.sourceEntryId.slice(0, 8) + ']'),
      '',
      '응답 종료 ≠ 작업 완료/검증 완료',
      '공유: 사용자가 /compose handoff에서 직접 선택',
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
      textComponent = new Text(visual(), 0, 0);
      redraw = () => tui.requestRender();
      return textComponent;
    }, {
      overlay: true,
      overlayOptions: {
        anchor: 'top-right',
        width: '48%',
        maxHeight: '45%',
        margin: 1,
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
