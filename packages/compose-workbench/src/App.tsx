import { useEffect, useMemo, useState } from 'react';
import { SplitWorkspace } from './SplitWorkspace';
import { ProjectSidebar } from './ProjectSidebar';
import { GitReview, type Review } from './GitReview';
import { ContextInspector } from './ContextInspector';

export type Role = 'main' | 'work' | 'support';
type Workspace = 'shared' | 'worktree';
export type Agent = {
  id: string; role: Role; title: string; cwd: string; project?: string;
  sessionId: string; sessionFile: string | null; relatedMainId: string | null;
  sourceSession: string | null; sourceEntryId?: string | null; task?: string;
  context?: 'fork' | 'independent'; workspace: Workspace; branch?: string | null;
  processStatus: 'running' | 'stopped';
  pins?: { entryId: string; category: 'decision'|'constraint' }[];
  activity?: { phase: 'idle' | 'responding' | 'tool' | 'unknown'; tool: string | null; observedAt: number | null } | null;
};
type State = { project: string | null; projects: string[]; agents: Agent[] };
type TerminalEvent = { id: string; seq?: number; data?: string; exit?: boolean };
export type ContextDetail = {
  agentId: string; title: string; role: Role; task: string | null; sourceSession: string | null;
  sourceEntryId: string | null; sessionFile: string | null; totalMessages: number;
  messages: { id: string; role: string; text: string }[];
  pinned: { entryId: string; category: 'decision'|'constraint'; role: string;
    text: string; includedInAgent: boolean }[];
  fork: { verified: boolean; parentMatches: boolean; inheritedEntryPresent: boolean;
    snapshotFound: boolean; explanation: string } | null;
  relatedMainTitle: string | null; note: string;
};
type AuthEvent = { type: string; url?: string; instructions?: string; message?: string;
  userCode?: string; verificationUri?: string; links?: { url: string; label?: string }[] };
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
  review(id: string): Promise<Review>;
  markContext(agentId: string, entryId: string, category: 'decision'|'constraint'): Promise<ContextDetail>;
  unmarkContext(agentId: string, entryId: string): Promise<ContextDetail>;
  context(id: string): Promise<ContextDetail>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  authStatus(): Promise<{ connected: boolean; provider: string }>;
  authLogin(method: 'browser'|'device_code'): Promise<{ connected: boolean }>;
  authCancel(): Promise<void>;
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

function LoginModal({ bridge, onClose }: { bridge: Bridge; onClose(): void }) {
  const [status, setStatus] = useState('Pi 인증 상태 확인 중…');
  const [connected, setConnected] = useState(false);
  const [working, setWorking] = useState(false);
  const [method, setMethod] = useState<'browser'|'device_code'>('browser');
  const [deviceCode, setDeviceCode] = useState('');
  const [deviceUrl, setDeviceUrl] = useState('');
  const [code, setCode] = useState('');
  const [codeNeeded, setCodeNeeded] = useState(false);
  useEffect(() => {
    const off = bridge.onAuth(event => {
      if (event.type === 'auth_url') setStatus('시스템 브라우저에서 OpenAI 인증을 완료하세요.');
      else if (event.type === 'device_code') {
        setDeviceCode(event.userCode || '');
        setDeviceUrl(event.verificationUri || '');
        setStatus('브라우저에서 표시된 기기 코드를 입력해 주세요.');
      } else if (event.type === 'prompt') {
        setCodeNeeded(true);
        setStatus(event.message || '인증 결과를 입력해 주세요.');
      } else if (event.type === 'success') {
        setConnected(true); setWorking(false); setCodeNeeded(false); setStatus('OpenAI 연결 완료');
      } else if (event.type === 'error') {
        setWorking(false); setStatus(event.message || '인증에 실패했습니다. 다시 시도할 수 있습니다.');
      } else if (event.message) setStatus(event.message);
    });
    void bridge.authStatus().then(state => {
      setConnected(state.connected);
      setStatus(state.connected ? 'OpenAI 연결됨' : 'OpenAI 계정 연결 필요');
    }).catch(e => setStatus(String(e)));
    return off;
  }, [bridge]);
  const signIn = () => {
    setWorking(true);setCodeNeeded(false);setDeviceCode('');setDeviceUrl('');
    setStatus('Pi의 인증 절차를 시작합니다…');
    void bridge.authLogin(method).catch(e => {setWorking(false);setStatus(String(e));});
  };
  const close = () => {
    if (working) void bridge.authCancel().catch(()=>{});
    onClose();
  };
  return <div className="modal-backdrop" onMouseDown={e => {
    if (e.target===e.currentTarget) close();
  }}>
    <div className="login-modal login-v2" role="dialog" aria-label="Pi 로그인" aria-modal="true">
      <header><div><small>Pi Compose · 계정 연결</small><h2>Pi 모델 공급자 로그인</h2></div>
        <button title="로그인 닫기" onClick={close}>×</button></header>
      <div className="login-content">
        <p>Pi의 <code>/login</code>과 같은 인증 저장소를 사용합니다. 로그인 후 Pi 터미널도 같은 계정을 사용합니다.</p>
        <div className="provider-choice"><span className="provider-logo">◎</span>
          <div><strong>OpenAI (ChatGPT)</strong><small>{connected ? '● 연결됨' : '○ 연결되지 않음'}</small></div>
          <span>선택됨</span></div>
        <p className="fine-print">현재 ADE 계정 화면에는 OpenAI 인증을 연결했습니다. Pi 터미널의 다른 공급자 인증은 아직 이 화면에서 제공하지 않습니다.</p>
        {!connected && <><h3>로그인 방법</h3>
          <label className={'login-method ' + (method==='browser'?'chosen':'')}>
            <input type="radio" checked={method==='browser'} onChange={()=>setMethod('browser')} disabled={working}/>
            <span><strong>브라우저에서 로그인</strong><small>Pi /login의 기본 방법 · 인증 페이지 열기</small></span></label>
          <label className={'login-method ' + (method==='device_code'?'chosen':'')}>
            <input type="radio" checked={method==='device_code'} onChange={()=>setMethod('device_code')} disabled={working}/>
            <span><strong>기기 코드로 로그인</strong><small>브라우저에서 발급된 코드를 입력</small></span></label></>}
        {deviceCode && <div className="device-code" aria-label="기기 인증 코드">
          <strong>기기 코드</strong><code>{deviceCode}</code>
          <p>{deviceUrl} 주소가 브라우저에 열립니다. 코드를 입력하면 연결됩니다.</p>
        </div>}
        {codeNeeded && <form className="manual-auth" onSubmit={e=>{
          e.preventDefault();void bridge.authCode(code).then(()=>{setCodeNeeded(false);setStatus('인증 확인 중…');})
            .catch(e=>setStatus(String(e)));
        }}>
          <label>인증 결과 URL 또는 코드<input autoFocus value={code} onChange={e=>setCode(e.target.value)}
            placeholder="Pi가 요청한 인증 결과 입력"/></label>
          <button type="submit" disabled={!code.trim()}>제출</button>
        </form>}
        <p className="login-progress" role="status">{status}</p>
      </div>
      <div className="modal-actions">
        <button onClick={close}>{working ? '로그인 취소' : '닫기'}</button>
        {!connected && <button className="primary" disabled={working} onClick={signIn}>
          {working ? '인증 진행 중…' : '선택한 방법으로 로그인'}</button>}
      </div>
    </div>
  </div>;
}

export function App({ bridge }: { bridge: Bridge }) {
  const [state, setState] = useState<State>({ project: null, projects: [], agents: [] });
  const [selectedMain, setSelectedMain] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  const [pinsLoadedFor, setPinsLoadedFor] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<Role | null>(null);
  const [title, setTitle] = useState('');
  const [workspace, setWorkspace] = useState<Workspace>('worktree');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inspected, setInspected] = useState<ContextDetail | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    const off = bridge.onState(setState);
    void bridge.state().then(setState).catch(e => setError(String(e)));
    return off;
  }, [bridge]);
  useEffect(() => {
    if (state.project) {
      try {
        const saved = JSON.parse(localStorage.getItem('compose.panes.' + state.project) || '[]');
        setPinned(Array.isArray(saved) ? saved.filter((x: unknown) => typeof x === 'string') : []);
        setSelectedMain(localStorage.getItem('compose.main.' + state.project));
        setPinsLoadedFor(state.project);
      } catch { setPinned([]); setPinsLoadedFor(state.project); }
    }
  }, [state.project]);
  useEffect(() => {
    if (state.project && pinsLoadedFor === state.project) localStorage.setItem('compose.panes.' + state.project, JSON.stringify(pinned));
  }, [state.project, pinsLoadedFor, pinned]);
  useEffect(() => {
    if (state.project && selectedMain) localStorage.setItem('compose.main.' + state.project, selectedMain);
  }, [state.project, selectedMain]);

  const mains = useMemo(() => state.agents.filter(a => a.role === 'main'
    && (a.project || a.cwd) === state.project), [state]);
  const main = mains.find(a => a.id === selectedMain) || mains[0];
  const projectAgents = state.agents.filter(a => (a.project || a.cwd) === state.project);
  const visible = [
    ...(main ? [main.id] : []),
    ...(pinsLoadedFor === state.project ? pinned : []).filter(id => id !== main?.id && projectAgents.some(a => a.id === id && a.relatedMainId === main?.id)),
  ];
  const show = (id: string) => setPinned(prev => prev.includes(id) ? prev : [...prev, id]);
  const action = async (fn: () => Promise<void>) => {
    setError(''); setBusy(true);
    try { await fn(); } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const chooseProject = () => void action(async () => {
    const next = await bridge.chooseProject(); if (next) setState(next);
    setReviewId(null);
  });
  const switchProject = (path: string) => void action(async () => {
    setState(await bridge.switchProject(path)); setReviewId(null);
  });
  const launch = () => void action(async () => {
    if (!createMode) return;
    let id: string;
    if (createMode === 'main') {
      id = await bridge.createMain(title);
      setSelectedMain(id);
      setFocusId(id);
    } else {
      if (!main) throw new Error('Main Agent를 먼저 선택하세요.');
      id = createMode === 'work'
        ? await bridge.createWork(main.id, title, workspace)
        : await bridge.createSupport(main.id, title, workspace);
      show(id); setFocusId(id);
    }
    setCreateMode(null); setTitle('');
    await bridge.start(id);
  });
  const createFor = (role: Role) => {
    setCreateMode(role); setWorkspace(role === 'work' ? 'worktree' : 'shared'); setTitle('');
  };
  const inspect = (id: string) => void action(async () => setInspected({ ...await bridge.context(id), agentId: id }));

  return <div className="ade-app">
    <header className="ade-topbar new-topbar orca-app-header">
      <span className="app-mark">π</span><strong>Pi Compose</strong><span className="app-sub">ADE</span>
      <span className="project-title">{state.project ? basename(state.project) : '프로젝트 선택'}</span>
      <span className="topbar-spacer"/>
      <button className="account-button" onClick={() => setLoginOpen(true)}>계정 연결</button>
    </header>
    {error && <div role="alert" className="error-global"><span>{error}</span><button onClick={() => setError('')}>닫기</button></div>}
    {!state.project
      ? <div className="start-screen"><h1>Pi의 설계 컨텍스트를 유지하며 작업을 나눕니다.</h1>
          <p>프로젝트를 열고 Main Agent에서 시작하세요.</p>
          <button className="primary" onClick={chooseProject}>프로젝트 열기</button></div>
      : <div className="main-layout">
        <ProjectSidebar
          projects={state.projects} currentProject={state.project} agents={state.agents}
          selectedMain={main?.id || null} opened={visible}
          onProject={path => { void switchProject(path); }} onAddProject={chooseProject}
          onMain={id => { setSelectedMain(id); setReviewId(null); setFocusId(id); }}
          onAgent={id => {
            const agent = state.agents.find(a => a.id === id);
            if (agent?.relatedMainId) setSelectedMain(agent.relatedMainId);
            show(id); setFocusId(id);
          }}
          onContext={inspect} onNewMain={() => createFor('main')}
        />
        <main className="work-area orca-work-area">
          <div className="work-toolbar updated-toolbar orca-work-toolbar">
            <div className="workspace-breadcrumb">
              <small>{basename(state.project)}</small>
              <strong>{main?.title || 'Main Agent가 없습니다'}</strong>
            </div>
            <span className="workspace-count">{visible.length}개 터미널</span>
            <span className="topbar-spacer"/>
            {main && <>
              <button disabled={busy} onClick={() => createFor('work')}>＋ Work Agent</button>
              <button disabled={busy} onClick={() => createFor('support')}>＋ Support Agent</button>
            </>}
          </div>
          <nav className="agent-tabbar" aria-label="열려 있는 Agent 터미널">
            {visible.map(id => {
              const tab=state.agents.find(a=>a.id===id);
              if (!tab) return null;
              return <button className={focusId===id?'selected':''} key={id}
                title={tab.title} onClick={()=>setFocusId(id)}>
                <span className={'tab-role '+tab.role}>{tab.role==='main'?'M':tab.role==='work'?'W':'S'}</span>
                <span className="tab-name">{tab.title}</span>
                <span className={'status-light '+tab.processStatus}/>
              </button>;
            })}
          </nav>
          <div className="workbench-body">
            <SplitWorkspace agents={state.agents} visibleIds={visible} bridge={bridge} focusId={focusId}
              onRemove={id => {
                if (id === main?.id) return;
                setPinned(prev => prev.filter(x => x !== id));
                if (focusId===id) setFocusId(main?.id||null);
              }} onContext={inspect} onReview={id => setReviewId(id)}/>
            {reviewId && state.agents.some(a=>a.id===reviewId && (a.project||a.cwd)===state.project) &&
              <GitReview key={reviewId} agent={state.agents.find(a=>a.id===reviewId)!}
                bridge={bridge} onClose={()=>setReviewId(null)} />}
          </div>
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
    {inspected && <ContextInspector detail={inspected} bridge={bridge}
      onChange={setInspected} onClose={() => setInspected(null)}/>}
    {loginOpen && <LoginModal bridge={bridge} onClose={() => setLoginOpen(false)}/>}
  </div>;
}
