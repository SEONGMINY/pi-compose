import { useEffect, useMemo, useState } from 'react';
import { TerminalPane } from './TerminalPane';

type Role = 'main' | 'work' | 'support';
type Workspace = 'shared' | 'worktree';
export type Agent = {
  id: string; role: Role; title: string; cwd: string; workspace: Workspace;
  sessionId: string; sessionFile: string | null; task?: string;
  relatedMainId: string | null; sourceSession: string | null;
  sourceEntryId?: string | null; context?: 'fork' | 'independent';
  processStatus: 'running' | 'stopped'; branch?: string | null;
};
type State = { project: string | null; agents: Agent[] };
type TerminalEvent = { id: string; seq?: number; data?: string; exit?: boolean };
type Review = { diff: string; status: string; untracked: string; baseSha: string };
export type Bridge = {
  state(): Promise<State>;
  chooseProject(): Promise<State | null>;
  createMain(title: string): Promise<string>;
  createWork(mainId: string, task: string, workspace: Workspace): Promise<string>;
  createSupport(mainId: string, task: string, workspace: Workspace): Promise<string>;
  start(id: string): Promise<{ seq: number; buffer: string; running: boolean }>;
  attach(id: string): Promise<{ seq: number; buffer: string; running: boolean }>;
  stop(id: string): Promise<void>;
  review(id: string): Promise<Review>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  onTerminal(fn: (event: TerminalEvent) => void): () => void;
  onState(fn: (state: State) => void): () => void;
};
const roleName: Record<Role, string> = {
  main: 'Main Agent', work: 'Work Agent', support: 'Support Agent',
};
const roleHelp: Record<Role, string> = {
  main: '요구사항 · 설계 · 의사결정',
  work: 'Main의 정확한 Pi 대화를 Fork해 개발',
  support: 'Main 대화를 상속하지 않는 독립 작업',
};

function Changes({ review, shared }: { review: Review; shared: boolean }) {
  return <div className="changes">
    <p className="meta">Git 검토 기준: {review.baseSha.slice(0, 12)}</p>
    {shared && <p className="warning">같은 폴더에서 진행한 변경은 특정 Agent의 작업으로 귀속할 수 없습니다.</p>}
    <h3>변경 파일</h3>
    <pre>{review.status || '변경된 파일 없음'}</pre>
    {review.untracked && <><h3>새 파일 (미추적)</h3><pre>{review.untracked}</pre></>}
    <h3>실제 코드 변경</h3>
    <pre className="patch">{review.diff || '기준 커밋 대비 추적된 파일 변경 없음'}</pre>
    <p className="meta">Git 변경을 확인한 것이며, 요구사항 준수나 구현 완료를 보장하지 않습니다.</p>
  </div>;
}

function AgentView({ agent, bridge, showReview }: {
  agent: Agent; bridge: Bridge; showReview?: boolean;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'terminal' | 'diff'>('terminal');
  useEffect(() => { setTab('terminal'); setReview(null); setError(''); }, [agent.id]);
  const openDiff = async () => {
    setError('');
    try { setReview(await bridge.review(agent.id)); setTab('diff'); }
    catch (cause) { setError(String(cause)); }
  };
  const restart = async () => {
    setError('');
    try { await bridge.start(agent.id); }
    catch (cause) { setError(String(cause)); }
  };
  return <section className="agent-pane">
    <header className="pane-title">
      <div className="pane-ident">
        <span className={'agent-pill ' + agent.role}>{roleName[agent.role]}</span>
        <strong>{agent.title}</strong>
        <span className="small-muted">{roleHelp[agent.role]}</span>
      </div>
      <div className="pane-actions">
        {agent.role !== 'main' && <>
          <button className={tab === 'terminal' ? 'active' : ''} onClick={() => setTab('terminal')}>터미널</button>
          <button className={tab === 'diff' ? 'active' : ''} onClick={() => void openDiff()}>Git 변경</button>
        </>}
        <span className={'process-state ' + agent.processStatus}>
          {agent.processStatus === 'running' ? '터미널 실행 중' : '터미널 중단됨'}
        </span>
      </div>
    </header>
    {agent.role === 'work' && <div className="context-bar">
      <span>이어받은 설계</span>
      <strong>{agent.sourceSession ? '정확한 원본 Pi 세션 확인' : '확인 불가'}</strong>
      <details><summary>출처 보기</summary>
        <div>원본 대화: {agent.sourceSession || '없음'}</div>
        <div>분기 시점의 마지막 기록: {agent.sourceEntryId || '확인 불가'}</div>
        <div>개발 세션: {agent.sessionFile || '파일 생성 대기'}</div>
        <p>이후 Main의 새 대화가 Work Agent에 자동 전달되지는 않습니다.</p>
      </details>
    </div>}
    {agent.role === 'support' && <div className="context-bar">
      <span>독립 컨텍스트</span><strong>Main 대화 상속 없음</strong>
      <span className="small-muted">관련 작업으로만 연결되며, 출력은 Main 모델에 자동 주입되지 않습니다.</span>
    </div>}
    {error && <div role="alert" className="error-inline">{error}</div>}
    <div className="terminal-area" style={{ display: tab === 'terminal' ? 'flex' : 'none' }}>
      <TerminalPane id={agent.id} running={agent.processStatus === 'running'} bridge={bridge} />
      {agent.processStatus === 'stopped' && <div className="terminal-stop">
        <p>저장된 Pi 세션은 유지됩니다. 재개하면 기존 대화를 다시 엽니다.</p>
        <button className="primary" onClick={() => void restart()}>이 터미널 실행 / 재개</button>
      </div>}
    </div>
    {tab === 'diff' && review && <Changes review={review} shared={agent.workspace === 'shared'}/>}
    <footer className="pane-footer">
      <span>{agent.workspace === 'worktree' ? '별도 Git 작업 폴더' : '같은 Git 작업 폴더'}</span>
      <span title={agent.cwd}>{agent.cwd}</span>
      {agent.processStatus === 'running' && <button onClick={() => void bridge.stop(agent.id)}>실행 중단</button>}
    </footer>
  </section>;
}

export function App({ bridge }: { bridge: Bridge }) {
  const [state, setState] = useState<State>({ project: null, agents: [] });
  const [mainId, setMainId] = useState<string | null>(localStorage.getItem('compose.main'));
  const [otherId, setOtherId] = useState<string | null>(localStorage.getItem('compose.agent'));
  const [ratio, setRatio] = useState(50);
  const [createMode, setCreateMode] = useState<Role | null>(null);
  const [title, setTitle] = useState('');
  const [workspace, setWorkspace] = useState<Workspace>('worktree');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const off = bridge.onState(setState);
    void bridge.state().then(setState).catch(cause => setError(String(cause)));
    return () => off();
  }, [bridge]);
  useEffect(() => { if (mainId) localStorage.setItem('compose.main', mainId); }, [mainId]);
  useEffect(() => { if (otherId) localStorage.setItem('compose.agent', otherId); }, [otherId]);

  const mains = useMemo(() => state.agents.filter(a => a.role === 'main' && a.cwd === state.project), [state]);
  const main = mains.find(a => a.id === mainId) || mains[0];
  const linked = state.agents.filter(a => a.role !== 'main' && a.relatedMainId === main?.id);
  const other = linked.find(a => a.id === otherId) || linked[0];

  const action = async (run: () => Promise<void>) => {
    setError(''); setBusy(true);
    try { await run(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const openProject = () => void action(async () => {
    const chosen = await bridge.chooseProject();
    if (chosen) { setState(chosen); setMainId(null); setOtherId(null); }
  });
  const create = () => void action(async () => {
    if (createMode === null) return;
    const role = createMode;
    let id: string;
    if (role === 'main') {
      id = await bridge.createMain(title);
      setMainId(id); setOtherId(null);
    } else {
      if (!main) throw new Error('먼저 Main Agent를 선택하세요.');
      id = role === 'work'
        ? await bridge.createWork(main.id, title, workspace)
        : await bridge.createSupport(main.id, title, workspace);
      setOtherId(id);
    }
    setCreateMode(null); setTitle('');
    // Creation is an explicit user launch. Restored sessions never auto-start.
    await bridge.start(id);
  });
  const createFor = (role: Role) => {
    setWorkspace(role === 'work' ? 'worktree' : 'shared');
    setTitle(''); setCreateMode(role);
  };
  return <div className="ade-app">
    <header className="ade-topbar">
      <div className="app-mark">π</div><strong>Pi Compose</strong><span className="app-sub">ADE</span>
      <span className="project-title">{state.project?.split('/').at(-1) || 'Git 프로젝트를 선택하세요'}</span>
      <button onClick={openProject}>프로젝트 열기</button>
    </header>
    {error && <div className="error-global" role="alert">{error}<button onClick={() => setError('')}>닫기</button></div>}
    {!state.project
      ? <div className="start-screen">
          <h1>Main의 설계 맥락은 보존하고, 실제 개발은 나누어 진행합니다.</h1>
          <p>여러 Pi 터미널을 한곳에서 관리합니다. 새 채팅 UI를 재구현하지 않습니다.</p>
          <button className="primary" onClick={openProject}>Git 프로젝트 선택</button>
        </div>
      : <div className="main-layout">
        <aside className="agent-sidebar">
          <div className="sidebar-top">
            <strong>대화와 작업</strong><button title="Main Agent 생성" onClick={() => createFor('main')}>＋</button>
          </div>
          {mains.length === 0 && <p className="sidebar-empty">＋ 버튼으로 첫 Main Agent를 만드세요.</p>}
          {mains.map(m => <div className="tree-group" key={m.id}>
            <button className={'tree-main ' + (m.id === main?.id ? 'selected' : '')} onClick={() => { setMainId(m.id); setOtherId(null); }}>
              <span>◉</span><strong>{m.title}</strong></button>
            {state.agents.filter(a => a.relatedMainId === m.id).map(a => <button
              key={a.id} className={'tree-child ' + (a.id === other?.id ? 'selected' : '')}
              onClick={() => { setMainId(m.id); setOtherId(a.id); }}>
              <span>{a.role === 'work' ? '⑂' : '◇'}</span>
              <span className="tree-name">{a.title}</span>
              <span className={'status-light ' + a.processStatus}/></button>)}
          </div>)}
          <div className="sidebar-foot">Main Agent마다 독립 Pi 대화가 존재합니다. 출력과 조사 내용은 다른 Agent에 자동 전달되지 않습니다.</div>
        </aside>
        <main className="work-area">
          <div className="work-toolbar">
            <strong>작업 공간</strong>
            {main && <div className="toolbar-buttons">
              <button disabled={busy} onClick={() => createFor('work')}>＋ Work Agent</button>
              <button disabled={busy} onClick={() => createFor('support')}>＋ Support Agent</button>
            </div>}
            <label>분할 <input type="range" min="30" max="70" step="5"
              value={ratio} onChange={event => setRatio(Number(event.target.value))}/></label>
          </div>
          <div className="split-panes" style={{ gridTemplateColumns: main && other ? ratio + '% ' + (100-ratio) + '%' : '1fr' }}>
            {main ? <AgentView agent={main} bridge={bridge}/> :
              <div className="empty-pane">Main Agent를 생성해 설계를 시작하세요.</div>}
            {main && other && <AgentView agent={other} bridge={bridge}/>}
            {main && !other && <div className="empty-work">Work Agent는 설계를 이어받아 구현하고,
              Support Agent는 별도의 대화에서 조사·테스트합니다.</div>}
          </div>
        </main>
      </div>}
    <div className="ade-statusbar">실제 Pi TUI · Ghostty 기반 화면 · 세션 Fork와 독립 작업 분리</div>
    {createMode && <div className="modal-backdrop" role="presentation">
      <form className="agent-modal" onSubmit={event => { event.preventDefault(); create(); }}>
        <h2>{roleName[createMode]} 생성</h2>
        <p>{roleHelp[createMode]}</p>
        {createMode !== 'main' && <p className="info">
          {createMode === 'work'
            ? '선택한 Main의 저장된 Pi 대화를 정확히 복제합니다. 이후 작업 로그는 별도 세션에 남습니다.'
            : '선택한 Main과 작업 관계만 연결됩니다. Main의 대화는 복제하거나 자동 주입하지 않습니다.'}
        </p>}
        <label>{createMode === 'main' ? '대화 이름' : '작업 지시'}
          <textarea autoFocus required={createMode !== 'main'} rows={createMode === 'main' ? 2 : 5}
            placeholder={createMode === 'main' ? '예: 서비스 설계 / 회원가입 개선' : '이 Agent에서 수행할 작업을 작성하세요'}
            value={title} onChange={event => setTitle(event.target.value)}/></label>
        {createMode !== 'main' && <label>작업 공간
          <select value={workspace} onChange={event => setWorkspace(event.target.value as Workspace)}>
            <option value="worktree">별도 Git 작업 폴더</option>
            <option value="shared">기존 Git 작업 폴더 공유</option>
          </select>
        </label>}
        {createMode === 'work' && workspace === 'worktree' && <p className="hint">미커밋 파일은 새 Git 작업 폴더로 자동 복사되지 않습니다.</p>}
        {createMode === 'support' && workspace === 'shared' && <p className="hint">독립 컨텍스트이지만 같은 파일을 읽고 수정할 수 있습니다.</p>}
        <div className="modal-actions">
          <button type="button" onClick={() => setCreateMode(null)}>취소</button>
          <button className="primary" type="submit" disabled={busy || (createMode !== 'main' && !title.trim())}>생성하고 실행</button>
        </div>
      </form>
    </div>}
  </div>;
}
