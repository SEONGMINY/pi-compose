import { SessionManager } from '@earendil-works/pi-coding-agent';
import {
  ProcessTerminal, SelectList, Text, TuiMainScreen, matchesKey,
  type TUI, type SelectItem, type SelectListTheme,
} from '@earendil-works/pi-tui';
import {
  findLiveTerminal, readAgentRelationship, type AgentRelationship,
} from './agent-relationships.ts';
import { getFocusedGhosttyTerminalId, listGhosttyTerminals, focusGhosttyTerminal, type GhosttyTerminal } from './ghostty-native.ts';
import { projectHandoffHistory, type HandoffHistoryRow } from './handoff-history.ts';

type View = 'products' | 'agents' | 'messages';
type VisibleAgent = {
  identity: AgentRelationship;
  sessionPath: string;
  createdAt: number;
  terminal?: GhosttyTerminal;
  messages: HandoffHistoryRow[];
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
    result.push({
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
            description: (agent.identity.role === 'main' ? '' : agent.identity.role + ' · ') +
              (agent.terminal ? 'Surface 확인' : 'Surface 미확인'),
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
      description: agent.identity.product + ' / ' + agent.identity.role +
        (agent.terminal ? ' / Pi Surface 확인' : ' / Surface 미확인'),
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
  let selection: SelectList | undefined;
  let entries: ReturnType<typeof toEntries> = [];
  let status = 'Pi Compose · read-only native Overview';
  let busy = false;
  const statusText = new Text('', 0, 0);

  function render(): void {
    const title = new Text(
      'PI COMPOSE  /  [1] Products   [2] Agents   [3] Messages\n' +
      '────────────────────────────────────────────────\n' +
      (view === 'products' ? 'PRODUCTS' : view === 'agents' ? 'ALL AGENTS' : 'MESSAGES'),
      0, 0,
    );
    entries = toEntries(view, agents);
    if (entries.length === 0) {
      entries = [{
        item: { value: 'empty', label: view === 'messages' ? 'No recorded Handoff messages' : 'No registered Compose Agents' },
        action: { type: 'refresh' },
      }];
    }
    selection = new SelectList(entries.map(e => e.item), 16, selectionTheme);
    selection.onSelect = item => { void select(item.value); };
    selection.onCancel = () => {
      status = 'Choose an Agent, [1-3] to switch view, or [r] to refresh.';
      statusText.setText(status);
      tui.requestRender();
    };
    statusText.setText(
      status + '\n' +
      'Enter: focus existing Surface / inspect message · r: refresh · q: quit overview\n' +
      'Pi session records are evidence; Surface presence is not Agent running/readiness proof.',
    );
    tui.clear();
    tui.addChild(title);
    tui.addChild(selection);
    tui.addChild(statusText);
    tui.setFocus(selection);
    tui.requestRender();
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

  async function refresh(): Promise<void> {
    if (busy) return;
    busy = true;
    status = 'Refreshing native Pi/Ghostty evidence…';
    statusText.setText(status); tui.requestRender();
    try {
      terminalList = await listGhosttyTerminals();
      agents = await discoverAgents(terminalList);
      status = 'Registered Agents: ' + agents.length +
        '. Overview Terminal: ' + overviewId.slice(0, 8);
    } catch (error) {
      status = 'Read-only refresh failed: ' + String(error);
    } finally {
      busy = false;
      render();
    }
  }

  const finish = () => { tui.stop(); };
  tui.addInputListener(data => {
    if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'q')) {
      finish(); return { consume: true };
    }
    if (matchesKey(data, '1') || matchesKey(data, '2') || matchesKey(data, '3')) {
      view = matchesKey(data, '1') ? 'products' : matchesKey(data, '2') ? 'agents' : 'messages';
      render(); return { consume: true };
    }
    if (matchesKey(data, 'r')) {
      void refresh(); return { consume: true };
    }
    return undefined;
  });
  render();
  tui.start();
  await refresh();
}
