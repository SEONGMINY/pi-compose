import { useState } from 'react';
import { TerminalPane } from './TerminalPane';
import type { Agent, Bridge } from './App';

const names = { main: 'Main Agent', work: 'Work Agent', support: 'Support Agent' };

export function AgentPanel({ agent, bridge, visible, onClose, onContext, onReview }: {
  agent: Agent; bridge: Bridge; visible: boolean;
  onClose: () => void; onContext: () => void; onReview: () => void;
}) {
  const [error, setError] = useState('');
  const restart = async () => {
    try { await bridge.start(agent.id); setError(''); }
    catch (e) { setError(String(e)); }
  };
  const activity = agent.processStatus === 'stopped' ? '중단됨'
    : agent.activity?.phase === 'tool' ? '도구 실행: ' + (agent.activity.tool || '확인 중')
    : agent.activity?.phase === 'responding' ? '모델 응답 중'
    : agent.activity?.phase === 'idle' ? '입력 대기' : '터미널 실행 중';
  return <section className="multi-agent-panel">
    <header className="panel-bar">
      <div className="panel-heading">
        <span className={'kind ' + agent.role}>{names[agent.role]}</span>
        <strong title={agent.title}>{agent.title}</strong>
        <span className="panel-sub">{activity} · {agent.role==='work' ? 'Main Fork' :
          agent.role==='support' ? '독립 대화' : '원본 설계'}</span>
      </div>
      <div className="panel-commands">
        <button title="원본 컨텍스트·결정·출처 확인" onClick={onContext}>맥락</button>
        {agent.role !== 'main' && <button title="오른쪽에서 Git 파일별 변경 검토" onClick={onReview}>변경</button>}
        {agent.role !== 'main' && <button title="화면에서 닫기 (Agent는 계속 실행)" onClick={onClose}>×</button>}
      </div>
    </header>
    {error && <div className="error-inline" role="alert">{error}</div>}
    <div className="panel-console">
      <TerminalPane id={agent.id} running={agent.processStatus === 'running'} visible={visible} bridge={bridge}/>
      {agent.processStatus === 'stopped' && <div className="terminal-stop">
        <strong>터미널이 중단되었습니다</strong><p>Pi 대화와 Git 변경은 그대로 보존됩니다.</p>
        <button className="primary" onClick={() => void restart()}>기존 Pi 대화 다시 열기</button>
      </div>}
    </div>
    <footer className="panel-path" title={agent.cwd}>
      {agent.workspace === 'worktree' ? '별도 작업 폴더' : '공유 폴더'} · {agent.cwd}
    </footer>
  </section>;
}
