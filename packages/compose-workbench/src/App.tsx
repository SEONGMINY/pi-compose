import React, { useEffect, useMemo, useRef, useState } from 'react';

type Role = 'main' | 'child';
type Status = 'idle' | 'running' | 'reviewable' | 'stopped' | 'error';
type Message = { role: string; text: string };
type Session = {
  id: string; role: Role; title: string; parentId: string | null;
  cwd: string; branch: string | null; status: Status; error: string | null;
  sessionFile: string | null; messages: Message[]; stream: string;
  activity: string[]; task: string | null;
};
type State = { project: string | null; sessions: Session[] };
type Review = { diff: string; untracked: string; committed: string; dirty: string; note: string };
type Notice = { type: string; title: string; message: string; id?: string };
export type Bridge = {
  state(): Promise<State>;
  chooseProject(): Promise<State | null>;
  createMain(title: string): Promise<string>;
  createChild(id: string, task: string): Promise<string>;
  send(id: string, text: string): Promise<void>;
  stop(id: string): Promise<void>;
  review(id: string): Promise<Review>;
  onState(fn: (state: State) => void): () => void;
  onNotice(fn: (notice: Notice) => void): () => void;
  onFocus(fn: (id: string) => void): () => void;
};

const labelOf = (status: Status) => ({
  idle: '대기', running: '실행 중', reviewable: '응답 종료', stopped: '중단됨', error: '오류',
})[status];
const separator = (path: string | null) => path?.split('/').at(-1) || '프로젝트 없음';

function Transcript({ session }: { session: Session }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [session.messages.length, session.stream]);
  return <div className="transcript" aria-live="off">
    {session.messages.length === 0 && <div className="empty">
      {session.role === 'main' ? '여기서 요구사항과 구현 방향을 논의하세요.' : 'Child의 실제 Pi 실행 기록이 여기에 표시됩니다.'}
      <span>대화와 도구 실행 기록은 각각의 Pi 세션에만 저장됩니다.</span>
    </div>}
    {session.messages.map((message, i) => <div className={'message ' + message.role} key={i}>
      <div className="role-label">{message.role === 'user' ? '나' : 'Pi Agent'}</div>
      <div className="message-text">{message.text || '텍스트 없는 메시지'}</div>
    </div>)}
    {session.stream && <div className="message assistant streaming"><div className="role-label">Pi Agent · 응답 중</div>
      <div className="message-text">{session.stream}</div></div>}
    <div ref={bottomRef} />
  </div>;
}
function Composer({ session, send, disabled }: {
  session: Session; send: (id: string, text: string) => Promise<void>; disabled: boolean;
}) {
  const [value, setValue] = useState('');
  const submit = () => {
    if (!value.trim() || disabled) return;
    void send(session.id, value).then(() => setValue(''));
  };
  return <div className="composer">
    <textarea aria-label={session.role === 'main' ? 'Main에게 메시지' : 'Child에게 메시지'}
      placeholder={session.role === 'main' ? '요구사항과 설계를 논의하세요…' : '이 Child에게만 수정 지시하기…'}
      value={value} rows={3} onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
    <div className="composer-bottom">
      <span>Enter 전송 · Shift+Enter 줄바꿈</span>
      <button className="primary" disabled={disabled || !value.trim()} onClick={submit}>
        {disabled ? '응답 중…' : '전송'} <span aria-hidden="true">↗</span>
      </button>
    </div>
  </div>;
}
function Diff({ data }: { data: Review }) {
  const lines = data.diff.split('\n');
  return <div className="diff-area">
    <p className="hint">{data.note}</p>
    {data.dirty && <div className="git-status"><strong>변경 파일</strong><pre>{data.dirty}</pre></div>}
    {data.untracked && <div className="git-status"><strong>새 파일 (미추적)</strong><pre>{data.untracked}</pre></div>}
    {data.diff ? <pre className="diff-lines">{lines.map((line, i) =>
      <span className={line.startsWith('+') && !line.startsWith('+++') ? 'plus' :
        line.startsWith('-') && !line.startsWith('---') ? 'minus' :
        line.startsWith('@@') ? 'hunk' : ''} key={i}>{line}{'\n'}</span>)}</pre> :
      <div className="empty small">현재 기준으로 보여줄 추적 파일 Diff가 없습니다. 미추적 파일은 위에서 별도로 확인하세요.</div>}
    {data.committed && <details><summary>최근 Git 커밋</summary><pre>{data.committed}</pre></details>}
  </div>;
}

export function App({ bridge }: { bridge: Bridge }) {
  const [state, setState] = useState<State>({ project: null, sessions: [] });
  const [mainId, setMainId] = useState<string | null>(localStorage.getItem('compose.main'));
  const [childId, setChildId] = useState<string | null>(localStorage.getItem('compose.child'));
  const [showNewMain, setShowNewMain] = useState(false);
  const [mainTitle, setMainTitle] = useState('');
  const [showDelegate, setShowDelegate] = useState(false);
  const [task, setTask] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [mode, setMode] = useState<'conversation' | 'changes'>('conversation');
  const [ratio, setRatio] = useState(50);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const offState = bridge.onState(setState);
    const offNotice = bridge.onNotice((notice) => setError(notice.title + ': ' + notice.message));
    const offFocus = bridge.onFocus((id) => { setChildId(id); setMode('conversation'); });
    void bridge.state().then(setState).catch((cause) => setError(String(cause)));
    return () => { offState(); offNotice(); offFocus(); };
  }, []);
  useEffect(() => { if (mainId) localStorage.setItem('compose.main', mainId); }, [mainId]);
  useEffect(() => { if (childId) localStorage.setItem('compose.child', childId); }, [childId]);

  const mains = useMemo(() => state.sessions.filter((item) => item.role === 'main' && item.cwd === state.project), [state]);
  const selectedMain = mains.find((item) => item.id === mainId) || mains[0];
  const children = state.sessions.filter((item) => item.role === 'child' && mains.some((main) => main.id === item.parentId));
  const selectedChild = children.find((item) => item.id === childId) || children.find((item) => item.parentId === selectedMain?.id) || children[0];

  const perform = async (operation: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const send = async (id: string, message: string) => {
    setError('');
    try { await bridge.send(id, message); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause; }
  };
  const selectMain = (id: string) => { setMainId(id); setReview(null); setMode('conversation'); };
  const selectChild = (id: string) => { setChildId(id); setReview(null); setMode('conversation'); };
  const viewReview = async (id: string) => {
    await perform(async () => { setReview(await bridge.review(id)); setChildId(id); setMode('changes'); });
  };
  const startMain = () => void perform(async () => {
    const id = await bridge.createMain(mainTitle.trim() || '새 설계 대화');
    setMainId(id); setMainTitle(''); setShowNewMain(false);
  });
  const launch = () => {
    if (!selectedMain) return;
    void perform(async () => {
      const id = await bridge.createChild(selectedMain.id, task);
      setChildId(id); setTask(''); setShowDelegate(false); setMode('conversation'); setReview(null);
    });
  };

  const needsReview = children.filter((item) => item.status === 'reviewable').length;
  return <div className="app">
    <header className="app-header">
      <div className="brand"><div className="brand-icon">π</div><strong>Pi Compose</strong><span className="brand-sub">ADE</span></div>
      <div className="project-name">{state.project ? separator(state.project) : '프로젝트를 열어주세요'}<span className="project-path">{state.project || ''}</span></div>
      <div className="header-actions">{needsReview > 0 && <span className="attention">{needsReview}개 Child 응답 종료</span>}
        <button onClick={() => void perform(async () => { const result = await bridge.chooseProject(); if (result) { setState(result); setReview(null); } })}>프로젝트 열기</button>
      </div>
    </header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')}>닫기</button></div>}
    {!state.project ? <section className="welcome"><div className="welcome-mark">π</div>
      <h1>설계는 Main에서,<br />개발은 Child에서.</h1>
      <p>Pi의 원본 대화를 Fork해 별도 Worktree에서 구현합니다.<br />Main의 컨텍스트와 Child의 실행 로그는 섞이지 않습니다.</p>
      <button className="primary large" onClick={() => void perform(async () => {
        const result = await bridge.chooseProject(); if (result) setState(result);
      })}>Git 프로젝트 열기</button>
    </section> : <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-head"><span>설계 대화</span><button title="새 Main" aria-label="새 Main 만들기" onClick={() => setShowNewMain((current) => !current)}>＋</button></div>
        {showNewMain && <div className="inline-form"><input autoFocus placeholder="예: 회원가입 설계" value={mainTitle}
          onChange={(event) => setMainTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') startMain(); }} />
          <button className="primary" disabled={busy} onClick={startMain}>생성</button></div>}
        {mains.length === 0 && <div className="sidebar-empty">아직 Main이 없습니다.<br />＋ 버튼으로 설계 대화를 시작하세요.</div>}
        <nav aria-label="Main과 Child 대화">
          {mains.map((main) => <div key={main.id} className="thread">
            <button className={'session-link main-link ' + (selectedMain?.id === main.id ? 'selected' : '')}
              onClick={() => selectMain(main.id)}><span className="session-icon">◉</span>
              <span className="truncate">{main.title}</span><span className={'state-dot ' + main.status} /></button>
            {children.filter((child) => child.parentId === main.id).map((child) => <button key={child.id}
              className={'session-link child-link ' + (selectedChild?.id === child.id ? 'selected-child' : '')}
              onClick={() => selectChild(child.id)}><span className="session-icon">↳</span><span className="truncate">{child.title}</span>
              <span className={'state-dot ' + child.status} /></button>)}
          </div>)}
        </nav>
        <div className="sidebar-foot"><div className="side-caption">실행 정책</div>
          <p>Main 대화는 그대로 유지됩니다.<br />앱 종료 시 Agent를 중단하고 세션과 코드는 보존합니다.</p></div>
      </aside>
      <main className="stage">
        <div className="stage-top"><div><strong>개발 작업 공간</strong><span className="top-hint">Main과 Child를 동시에 관찰</span></div>
          <label className="split-control">화면 비율 <input aria-label="화면 분할 비율" type="range" min="30" max="70" step="5"
            value={ratio} onChange={(event) => setRatio(Number(event.target.value))} /></label></div>
        <div className="panes" style={{ gridTemplateColumns: ratio + '% ' + (100 - ratio) + '%' }}>
          <section className="pane">
            {selectedMain ? <>
              <div className="pane-header">
                <div className="pane-ident"><span className="role-pill">MAIN</span><div><h2>{selectedMain.title}</h2><span>원본 설계 컨텍스트 · {labelOf(selectedMain.status)}</span></div></div>
                <button className="primary" onClick={() => setShowDelegate((show) => !show)} disabled={busy}>Child에 위임 ＋</button>
              </div>
              {showDelegate && <div className="delegate-form">
                <strong>현재 Main에서 정확하게 Fork</strong>
                <p>저장된 이 대화의 설계 맥락을 별도 Child와 새 Git Worktree에 전달합니다. Main은 변경하지 않습니다. 원본 작업 폴더의 미커밋 파일은 Worktree에 복사되지 않습니다.</p>
                <textarea rows={4} autoFocus placeholder="개발할 작업을 설명하세요…" value={task} onChange={(event) => setTask(event.target.value)} />
                <div className="form-actions"><button onClick={() => setShowDelegate(false)}>취소</button>
                  <button className="primary" disabled={!task.trim() || busy || selectedMain.status === 'running'} onClick={launch}>Fork하고 개발 시작</button></div>
              </div>}
              <Transcript session={selectedMain}/>
              <Composer key={selectedMain.id} session={selectedMain} send={send} disabled={selectedMain.status === 'running'} />
            </> : <div className="empty-pane"><h2>새로운 Main으로 시작하세요</h2><p>설계 주제마다 대화를 분리해 컨텍스트를 관리할 수 있습니다.</p>
              <button className="primary" onClick={() => setShowNewMain(true)}>Main 만들기</button></div>}
          </section>
          <section className="pane child-pane">
            {selectedChild ? <>
              <div className="pane-header"><div className="pane-ident"><span className="role-pill child">CHILD</span>
                <div><h2>{selectedChild.title}</h2><span>{labelOf(selectedChild.status)} · {selectedChild.branch || '작업 디렉터리'}</span></div></div>
                <div className="actions"><button className={mode === 'conversation' ? 'active' : ''} onClick={() => setMode('conversation')}>실행</button>
                  <button className={mode === 'changes' ? 'active' : ''} onClick={() => void viewReview(selectedChild.id)}>변경 파일</button></div></div>
              <div className="task-strip"><div className="task-head"><span className="task-icon">☷</span><strong>현재 작업</strong><span className={'status-text ' + selectedChild.status}>{labelOf(selectedChild.status)}</span></div>
                <p>{selectedChild.task || '개발 작업 정보 없음'}</p>
                <span className="task-note">세부 TODO는 Child가 실제로 제공할 때 표시합니다. 완료를 추측하지 않습니다.</span></div>
              {mode === 'changes' && review ? <Diff data={review}/> : <div className="child-content">
                <Transcript session={selectedChild} />
                {selectedChild.activity.length > 0 && <details className="activity-log" open>
                  <summary>실제 도구 실행 기록 ({selectedChild.activity.length})</summary>
                  <pre>{selectedChild.activity.join('\n')}</pre>
                </details>}
              </div>}
              <div className="child-footer"><Composer key={selectedChild.id} session={selectedChild} send={send}
                disabled={selectedChild.status === 'running'}/>
                {selectedChild.status === 'running' && <button className="stop-button" disabled={busy}
                  onClick={() => void perform(async () => { await bridge.stop(selectedChild.id); })}>실행 중단</button>}
              </div>
            </> : <div className="empty-pane"><div className="empty-symbol">↳</div><h2>아직 Child가 없습니다</h2>
              <p>Main에서 구현을 위임하면 실제 Pi Fork와 Child의 실행 내용이 여기에 표시됩니다.</p></div>}
          </section>
        </div>
      </main>
    </div>}
    <footer className="app-footer"><span>Pi SDK · Git Worktree</span>
      <span>응답 종료 ≠ 구현 검증 · Main 컨텍스트 자동 주입 없음</span></footer>
  </div>;
}


