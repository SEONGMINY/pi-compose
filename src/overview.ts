import { SessionManager, type SessionInfo } from '@earendil-works/pi-coding-agent';
import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  ProcessTerminal, SelectList, Input, Text, TuiMainScreen, matchesKey,
  type TUI, type SelectItem, type SelectListTheme,
} from '@earendil-works/pi-tui';
import {
  findLiveTerminal, readAgentRelationship, type AgentRelationship,
} from './agent-relationships.ts';
import {
  getFocusedGhosttyTerminalId, listGhosttyTerminals, focusGhosttyTerminal,
  closeGhosttyTerminal, hideGhosttyWithoutQuit, widenGhosttyWorkArea,
  type GhosttyTerminal,
} from './ghostty-native.ts';
import {
  observeAgentLifecycle, type AgentLifecycleObservation,
} from './agent-lifecycle.ts';
import { projectHandoffHistory, type HandoffHistoryRow } from './handoff-history.ts';
import { startNativeMainInOverview } from './native-agent-launch.ts';
import { projectSummaryEvidence } from './summary-evidence.ts';

type View = 'products' | 'agents' | 'messages';
type VisibleAgent = {
  identity: AgentRelationship;
  sessionPath: string;
  createdAt: number;
  terminal?: GhosttyTerminal;
  messages: HandoffHistoryRow[];
  pending?: boolean;
  lifecycle: AgentLifecycleObservation;
};

const selectionTheme: SelectListTheme = {
  selectedPrefix: s => '\x1b[36m' + s + '\x1b[0m',
  selectedText: s => '\x1b[1m' + s + '\x1b[0m',
  description: s => '\x1b[90m' + s + '\x1b[0m',
  scrollInfo: s => '\x1b[90m' + s + '\x1b[0m',
  noMatch: s => s,
};

async function discoverAgents(terminals: readonly GhosttyTerminal[]): Promise<VisibleAgent[]> {
  // Pi already owns session discovery; no second transcript registry or DB.
  const sessions = await SessionManager.listAll();
  const result: VisibleAgent[] = [];
  for (const session of sessions) {
    let manager: SessionManager;
    try { manager = SessionManager.open(session.path); } catch { continue; }
    const identity = readAgentRelationship(manager.getSessionId(), manager.getEntries());
    if (!identity) continue;
    const lifecycle = await observeAgentLifecycle(identity.runtimeReceiptFile, {
      sessionId: identity.sessionId,
      launchRequestId: identity.runtimeLaunchRequestId,
      terminalId: identity.terminalId,
    });
    result.push({
      lifecycle,
      identity,
      sessionPath: session.path,
      createdAt: session.created.getTime(),
      terminal: findLiveTerminal(identity, terminals),
      messages: projectHandoffHistory(manager.getEntries()),
    });
  }
  // Stable creation order; state changes do not move an Agent in the sidebar.
  return result.sort((a, b) => a.createdAt - b.createdAt);
}

type SelectionAction =
  | { type: 'agent'; sessionId: string }
  | { type: 'message'; sessionId: string; messageId: string }
  | { type: 'view'; view: View }
  | { type: 'refresh' };

function toEntries(view: View, agents: readonly VisibleAgent[]): Array<{ item: SelectItem; action: SelectionAction }> {
  if (view === 'messages') {
    return agents.flatMap(agent => agent.messages.map(msg => ({
      item: {
        value: agent.identity.sessionId + '/' + msg.id,
        label: msg.direction + ' · ' + msg.status + ' · ' + agent.identity.label,
        description: msg.peer + (msg.excerpt ? ' · ' + msg.excerpt : ''),
      },
      action: { type: 'message' as const, sessionId: agent.identity.sessionId, messageId: msg.id },
    })));
  }
  const products = [...new Set(agents.map(a => a.identity.product))];
  if (view === 'products') {
    return products.flatMap(product => {
      const members = agents.filter(a => a.identity.product === product);
      const byId = new Map(members.map(agent => [agent.identity.sessionId, agent]));
      const roots = members.filter(agent => !agent.identity.requesterSessionId ||
        !byId.has(agent.identity.requesterSessionId));
      const visited = new Set<string>();
      const hierarchy: Array<{ item: SelectItem; action: SelectionAction }> = [];
      const visit = (agent: VisibleAgent, depth: number) => {
        const id = agent.identity.sessionId;
        if (visited.has(id)) return;
        visited.add(id);
        hierarchy.push({
          item: {
            value: 'agent/' + id,
            label: '  '.repeat(Math.min(depth + 1, 12)) + agent.identity.label,
            description: agent.lifecycle.state === 'process-observed' ? 'running (OS)' :
              agent.lifecycle.state === 'launch-failed' ? 'start failed' :
              agent.lifecycle.state === 'exited-observed' ? 'exited' : 'unverified',
          },
          action: { type: 'agent', sessionId: id },
        });
        for (const child of members) {
          if (child.identity.requesterSessionId === id) visit(child, depth + 1);
        }
      };
      for (const root of roots) visit(root, 0);
      // Corrupt/partial creator relationships stay visible but are never
      // assigned a guessed parent. A cycle is displayed only once.
      for (const agent of members) {
        if (!visited.has(agent.identity.sessionId)) visit(agent, 0);
      }
      return [
        { item: { value: 'product/' + product, label: '▾ ' + product }, action: { type: 'refresh' as const } },
        ...hierarchy,
      ];
    });
  }
  return agents.map(agent => ({
    item: {
      value: 'agent/' + agent.identity.sessionId,
      label: agent.identity.label,
      description: agent.identity.role + ' · ' +
        (agent.lifecycle.state === 'process-observed' ? 'running (OS)' : agent.lifecycle.state),
    },
    action: { type: 'agent', sessionId: agent.identity.sessionId },
  }));
}

/**
 * Dedicated user-facing Overview, occupying ONLY the terminal used to run pic.
 * Other Ghostty tabs remain native Pi TUI; no mirroring or process recreation.
 * State, summary and creation controls are integrated once their exact native
 * Agent identity and Ghostty binding contracts are wired.
 */
export async function openOverview(): Promise<void> {
  if (process.platform !== 'darwin' || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('pic Overview requires an interactive macOS Ghostty terminal.');
  }
  const overviewId = await getFocusedGhosttyTerminalId();
  const native = await listGhosttyTerminals();
  if (!native.some(term => term.id === overviewId)) {
    throw new Error('Cannot identify the exact native Ghostty terminal hosting pic.');
  }

  const tui: TUI = new TuiMainScreen(new ProcessTerminal());
  let view: View = 'products';
  let agents: VisibleAgent[] = [];
  let terminalList: GhosttyTerminal[] = native;
  const pendingMains = new Map<string, VisibleAgent>();
  let modalActive = false;
  let selection: SelectList | undefined;
  let entries: ReturnType<typeof toEntries> = [];
  let status = 'Pi Compose · read-only native Overview';
  let busy = false;
  const statusText = new Text('', 0, 0);

  function render(): void {
    const title = new Text(
      'PI COMPOSE\n' +
      '[1] P  [2] A  [3] M\n' +
      (view === 'products' ? 'PROJECTS' : view === 'agents' ? 'AGENTS' : 'MESSAGES'),
      0, 0,
    );
    entries = toEntries(view, agents);
    if (entries.length === 0) {
      entries = [{
        item: { value: 'empty', label: view === 'messages' ? 'No recorded Handoff messages' : 'No registered Compose Agents' },
        action: { type: 'refresh' },
      }];
    }
    const previousSelected = selection?.getSelectedItem()?.value;
    selection = new SelectList(entries.map(e => e.item), 16, selectionTheme);
    const selectedIndex = entries.findIndex(e => e.item.value === previousSelected);
    if (selectedIndex >= 0) selection.setSelectedIndex(selectedIndex);
    selection.onSelect = item => { void select(item.value); };
    selection.onCancel = () => {
      status = 'Choose an Agent, [1-3] to switch view, or [r] to refresh.';
      statusText.setText(status);
      tui.requestRender();
    };
    const width = Math.max(18, process.stdout.columns || 38);
    const routine = status.startsWith('Registered Agents:') ||
      status.startsWith('Pi Compose · read-only') ||
      status.startsWith('Refreshing native');
    const abbreviated = routine ? '' : (status.length >= width - 1
      ? status.slice(0, Math.max(8, width - 6)) + '… [?]'
      : status);
    statusText.setText((abbreviated ? abbreviated + '\n' : '') +
      'Enter Focus · n New Main\n' +
      'o Open · v Info · r ↻\n' +
      '? Details · q Exit');
    tui.clear();
    tui.addChild(title);
    tui.addChild(selection);
    tui.addChild(statusText);
    tui.setFocus(selection);
    tui.requestRender();
  }


  // All UI operations stay in this exact pic Terminal, never in a Main model
  // conversation. These are user interactions, not guessed default decisions.
  function ask(title: string, initial = ''): Promise<string | undefined> {
    return new Promise(resolve => {
      modalActive = true;
      const input = new Input({ prompt: '> ' });
      input.setValue(initial);
      const finish = (value?: string) => {
        modalActive = false;
        render();
        resolve(value?.trim() || undefined);
      };
      input.onSubmit = value => finish(value);
      input.onEscape = () => finish();
      tui.clear();
      tui.addChild(new Text(title + '\\nEscape: cancel', 0, 0));
      tui.addChild(input);
      tui.setFocus(input);
      tui.requestRender();
    });
  }

  function chooseSession(
    sessions: readonly SessionInfo[],
  ): Promise<SessionInfo | undefined> {
    return new Promise(resolve => {
      modalActive = true;
      const displayed = sessions.map(session => ({
        value: session.id + '/' + session.path,
        label: (session.name || session.firstMessage.slice(0, 60) || 'Unnamed Pi session') +
          ' [' + session.id.slice(0, 8) + ']',
        description: session.cwd + ' · ' + session.modified.toISOString().slice(0, 16),
      }));
      const list = new SelectList(displayed, 15, selectionTheme);
      const done = (selected?: SessionInfo) => {
        modalActive = false;
        render();
        resolve(selected);
      };
      list.onSelect = item => done(sessions[displayed.findIndex(row => row.value === item.value)]);
      list.onCancel = () => done();
      tui.clear();
      tui.addChild(new Text('Select the exact saved Main Pi session\\nEscape: cancel · arrows: navigate', 0, 0));
      tui.addChild(list);
      tui.setFocus(list);
      tui.requestRender();
    });
  }

  async function createMain(defaults?: { product: string; label: string; cwd: string }): Promise<void> {
    if (busy || modalActive) return;
    busy = true;
    try {
      const product = defaults?.product ?? await ask('Product / project');
      if (!product) return;
      const label = defaults?.label ?? await ask('Main display name (e.g. 복약관리)');
      if (!label) return;
      const cwd = defaults?.cwd ?? await ask('Absolute working directory for the Main', process.cwd());
      if (!cwd) return;
      status = 'Requesting native Ghostty Split for a new Main…';
      statusText.setText(status);
      const receipt = await startNativeMainInOverview({
        product, label, targetCwd: cwd, overviewAnchorTerminalId: overviewId,
      });
      pendingMains.set(receipt.sessionId, {
        identity: {
          sessionId: receipt.sessionId,
          product, role: 'main', label,
          workspaceCwd: cwd,
          launchRequestId: receipt.launchRequestId,
          runtimeLaunchRequestId: receipt.launchRequestId,
          runtimeReceiptFile: receipt.runtimeReceiptFile,
          terminalId: receipt.terminalId,
        },
        sessionPath: '',
        createdAt: Date.now(),
        terminal: undefined, // Filled by the next read-only Ghostty inventory.
        messages: [], pending: true,
        lifecycle: { state: 'starting-unverified', source: 'Ghostty Split receipt; Pi not confirmed' },
      });
      status = 'Main Split created [' + receipt.sessionId.slice(0, 8) +
        ']. Pi readiness is unverified; blank session persists after its first message.';
      await refresh(true);
      status = 'Main [' + receipt.sessionId.slice(0, 8) + '] created; Pi readiness unverified.';
      // Sidebar should not capture initial keyboard focus or take half the
      // screen. Size the real work area first; never hide a successful launch
      // when Ghostty cannot resize a constrained window.
      await widenGhosttyWorkArea(receipt.terminalId).catch(() => false);
      await focusGhosttyTerminal(receipt.terminalId).catch(() => undefined);
    } catch (error) {
      status = 'Main creation failed or is unconfirmed: ' + String(error) +
        '. Inspect Ghostty Surfaces before trying again.';
    } finally {
      busy = false;
      render();
    }
  }

  async function openSavedMain(selectedMain?: SessionInfo): Promise<void> {
    if (busy || modalActive) return;
    busy = true;
    try {
      const saved = await SessionManager.listAll();
      const candidates: SessionInfo[] = [];
      for (const info of saved) {
        try {
          const session = SessionManager.open(info.path);
          if (session.getSessionId() !== info.id) continue;
          const owner = readAgentRelationship(info.id, session.getEntries());
          if (!owner || owner.role === 'main') candidates.push(info);
        } catch { /* Invalid/unreadable transcript is not selectable. */ }
      }
      if (candidates.length === 0) {
        status = 'No saved Pi sessions available for explicit Main selection.';
        return;
      }
      const chosen = selectedMain ?? await chooseSession(candidates);
      if (!chosen) return;
      const manager = SessionManager.open(chosen.path);
      if (manager.getSessionId() !== chosen.id) throw new Error('Selected Pi session changed.');
      const existing = readAgentRelationship(chosen.id, manager.getEntries());
      if (existing && existing.role !== 'main') throw new Error('Selected Pi session is not a Main.');

      const already = existing ? findLiveTerminal(existing, await listGhosttyTerminals()) : undefined;
      if (already) {
        await focusGhosttyTerminal(already.id);
        status = 'Focused existing Main Surface; no duplicate Pi process was started.';
        return;
      }

      const runtime = await observeAgentLifecycle(existing?.runtimeReceiptFile, {
        sessionId: chosen.id,
        launchRequestId: existing?.runtimeLaunchRequestId,
        terminalId: existing?.terminalId,
      });
      if (runtime.state === 'process-observed') {
        status = 'This Main has an observed OS process. Duplicate Pi session resume blocked.';
        return;
      }
      const needsAcknowledgement =
        runtime.state !== 'exited-observed' && runtime.state !== 'launch-failed';
      if (needsAcknowledgement) {
        const acknowledgement = await ask(
          'Pi process status is not confirmed. Another Pi may still write this session. ' +
          'Type RESUME to accept the risk, or Escape to cancel.',
        );
        if (acknowledgement !== 'RESUME') {
          status = 'Main resume cancelled; process identity is unconfirmed.';
          return;
        }
      }
      const product = existing?.product || await ask('Assign a product to this selected Main');
      if (!product) return;
      const label = existing?.label || await ask('Assign this selected Main a display name');
      if (!label) return;
      if (!chosen.cwd) throw new Error('Saved Pi session has no known working directory.');
      const receipt = await startNativeMainInOverview({
        product, label, targetCwd: chosen.cwd, overviewAnchorTerminalId: overviewId,
        resume: {
          sessionId: chosen.id, sessionFile: chosen.path,
          allowUnconfirmedProcess: needsAcknowledgement,
        },
      });
      pendingMains.set(receipt.sessionId, {
        identity: {
          sessionId: receipt.sessionId, product, role: 'main', label,
          workspaceCwd: chosen.cwd,
          launchRequestId: receipt.launchRequestId,
          runtimeLaunchRequestId: receipt.launchRequestId,
          runtimeReceiptFile: receipt.runtimeReceiptFile,
          terminalId: receipt.terminalId,
        },
        sessionPath: chosen.path,
        createdAt: chosen.created.getTime(),
        terminal: undefined, // Filled by the next read-only Ghostty inventory.
        messages: [], pending: true,
        lifecycle: { state: 'starting-unverified', source: 'Ghostty Split receipt; Pi not confirmed' },
      });
      status = 'Existing Pi session selected and Main Split created. No task replayed; startup unverified.';
      await refresh(true);
      status = 'Selected Main resumed; Pi readiness unverified.';
      await widenGhosttyWorkArea(receipt.terminalId).catch(() => false);
      await focusGhosttyTerminal(receipt.terminalId).catch(() => undefined);
    } catch (error) {
      status = 'Main selection/resume failed or is unconfirmed: ' + String(error) +
        '. No automatic retry.';
    } finally {
      busy = false;
      render();
    }
  }

  /** Only Compose-owned Mains in the invoking project may resume on startup.
   * Unknown Pi sessions are never silently adopted as Compose Mains. */
  async function startProjectMain(): Promise<void> {
    try {
      const cwd = await realpath(process.cwd());
      const saved = await SessionManager.listAll();
      const projectMains: SessionInfo[] = [];
      for (const info of saved) {
        if (info.cwd !== cwd) continue;
        try {
          const manager = SessionManager.open(info.path);
          if (manager.getSessionId() !== info.id) continue;
          const identity = readAgentRelationship(info.id, manager.getEntries());
          if (identity?.role === 'main' && identity.workspaceCwd === cwd) {
            projectMains.push(info);
          }
        } catch { /* Unreadable transcripts never become implicit Main choices. */ }
      }
      if (projectMains.length === 0) {
        await createMain({ product: basename(cwd), label: 'Main', cwd });
        return;
      }
      if (projectMains.length === 1) {
        await openSavedMain(projectMains[0]);
        return;
      }
      status = 'Choose a Main from this project (no automatic last-session guess).';
      render();
      const chosen = await chooseSession(projectMains);
      if (chosen) await openSavedMain(chosen);
      else { status = 'No Main chosen; use [o] to open a saved session.'; render(); }
    } catch (error) {
      status = 'Cannot initialize Main for this project: ' + String(error);
      render();
    }
  }

  async function select(id: string): Promise<void> {
    const entry = entries.find(e => e.item.value === id);
    if (!entry) return;
    if (entry.action.type === 'refresh') return;
    if (entry.action.type === 'message') {
      const owner = agents.find(a => a.identity.sessionId === entry.action.sessionId);
      const msg = owner?.messages.find(m => m.id === (entry.action as { messageId: string }).messageId);
      if (msg) {
        status = 'Message: ' + msg.status + ' · ' + msg.peer +
          (msg.excerpt ? ' · ' + msg.excerpt : '') +
          ' — model consumption NOT confirmed.';
        statusText.setText(status);
        tui.requestRender();
      }
      return;
    }
    if (entry.action.type !== 'agent' || busy) return;
    const agent = agents.find(a => a.identity.sessionId === entry.action.sessionId);
    if (!agent) return;
    if (!agent.terminal) {
      status = 'No verified Ghostty binding for ' + agent.identity.label +
        '. No Pi process was started or resumed.';
      statusText.setText(status); tui.requestRender();
      return;
    }
    busy = true;
    try {
      await focusGhosttyTerminal(agent.terminal.id);
      status = 'Focused exact Ghostty Terminal ' + agent.terminal.id;
    } catch (error) {
      status = 'Cannot focus existing Terminal: ' + String(error);
    } finally {
      busy = false;
      statusText.setText(status); tui.requestRender();
    }
  }

  async function inspectSelectedAgentSummary(): Promise<void> {
    if (busy || modalActive || !selection) return;
    const item = selection.getSelectedItem();
    const action = entries.find(row => row.item.value === item?.value)?.action;
    if (action?.type !== 'agent') {
      status = 'Select an Agent row to inspect its source-backed Summary.';
      statusText.setText(status); tui.requestRender();
      return;
    }
    const agent = agents.find(a => a.identity.sessionId === action.sessionId);
    if (!agent || !agent.sessionPath) {
      status = 'Agent has no persisted Pi transcript yet; Summary unavailable.';
      statusText.setText(status); tui.requestRender();
      return;
    }
    try {
      const manager = SessionManager.open(agent.sessionPath);
      if (manager.getSessionId() !== action.sessionId) throw new Error('Pi session identity changed');
      const evidence = projectSummaryEvidence(
        manager.getBranch(), action.sessionId, manager.getLeafId(), 'idle-or-unknown',
      );
      status = 'Source-backed Summary (no semantic model): ' +
        evidence.facts.map(f => f.text + ' [' + f.sourceEntryId.slice(0, 8) + ']').join(' | ') +
        ' — select the real Pi Agent and use /compose handoff for sharing.';
      statusText.setText(status); tui.requestRender();
    } catch (error) {
      status = 'Cannot read exact Pi transcript: ' + String(error);
      statusText.setText(status); tui.requestRender();
    }
  }

  let previousAgentSnapshot = '';
  async function refresh(force = false, quiet = false): Promise<void> {
    if (busy && !force) return;
    busy = true;
    if (!quiet) {
      status = 'Refreshing native Pi/Ghostty evidence…';
      statusText.setText(status); tui.requestRender();
    }
    let changed = true;
    try {
      terminalList = await listGhosttyTerminals();
      agents = await discoverAgents(terminalList);
      const known = new Set(agents.map(agent => agent.identity.sessionId));
      for (const [id, pending] of pendingMains) {
        if (known.has(id)) {
          pendingMains.delete(id);
        } else {
          agents.push({
            ...pending,
            terminal: terminalList.find(t => t.id === pending.identity.terminalId),
            lifecycle: await observeAgentLifecycle(pending.identity.runtimeReceiptFile, {
              sessionId: pending.identity.sessionId,
              launchRequestId: pending.identity.runtimeLaunchRequestId,
              terminalId: pending.identity.terminalId,
            }),
          });
        }
      }
      agents.sort((a, b) => a.createdAt - b.createdAt);
      const snapshot = JSON.stringify(agents.map(agent => [
        agent.identity.sessionId, agent.identity.requesterSessionId,
        agent.identity.label, agent.lifecycle.state,
        agent.terminal?.id, agent.messages.length,
      ]));
      changed = snapshot !== previousAgentSnapshot;
      previousAgentSnapshot = snapshot;
      if (!quiet) status = 'Registered Agents: ' + agents.length +
        '. Overview Terminal: ' + overviewId.slice(0, 8);
    } catch (error) {
      changed = true;
      status = 'Read-only refresh failed: ' + String(error);
    } finally {
      busy = false;
      if (!quiet || changed) render();
    }
  }

  // 'q' is an explicit product-exit decision, not a silent terminal close.
  // Hidden Ghostty remains alive; the full TUI state and native Pi processes
  // stay in their original Surfaces until the user restores the app.
  function chooseExitOption(title: string, options: Array<{ value: string; label: string; description?: string }>): Promise<string | undefined> {
    return new Promise(resolve => {
      modalActive = true;
      const list = new SelectList(options, 9, selectionTheme);
      const finish = (value?: string) => {
        modalActive = false;
        render();
        resolve(value);
      };
      list.onSelect = item => finish(item.value);
      list.onCancel = () => finish();
      tui.clear();
      tui.addChild(new Text(title + '\\nEscape: return to Overview', 0, 0));
      tui.addChild(list);
      tui.setFocus(list);
      tui.requestRender();
    });
  }

  async function requestExit(): Promise<void> {
    if (busy || modalActive) return;
    const decision = await chooseExitOption('Exit Pi Compose — what should happen to running Agents?', [
      { value: 'keep', label: 'Keep Agent sessions running (hide Ghostty)', description: 'No Pi session or Surface is closed' },
      { value: 'terminate', label: 'Terminate observed Pi Agents', description: 'Close only exact, rechecked live Compose Surfaces' },
      { value: 'cancel', label: 'Cancel and return to Overview' },
    ]);
    if (decision === 'keep') {
      try {
        await hideGhosttyWithoutQuit();
        status = 'Ghostty hidden. Native Pi Surfaces and this Overview remain alive.';
      } catch (error) {
        status = 'Could not hide Ghostty automatically; Overview and Agents remain open. ' +
          'Use Ghostty Cmd+H if desired. ' + String(error);
      }
      statusText.setText(status); tui.requestRender();
      return;
    }
    if (decision !== 'terminate') return;
    await refresh(true);
    const eligible = agents.filter(a => a.terminal && a.lifecycle.state === 'process-observed');
    const unknownCount = agents.filter(a => a.terminal && a.lifecycle.state !== 'process-observed').length;
    const confirmed = await chooseExitOption(
      'Close ' + eligible.length + ' confirmed-process Surface(s)? ' +
      unknownCount + ' unknown/unverified Surface(s) will remain untouched.',
      [
        { value: 'confirm', label: 'Yes, close only these confirmed Pi Agent Surfaces' },
        { value: 'cancel', label: 'No, return to Overview' },
      ],
    );
    if (confirmed !== 'confirm') return;
    busy = true;
    let issued = 0;
    let notClosed = 0;
    try {
      for (const agent of eligible) {
        if (!agent.terminal) continue;
        // Revalidate identity and OS process fingerprint immediately before
        // Ghostty's close command (which has no native confirmation prompt).
        const currentTerminals = await listGhosttyTerminals();
        const observation = await observeAgentLifecycle(agent.identity.runtimeReceiptFile, {
          sessionId: agent.identity.sessionId,
          launchRequestId: agent.identity.runtimeLaunchRequestId ?? agent.identity.launchRequestId,
          terminalId: agent.identity.terminalId,
        });
        if (!currentTerminals.some(t => t.id === agent.terminal!.id) ||
            observation.state !== 'process-observed') {
          notClosed++;
          continue;
        }
        try {
          await closeGhosttyTerminal(agent.terminal.id);
          issued++;
        } catch {
          notClosed++;
        }
      }
    } finally {
      busy = false;
    }
    await refresh(true);
    status = 'Ghostty close acknowledged for ' + issued + ' Surface(s); ' +
      (notClosed + unknownCount) + ' unconfirmed or not closed. ' +
      'Pi exit is determined by its child exit receipt, not by close acknowledgement. ' +
      'Saved conversations and Git Worktrees were not deleted.';
    statusText.setText(status); tui.requestRender();
    // Keep Overview active for inspection. Never quit Ghostty or silently
    // discard ambiguous processes after a partial closure.
  }

  function showDetails(): void {
    if (busy || modalActive) return;
    modalActive = true;
    const back = new SelectList([{ value: 'back', label: 'Return to Sidebar' }], 1, selectionTheme);
    back.onSelect = () => { modalActive = false; render(); };
    back.onCancel = () => { modalActive = false; render(); };
    tui.clear();
    tui.addChild(new Text(
      'PI COMPOSE / DETAILS\n' +
      'This Sidebar controls native Ghostty Pi terminals.\n' +
      'Main opens automatically for the current project.\n' +
      'Use >w / >s within Pi to add an Agent to its work area.\n' +
      'n New Main | o Saved Main | Enter Focus | v Evidence\n' +
      'Status: ' + status + '\n' +
      'OS process presence is NOT model readiness or task success.',
      0, 0,
    ));
    tui.addChild(back);
    tui.setFocus(back);
    tui.requestRender();
  }

  tui.addInputListener(data => {
    if (modalActive) return undefined;
    if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'q')) {
      void requestExit(); return { consume: true };
    }
    if (matchesKey(data, '1') || matchesKey(data, '2') || matchesKey(data, '3')) {
      view = matchesKey(data, '1') ? 'products' : matchesKey(data, '2') ? 'agents' : 'messages';
      render(); return { consume: true };
    }
    if (matchesKey(data, 'n')) {
      void createMain(); return { consume: true };
    }
    if (matchesKey(data, 'o')) {
      void openSavedMain(); return { consume: true };
    }
    if (matchesKey(data, 'v')) {
      void inspectSelectedAgentSummary(); return { consume: true };
    }
    if (matchesKey(data, 'r')) {
      void refresh(); return { consume: true };
    }
    if (matchesKey(data, '?')) {
      showDetails(); return { consume: true };
    }
    return undefined;
  });
  render();
  tui.start();
  await refresh();
  // A pic invocation starts directly with the real native Pi Main. The
  // Overview is a secondary, compact companion rather than a creation gate.
  await startProjectMain();
  // Quiet read-only observation updates agent membership/status without a
  // user refresh. Do not recreate the list while a selector is open or reset
  // its active selection when the same evidence is returned.
  setInterval(() => {
    if (!modalActive && !busy) void refresh(false, true);
  }, 5000).unref();
}
