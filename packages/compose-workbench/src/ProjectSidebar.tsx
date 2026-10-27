import { useMemo, useState } from 'react';
import type { Agent } from './App';

type SidebarProps = {
  projects: string[]; currentProject: string | null; agents: Agent[];
  selectedMain: string | null; opened: string[];
  onProject(path: string): void; onAddProject(): void;
  onMain(id: string): void; onAgent(id: string): void;
  onContext(id: string): void; onNewMain(): void;
};
const projectName = (path: string) => path.split('/').filter(Boolean).at(-1) || path;
const activity = (agent: Agent) => agent.processStatus !== 'running' ? '중단됨'
  : agent.activity?.phase === 'responding' ? '응답 중'
  : agent.activity?.phase === 'tool' ? '도구 사용 중'
  : agent.activity?.phase === 'idle' ? '입력 대기' : '실행 중';
export function ProjectSidebar({
  projects, currentProject, agents, selectedMain, opened,
  onProject, onAddProject, onMain, onAgent, onContext, onNewMain,
}: SidebarProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const toggle = (id: string, defaultOpen: boolean) => setExpanded(current =>
    ({ ...current, [id]: !(current[id] ?? defaultOpen) }));
  const matching = useMemo(() => {
    const q=query.trim().toLowerCase();
    if (!q) return agents;
    const matchedMainIds = new Set(agents.filter(a =>
      a.role==='main' && a.title.toLowerCase().includes(q)).map(a=>a.id));
    return agents.filter(a=>a.title.toLowerCase().includes(q)||matchedMainIds.has(a.relatedMainId || ''));
  }, [query, agents]);
  return <aside className="orca-sidebar">
    <div className="sidebar-topnav">
      <button className={searchOpen ? 'current' : ''} onClick={()=>setSearchOpen(!searchOpen)}>
        <span aria-hidden="true">⌕</span> 검색
      </button>
      {searchOpen && <input autoFocus aria-label="Agent 검색" placeholder="프로젝트, 대화, 작업 검색"
        value={query} onChange={e=>setQuery(e.target.value)}/>}
      <button className="current" onClick={()=>{setSearchOpen(false);setQuery('');}}>
        <span aria-hidden="true">☷</span> 작업
      </button>
    </div>
    <div className="sidebar-project-header"><span>프로젝트</span>
      <button aria-label="프로젝트 추가" title="프로젝트 추가" onClick={onAddProject}>＋</button></div>
    <div className="project-list">
      {projects.length===0 && <div className="sidebar-guide">
        <strong>아직 프로젝트가 없습니다.</strong>
        <p>Git 프로젝트를 열면 Main Agent를 만들 수 있습니다.</p>
        <button onClick={onAddProject}>프로젝트 열기</button>
      </div>}
      {projects.filter(path => !query || projectName(path).toLowerCase().includes(query.toLowerCase()) ||
        matching.some(a => (a.project || a.cwd) === path)).map(path=>{
        const projectAgents=matching.filter(a => (a.project || a.cwd)===path);
        const mains=projectAgents.filter(a=>a.role==='main');
        const isCurrent=path===currentProject;
        return <div className="project-tree" key={path}>
          <div className={'project-entry '+(isCurrent?'current':'')}>
            <button title={path} onClick={()=>onProject(path)}>
              <span className="project-bullet">▣</span><strong>{projectName(path)}</strong>
              <small>{projectAgents.length}</small></button>
          </div>
          {isCurrent && <>
            {!mains.length && <div className="sidebar-guide">
              <p>새 Main Agent에서 설계를 시작하세요.</p>
              <button onClick={onNewMain}>Main Agent 만들기</button>
            </div>}
            {mains.map(main=>{
              const children=projectAgents.filter(a=>a.relatedMainId===main.id);
              const isSelected=main.id===selectedMain;
              const open=Boolean(query)||(expanded[main.id] ?? isSelected);
              const running=children.filter(a=>a.processStatus==='running').length;
              const pinned=(main.pins||[]).length;
              return <div className={'main-workspace '+(isSelected?'selected':'')} key={main.id}>
                <div className="main-workspace-head">
                  <button className="main-workspace-select" onClick={()=>onMain(main.id)}>
                    <span className="main-workspace-symbol">◈</span>
                    <span><strong>{main.title}</strong><small>Main Agent · 설계 컨텍스트</small></span>
                  </button>
                  <button className="main-workspace-context" onClick={()=>onContext(main.id)}
                    title="실제 원본 대화와 핵심 결정 보기">맥락</button>
                </div>
                <button className="main-workspace-toggle" onClick={()=>toggle(main.id,isSelected)}
                  aria-expanded={open}><span>{children.length}개 Agent · 실행 중 {running}개</span>
                  {pinned>0 && <em>표시한 결정 {pinned}</em>}
                  <span>{open?'⌄':'›'}</span></button>
                {open && <div className="main-workspace-children">
                  {children.length===0 && <div className="children-empty">
                    Work Agent는 이 설계를 이어받아 구현합니다.</div>}
                  {children.map(child=><button className={'project-agent-row '+(opened.includes(child.id)?'pane-open':'')}
                    key={child.id} onClick={()=>onAgent(child.id)}>
                    <span className={'agent-role-icon '+child.role} title={child.role==='work'?'Main의 정확한 Fork':'독립 컨텍스트'}>
                      {child.role==='work'?'W':'S'}</span>
                    <span className="agent-row-name">
                      <strong>{child.title}</strong>
                      <small>{child.role==='work'?'설계 이어받음':'독립 조사'} · {activity(child)}</small>
                    </span>
                    <span className={'agent-state-indicator '+(child.activity?.phase==='tool'?'tool':child.processStatus)} />
                  </button>)}
                </div>}
              </div>;
            })}
          </>}
        </div>;
      })}
    </div>
    <div className="sidebar-bottom"><span>Pi Compose</span>
      <small>설계는 Main에 보존 · 실행은 별도 세션</small></div>
  </aside>;
}
