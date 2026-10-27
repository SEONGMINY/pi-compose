import { useEffect, useState } from 'react';
import { TerminalPane } from './TerminalPane';
import type { Agent, Bridge } from './App';

const names = { main: 'Main Agent', work: 'Work Agent', support: 'Support Agent' };

export function AgentPanel({ agent, bridge, visible, onClose, onContext }: {
  agent: Agent; bridge: Bridge; visible: boolean;
  onClose: () => void; onContext: () => void;
}) {
  const [tab, setTab] = useState<'terminal' | 'diff'>('terminal');
  const [diff, setDiff] = useState<Awaited<ReturnType<Bridge['review']>> | null>(null);
  const [error, setError] = useState('');
  const showDiff = async () => {
    setError('');
    try { setDiff(await bridge.review(agent.id)); setTab('diff'); }
    catch (e) { setError(String(e)); }
  };
  const restart = async () => {
    try { await bridge.start(agent.id); setTab('terminal'); setError(''); }
    catch (e) { setError(String(e)); }
  };
  // Offscreen panels stay mounted so their terminal buffers are never reconstructed
  // from an arbitrary tail of ANSI bytes.
  return <section className="multi-agent-panel">
    <header className="panel-bar">
      <div className="panel-heading">
        <span className={'kind ' + agent.role}>{names[agent.role]}</span>
        <strong title={agent.title}>{agent.title}</strong>
        <span className="panel-sub">
          {agent.role === 'work' ? '설계 이어받음' : agent.role === 'support' ? '독립 컨텍스트' : '설계·의사결정'}
          {' · '}{agent.processStatus === 'running' ? '터미널 실행 중' : '터미널 중단됨'}
        </span>
      </div>
      <div className="panel-commands">
        <button title="실제 세션 기록과 맥락 확인" onClick={onContext}>맥락</button>
        {agent.role !== 'main' && <button title="실제 Git 변경 확인" onClick={() => void showDiff()}>변경</button>}
        {tab === 'diff' && <button onClick={() => setTab('terminal')}>터미널</button>}
        {agent.role !== 'main' && <button title="화면에서 닫기 (Agent는 계속 실행)" onClick={onClose}>×</button>}
      </div>
    </header>
    {error && <div className="error-inline" role="alert">{error}</div>}
    <div className="panel-console" style={{ visibility: tab === 'terminal' ? 'visible' : 'hidden' }}>
      <TerminalPane id={agent.id} running={agent.processStatus === 'running'}
        visible={visible && tab === 'terminal'} bridge={bridge}/>
      {agent.processStatus === 'stopped' && <div className="terminal-stop">
        <p>세션과 Git 변경은 보존됩니다.</p>
        <button className="primary" onClick={() => void restart()}>Pi 터미널 열기</button>
      </div>}
    </div>
    {tab === 'diff' && <div className="panel-diff">
      {diff ? <>
        <p>Git 기준 커밋: {diff.baseSha.slice(0, 12)}</p>
        {agent.workspace === 'shared' && <p>같은 폴더의 변경은 Agent별로 귀속할 수 없습니다.</p>}
        <h4>변경 파일</h4><pre>{diff.status || '없음'}</pre>
        {diff.untracked && <><h4>새 파일</h4><pre>{diff.untracked}</pre></>}
        <h4>코드 변경</h4><pre className="raw-diff">{diff.diff || '변경된 추적 파일 없음'}</pre>
        <p>코드 변경은 구현 완료 또는 계약 준수의 증거가 아닙니다.</p>
      </> : 'Git 정보를 불러오는 중입니다.'}
    </div>}
    <footer className="panel-path" title={agent.cwd}>
      {agent.workspace === 'worktree' ? '별도 작업 폴더' : '공유 폴더'} · {agent.cwd}
    </footer>
  </section>;
}
