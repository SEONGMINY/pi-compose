import { useState } from 'react';
import type { Bridge, ContextDetail } from './App';

const roleLabel = { main: 'Main Agent', work: 'Work Agent', support: 'Support Agent' };
const typeLabel = { decision: '결정', constraint: '반드시 지킬 제약' };

export function ContextInspector({ detail, bridge, onChange, onClose }: {
  detail: ContextDetail; bridge: Bridge; onChange(detail: ContextDetail): void; onClose(): void;
}) {
  const [view, setView] = useState<'key' | 'history'>('key');
  const [error, setError] = useState('');
  const [marking, setMarking] = useState<string | null>(null);
  const mark = async (entryId: string, type: 'decision' | 'constraint' | 'remove') => {
    setError(''); setMarking(entryId);
    try {
      const next = type === 'remove'
        ? await bridge.unmarkContext(detail.agentId, entryId)
        : await bridge.markContext(detail.agentId, entryId, type);
      onChange(next);
    } catch (e) { setError(String(e)); }
    finally { setMarking(null); }
  };
  return <div className="inspector-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="context-inspector context-v2" aria-label="컨텍스트 확인">
      <header>
        <div><small>{roleLabel[detail.role]} · 실제 Pi 세션</small><h2>{detail.title}</h2></div>
        <button aria-label="맥락 닫기" onClick={onClose}>×</button>
      </header>
      <div className="context-switch">
        <button className={view === 'key' ? 'active' : ''} onClick={() => setView('key')}>핵심 맥락</button>
        <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>
          원본 대화 ({detail.totalMessages})
        </button>
      </div>
      {error && <div className="review-error" role="alert">{error}</div>}
      <div className="context-scroll">
        {view === 'key' && <>
          {detail.role === 'main' && <div className="context-why">
            <strong>이 Main에 쌓인 고품질 맥락은 무엇인가요?</strong>
            <p>설계한 이유·거절한 대안·반드시 지킬 제약은 <b>Pi 원본 대화에 보존</b>됩니다.
              아래는 그중 사용자가 명시적으로 표시한 결정과 제약입니다. 자동 생성된 요약은 아닙니다.</p>
            <button onClick={() => setView('history')}>원본 대화에서 중요한 내용 표시하기</button>
          </div>}
          {detail.role === 'work' && <div className={'fork-proof '+(detail.fork?.verified ? 'verified' : 'unverified')}>
            <strong>{detail.fork?.verified ? '✓ 원본 맥락의 Fork 기록 확인됨' : '⚠ Fork 맥락 확인 필요'}</strong>
            <p>{detail.fork?.verified
              ? '원본 Pi 세션 경로가 일치하고 분기 시점 기록이 실제 Work 대화에 들어 있습니다.'
              : '원본 경로나 상속된 분기 기록 중 확인되지 않은 항목이 있습니다. 원본과 대조해 주세요.'}</p>
            <dl>
              <dt>원본 대화</dt><dd>{detail.relatedMainTitle || '확인되지 않음'}</dd>
              <dt>원본 세션</dt><dd title={detail.sourceSession || ''}>{detail.sourceSession || '없음'}</dd>
              <dt>Fork 분기 기록</dt><dd>{detail.sourceEntryId || '확인되지 않음'}</dd>
              <dt>원본 계보</dt><dd>{detail.fork?.parentMatches ? '일치' : '미확인'}</dd>
              <dt>분기 시점 기록 포함</dt><dd>{detail.fork?.inheritedEntryPresent ? '확인됨' : '미확인'}</dd>
              <dt>원본 기록 대조</dt><dd>{detail.fork?.matchedCount ?? 0} / {detail.fork?.expectedCount ?? 0}개
                {detail.fork?.completeCopyVerified ? ' · 모두 일치' : ' · 추가 확인 필요'}</dd>
            </dl>
            <p className="fine-print">{detail.fork?.explanation}</p>
          </div>}
          {detail.role === 'support' && <div className="context-why">
            <strong>독립 컨텍스트</strong>
            <p>이 Agent에는 Main 대화가 복제되지 않았습니다. 관련 Main 아래에 보이는 것은 작업의 관계일 뿐,
              설계 기록의 상속 관계가 아닙니다.</p>
          </div>}
          {detail.task && <div className="context-task-box"><strong>실제 전달한 지시</strong><p>{detail.task}</p></div>}
          {detail.role !== 'support' && <div className="pin-section">
            <div className="pin-heading"><strong>직접 표시한 결정과 제약</strong>
              <span>{detail.pinned.filter(pin=>detail.role==='main'||pin.includedInAgent).length}개</span></div>
            {!detail.pinned.length && <div className="context-no-pins">
              <strong>아직 표시한 핵심 결정이 없습니다.</strong>
              <p>이것은 설계 내용이 없다는 뜻이 아닙니다. 원본 대화에서 중요한 메시지를 선택해 표시하면
                여기에서 쉽게 찾을 수 있습니다.</p>
              {detail.role === 'main' && <button onClick={() => setView('history')}>원본 대화에서 표시</button>}
            </div>}
            {detail.pinned.map(pin=><div key={pin.entryId} className="pin-card">
              <div className="pin-label"><span>{typeLabel[pin.category]}</span>
                {detail.role === 'work' && <small>{pin.includedInAgent ? 'Fork에 포함된 기록' : 'Fork 이후 결정 — 자동 전달되지 않음'}</small>}
                {detail.role === 'main' && <button disabled={marking===pin.entryId}
                  onClick={()=>void mark(pin.entryId,'remove')}>표시 해제</button>}</div>
              <p>{pin.text}</p>
            </div>)}
          </div>}
          <div className="context-help"><strong>확인할 수 있는 것과 없는 것</strong>
            <p>Pi 대화와 Fork 계보는 확인할 수 있습니다. 모델이 모든 의사결정의 의미를 이해하고
              코드를 정확히 구현했는지는 이 정보만으로 보장할 수 없습니다.</p></div>
        </>}
        {view === 'history' && <>
          <p className="fine-print">{detail.note}</p>
          {!detail.messages.length && <div className="context-no-pins">아직 저장된 Pi 대화가 없습니다.
            <p>터미널에서 Main Agent와 설계를 논의한 뒤 다시 확인해 주세요.</p></div>}
          {detail.messages.map(msg => <div className="history-entry evidence-message" key={msg.id}>
            <div className="history-message-head"><strong>{msg.role === 'user' ? '사용자' : 'Pi Agent'}</strong>
              {detail.role === 'main' && <div className="evidence-actions">
                <button disabled={marking === msg.id} onClick={() => void mark(msg.id, 'decision')}>결정 표시</button>
                <button disabled={marking === msg.id} onClick={() => void mark(msg.id, 'constraint')}>제약 표시</button>
              </div>}
            </div><p>{msg.text}</p>
          </div>)}
        </>}
      </div>
    </aside>
  </div>;
}
