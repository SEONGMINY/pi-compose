import { useEffect, useMemo, useRef, useState } from 'react';
import { AgentPanel } from './AgentPanel';
import type { Agent, Bridge } from './App';

export function SplitWorkspace({ agents, visibleIds, bridge, onRemove, onContext }: {
  agents: Agent[]; visibleIds: string[]; bridge: Bridge;
  onRemove(id: string): void; onContext(id: string): void;
}) {
  const [visited, setVisited] = useState<string[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const parent = useRef<HTMLDivElement>(null);
  const opened = visibleIds.filter(id => agents.some(a => a.id === id));
  useEffect(() => {
    setVisited(prev => [...prev, ...opened.filter(id => !prev.includes(id))]);
  }, [visibleIds.join('|'), agents.length]);
  const shown = useMemo(() => new Set(opened), [opened.join('|')]);
  const current = opened.map(id => weights[id] ?? 1);
  const gutter = 7;
  const columns = opened.flatMap((id, i) =>
    i < opened.length - 1 ? [current[i] + 'fr', gutter + 'px'] : [current[i] + 'fr']).join(' ');
  const onDragStart = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (!parent.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const left = opened[index], right = opened[index + 1];
    const startLeft = weights[left] ?? 1, startRight = weights[right] ?? 1;
    const sum = opened.reduce((n, id) => n + (weights[id] ?? 1), 0);
    const available = Math.max(parent.current.clientWidth, opened.length * 340) - (opened.length - 1) * gutter;
    const leftMin = (260 / available) * sum;
    const move = (e: PointerEvent) => {
      const change = (e.clientX - startX) / available * sum;
      const value = Math.max(leftMin, Math.min(startLeft + startRight - leftMin, startLeft + change));
      setWeights(w => ({ ...w, [left]: value, [right]: startLeft + startRight - value }));
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  const nudge = (index: number, delta: number) => {
    const left = opened[index], right = opened[index + 1];
    setWeights(w => {
      const l = w[left] ?? 1, r = w[right] ?? 1;
      const d = delta * (l + r);
      return { ...w, [left]: Math.max(.3, Math.min(l + r - .3, l + d)),
        [right]: Math.max(.3, Math.min(l + r - .3, r - d)) };
    });
  };
  return <div className="pane-scroll" ref={parent}>
    <div className="pane-grid" style={{
      minWidth: opened.length * 340 + (opened.length - 1) * gutter,
      gridTemplateColumns: columns || '1fr',
    }}>
      {visited.map(id => {
        const agent = agents.find(a => a.id === id);
        if (!agent) return null;
        const index = opened.indexOf(id);
        const visible = shown.has(id);
        return <div key={id} className={'retained-pane ' + (visible ? 'on-screen' : 'off-screen')}
          style={visible ? { gridColumn: index * 2 + 1 } : undefined}>
          <AgentPanel agent={agent} visible={visible} bridge={bridge}
            onClose={() => onRemove(id)} onContext={() => onContext(id)}/>
        </div>;
      })}
      {opened.slice(0, -1).map((id, i) => <div key={'divider:'+id}
        className="split-gutter" role="separator" aria-label="터미널 사이 경계 드래그"
        aria-orientation="vertical" tabIndex={0} style={{ gridColumn: i * 2 + 2 }}
        onPointerDown={e => onDragStart(i, e)}
        onDoubleClick={() => nudge(i, 0)}
        onKeyDown={e => { if (e.key === 'ArrowLeft') nudge(i, -.05); if (e.key === 'ArrowRight') nudge(i, .05); }}>
        <div className="gutter-handle"/>
      </div>)}
      {!opened.length && <div className="empty-pane">메인 대화를 선택하면 이곳에 실제 Pi 터미널이 열립니다.</div>}
    </div>
  </div>;
}
