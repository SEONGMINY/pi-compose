import { useEffect, useMemo, useState } from 'react';
import { SplitWorkspace } from './SplitWorkspace';

export type Role = 'main' | 'work' | 'support';
type Workspace = 'shared' | 'worktree';
export type Agent = {
  id: string; role: Role; title: string; cwd: string; project?: string;
  sessionId: string; sessionFile: string | null; relatedMainId: string | null;
  sourceSession: string | null; sourceEntryId?: string | null; task?: string;
  context?: 'fork' | 'independent'; workspace: Workspace; branch?: string | null;
  processStatus: 'running' | 'stopped';
};
type State = { project: string | null; projects: string[]; agents: Agent[] };
type TerminalEvent = { id: string; seq?: number; data?: string; exit?: boolean };
type ContextDetail = {
  title: string; role: Role; task: string | null; sourceSession: string | null;
  sourceEntryId: string | null; sessionFile: string | null; totalMessages: number;
  messages: { role: string; text: string }[]; relatedMainTitle: string | null; note: string;
};
type AuthEvent = { type: string; url?: string; instructions?: string; message?: string };
export type Bridge = {
  state(): Promise<State>;
  chooseProject(): Promise<State | null>;
  switchProject(path: string): Promise<State>;
  createMain(title: string): Promise<string>;
  createWork(mainId: string, task: string, workspace: Workspace): Promise<string>;
  createSupport(mainId: string, task: string, workspace: Workspace): Promise<string>;
  start(id: string): Promise<{ seq: number; buffer: string; running: boolean }>;
  attach(id: string): Promise<{ seq: number; buffer: string; running: boolean }>;
  stop(id: string): Promise<void>;
  review(id: string): Promise<{ diff: string; status: string; untracked: string; baseSha: string }>;
  context(id: string): Promise<ContextDetail>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  authStatus(): Promise<{ connected: boolean; provider: string }>;
  authLogin(): Promise<{ connected: boolean }>;
  authCode(code: string): Promise<void>;
  onAuth(fn: (event: AuthEvent) => void): () => void;
  onTerminal(fn: (event: TerminalEvent) => void): () => void;
  onState(fn: (state: State) => void): () => void;
};
const roles = { main: 'Main Agent', work: 'Work Agent', support: 'Support Agent' };
const roleDesc = {
  main: '요구사항, 설계, 의사결정을 위한 독립적인 대화',
  work: '선택한 Main의 실제 대화에서 Fork해 개발',
  support: 'Main을 상속하지 않는 별도 대화로 조사, 테스트, 검증',
};
const basename = (path: string) => path.split('/').filter(Boolean).at(-1) || path;

function ContextDrawer({ detail, onClose }: { detail: ContextDetail; onClose(): void }) {
  return <div className="inspector-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="context-inspector" aria-label="Agent 컨텍스트 확인">
      <header><div><small>실제 Pi 세션</small><h2>{detail.title}</h2></div>
        <button onClick={onClose} aria-label="컨텍스트 창 닫기">×</button></header>
      <section>
        <div className="info-heading">{roles[detail.role]}</div>
        <p>{detail.role === 'main' ? '설계와 의사결정의 원본 대화입니다.' :
          detail.role === 'work' ? '아래 Main 대화의 저장 기록을 이어받았습니다.' :
            '기존 Main 대화를 이어받지 않는 독립 컨텍스트입니다.'}</p>
        {detail.task && <><h3>실제 작업 지시</h3><p className="context-task">{detail.task}</p></>}
        {detail.relatedMainTitle && <p>관련 Main: <strong>{detail.relatedMainTitle}</strong></p>}
        {detail.sourceSession && <><h3>Fork 원본</h3><code>{detail.sourceSession}</code>
          <p>분기 시점 마지막 기록: {detail.sourceEntryId || '미확인'}</p></>}
        <details><summary>Pi 대화 파일</summary><code>{detail.sessionFile || '아직 저장된 대화가 없습니다.'}</code></details>
      </section>
      <section className="history">
        <div className="info-heading">대화 기록 · {detail.totalMessages}건</div>
        <p className="fine-print">{detail.note}</p>
        {detail.messages.length === 0 && <p>아직 저장된 Pi 대화 메시지가 없습니다.</p>}
        {detail.messages.map((m, i) => <div className="history-entry" key={i}>
          <span>{m.role === 'user' ? '사용자 입력' : 'Pi 응답'}</span>
          <p>{m.text}</p>
        </div>)}
      </section>
    </aside>
  </div>;
}

function LoginModal({ bridge, onClose }: { bridge: Bridge; onClose(): void }) {
  const [status, setStatus] = useState('인증 상태 확인 중…');
  const [connected, setConnected] = useState(false);
  const [working, setWorking] = useState(false);
  const [code, setCode] = useState('');
  const [codeNeeded, setCodeNeeded] = useState(false);
  useEffect(() => {
    const off = bridge.onAuth(event => {
      if (event.type === 'auth_url') setStatus('브라우저에서 OpenAI 로그인을 완료해 주세요.');
      else if (event.type === 'prompt') { setStatus(event.message || '브라우저에서 받은 코드를 입력해 주세요.'); setCodeNeeded(true); }
      else if (event.type === 'success') { setConnected(true); setWorking(false); setCodeNeeded(false); setStatus('로그인이 완료됐습니다.'); }
      else if (event.type === 'error') { setWorking(false); setStatus(event.message || '로그인 실패'); }
      else if (event.message) setStatus(event.message);
    });
    void bridge.authStatus().then(s => {
      setConnected(s.connected);
      setStatus(s.connected ? 'OpenAI 계정 연결됨' : 'OpenAI 계정 연결 필요');
    }).catch(e => setStatus(String(e)));
    return off;
  }, [bridge]);
  const login = async () => {
    setWorking(true); setCodeNeeded(false);
    setStatus('OpenAI 인증을 시작합니다…');
    try { await bridge.authLogin(); }
    catch(e) { setWorking(false); setStatus(String(e)); }
  };
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="login-modal" role="dialog" aria-label="OpenAI 로그인">
      <header><div><small>계정 연결</small><h2>OpenAI · ChatGPT</h2></div><button onClick={onClose}>×</button></header>
      <p>Pi의 공식 인증 흐름으로 로그인합니다. 비밀번호나 토큰을 Pi Compose 화면에 저장하지 않습니다.</p>
      <div className="auth-state">{connected ? '● 연결됨' : working ? '◌ 인증 중' : '○ 연결되지 않음'}</div>
      <p role="status">{status}</p>
      {codeNeeded && <form onSubmit={e => {
        e.preventDefault();
        void bridge.authCode(code).then(() => { setCodeNeeded(false); setStatus('인증 확인 중…'); }).catch(e => setStatus(String(e)));
      }}><label>인증 결과 URL 또는 코드<input value={code} onChange={e => setCode(e.target.value)}
          placeholder="브라우저에 표시된 인증 결과" autoFocus/></label>
        <button type="submit" disabled={!code.trim()}>인증 제출</button></form>}
      <div className="modal-actions">
        <button onClick={onClose}>닫기</button>
        {!connected && <button className="primary" disabled={working} onClick={() => void login()}>브라우저에서 로그인</button>}
      </div>
    </div>
  </div>;
}

export function App({ bridge }: { bridge: Bridge }) {
  const [state, setState] = useState<State>({ project: null, projects: [], agents: [] });
  const [selectedMain, setSelectedMain] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  const [createMode, setCreateMode] = useState<Role | null>(null);
  const [title, setTitle] = useState('');
  const [workspace, setWorkspace] = useState<Workspace>('worktree');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inspected, setInspected] = useState<ContextDetail | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);

  useEffect(() => {
    const off = bridge.onState(setState);
    void bridge.state().then(setState).catch(e => setError(String(e)));
    return off;
  }, [bridge]);
  useEffect(() => {
    if (state.project) {
      try {
        const saved = JSON.parse(localStorage.getItem('compose.panes.' + state.project) || '[]');
        setPinned(Array.isArray(saved) ? saved.filter(x => typeof x === 'string') : []);
        setSelectedMain(localStorage.getItem('compose.main.' + state.project));
      } catch { setPinned([]); }
    }
  }, [state.project]);
  useEffect(() => {
    if (state.project) localStorage.setItem('compose.panes.' + state.project, JSON.stringify(pinned));
  }, [state.project, pinned]);
  useEffect(() => {
    if (state.project && selectedMain) localStorage.setItem('compose.main.' + state.project, selectedMain);
  }, [state.project, selectedMain]);

  const mains = useMemo(() => state.agents.filter(a => a.role === 'main'
    && (a.project || a.cwd) === state.project), [state]);
  const main = mains.find(a => a.id === selectedMain) || mains[0];
  const projectAgents = state.agents.filter(a => (a.project || a.cwd) === state.project);
  const visible = [
    ...(main ? [main.id] : []),
    ...pinned.filter(id => id !== main?.id && projectAgents.some(a => a.id === id)),
  ];
  const show = (id: string) => setPinned(prev => prev.includes(id) ? prev : [...prev, id]);
  const action = async (fn: () => Promise<void>) => {
    setError(''); setBusy(true);
    try { await fn(); } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const chooseProject = () => void action(async () => {
    const next = await bridge.chooseProject(); if (next) setState(next);
    setProjectMenu(false);
  });
  const switchProject = (path: string) => void action(async () => {
    setState(await bridge.switchProject(path)); setProjectMenu(false);
  });
  const launch = () => void action(async () => {
    if (!createMode) return;
    let id: string;
    if (createMode === 'main') {
      id = await bridge.createMain(title);
      setSelectedMain(id);
    } else {
      if (!main) throw new Error('Main Agent를 먼저 선택하세요.');
      id = createMode === 'work'
        ? await bridge.createWork(main.id, title, workspace)
        : await bridge.createSupport(main.id, title, workspace);
      show(id);
    }
    setCreateMode(null); setTitle('');
    await bridge.start(id);
  });
  const createFor = (role: Role) => {
    setCreateMode(role); setWorkspace(role === 'work' ? 'worktree' : 'shared'); setTitle('');
  };
  const inspect = (id: string) => void action(async () => setInspected(await bridge.context(id)));

  return <div className="ade-app">
    <header className="ade-topbar new-topbar">
      <span className="app-mark">π</span><strong>Pi Compose</strong><span className="app-sub">ADE</span>
      <div className="project-switcher">
        <button onClick={() => setProjectMenu(!projectMenu)}>
          {state.project ? basename(state.project) : '프로젝트 선택'} <span>⌄</span>
        </button>
        {projectMenu && <div className="project-dropdown">
          <h4>프로젝트</h4>
          {state.projects.map(path => <button key={path} onClick={() => switchProject(path)}
            className={path === state.project ? 'chosen' : ''}>
            <strong>{basename(path)}</strong><small>{path}</small>
          </button>)}
          <button className="add-project" onClick={chooseProject}>＋ 다른 프로젝트 열기</button>
        </div>}
      </div>
      <span className="topbar-spacer"/>
      <button onClick={() => setLoginOpen(true)}>계정 · 로그인</button>
    </header>
    {error && <div role="alert" className="error-global"><span>{error}</span><button onClick={() => setError('')}>닫기</button></div>}
    {!state.project
      ? <div className="start-screen"><h1>Pi의 설계 컨텍스트를 유지하며 작업을 나눕니다.</h1>
          <p>프로젝트를 열고 Main Agent에서 시작하세요.</p>
          <button className="primary" onClick={chooseProject}>프로젝트 열기</button></div>
      : <div className="main-layout">
        <aside className="agent-sidebar">
          <div className="sidebar-top"><strong>대화와 작업</strong>
            <button title="새 Main Agent" onClick={() => createFor('main')}>＋</button></div>
          {mains.length === 0 && <p className="sidebar-empty">＋ 버튼으로 첫 Main Agent를 만들어 주세요.</p>}
          {mains.map(m => <div className="tree-group" key={m.id}>
            <div className={'main-row ' + (main?.id === m.id ? 'chosen' : '')}>
              <button onClick={() => setSelectedMain(m.id)} title="메인 대화 보기">
                <span className="tree-icon">◉</span><strong>{m.title}</strong></button>
              <button className="row-context" title="실제 메인 대화 맥락 확인" onClick={() => inspect(m.id)}>맥락</button>
            </div>
            {state.agents.filter(a => a.relatedMainId === m.id).map(a =>
              <div key={a.id} className={'child-row ' + (visible.includes(a.id) ? 'is-open' : '')}>
                <button onClick={() => { setSelectedMain(m.id); show(a.id); }}
                  title={a.role === 'work' ? '설계 이어받은 작업' : '독립 조사 작업'}>
                  <span className={'mini-kind ' + a.role}>{a.role === 'work' ? 'W' : 'S'}</span>
                  <span className="child-name">{a.title}</span></button>
                <span className={'status-light '+a.processStatus}/>
              </div>)}
          </div>)}
          <div className="sidebar-foot">대화는 Pi에 보존됩니다. 다른 Agent의 실행 기록은 Main에 자동 추가하지 않습니다.</div>
        </aside>
        <main className="work-area">
          <div className="work-toolbar updated-toolbar">
            <strong>작업 공간</strong>
            <span className="workspace-count">{visible.length}개 터미널</span>
            <span className="topbar-spacer"/>
            {main && <>
              <button disabled={busy} onClick={() => createFor('work')}>＋ Work Agent</button>
              <button disabled={busy} onClick={() => createFor('support')}>＋ Support Agent</button>
            </>}
          </div>
          <SplitWorkspace agents={state.agents} visibleIds={visible} bridge={bridge}
            onRemove={id => {
              if (id === main?.id) return;
              setPinned(prev => prev.filter(x => x !== id));
            }} onContext={inspect}/>
        </main>
      </div>}
    <footer className="ade-statusbar">Main: 설계·결정 · Work: 정확한 Fork · Support: 독립 컨텍스트 · 각 터미널은 실제 Pi 프로세스</footer>

    {createMode && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setCreateMode(null); }}>
      <form className="agent-modal" onSubmit={e => { e.preventDefault(); launch(); }}>
        <h2>{roles[createMode]} 생성</h2><p>{roleDesc[createMode]}</p>
        <label>{createMode === 'main' ? '대화 이름' : '실제 작업 지시'}
          <textarea autoFocus rows={createMode === 'main' ? 2 : 5} required={createMode !== 'main'}
            placeholder={createMode === 'main' ? '예: 회원가입 설계' : '실제 수행할 작업을 입력하세요'}
            value={title} onChange={e => setTitle(e.target.value)}/></label>
        {createMode !== 'main' && <label>작업 폴더
          <select value={workspace} onChange={e => setWorkspace(e.target.value as Workspace)}>
            <option value="worktree">별도 Git 작업 폴더</option>
            <option value="shared">현재 작업 폴더 공유</option>
          </select></label>}
        <p className="fine-print">{createMode === 'work'
          ? 'Main의 정확한 저장 대화에서 분기합니다. 이후 변경된 Main의 결정은 자동으로 전달되지 않습니다.'
          : createMode === 'support'
            ? 'Main의 대화 내용은 복제하지 않습니다. 작업 관계만 연결됩니다.'
            : '여러 Main을 기능·작업 또는 프로덕트 단위로 만들 수 있습니다.'}</p>
        <div className="modal-actions"><button type="button" onClick={() => setCreateMode(null)}>취소</button>
          <button className="primary" type="submit" disabled={busy || (createMode !== 'main' && !title.trim())}>생성하고 실행</button></div>
      </form></div>}
    {inspected && <ContextDrawer detail={inspected} onClose={() => setInspected(null)}/>}
    {loginOpen && <LoginModal bridge={bridge} onClose={() => setLoginOpen(false)}/>}
  </div>;
}
