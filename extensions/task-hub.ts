import { basename, resolve } from 'node:path';
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { LaunchPlan } from '../src/launch.ts';
import { bindAgentSession, listTasks, recordTask, reconcileTaskSession, relinkResumedTask, type TaskRecord, type TaskLink, type TmuxLocation } from '../src/task-index.ts';
import { diagnosticEvent, startFlow, finishFlow } from '../src/diagnostics.mjs';
import { openWorkmuxMonitor } from './optional/workmux-dashboard.ts';
import { workmuxRows, returnToTmux, type OpenWorktree } from './work-return.ts';
import { showSavedSessions } from './work-return.ts';
import { inspectReview } from '../src/review.ts';
import { planResume, executeResume } from '../src/resume.ts';
import { inspectWorktree } from '../src/resume.ts';

type HubRow = {
  kind: 'current' | 'main' | 'task' | 'history' | 'new' | 'advanced' | 'monitor';
  label: string;
  record?: TaskRecord;
  target?: TmuxLocation;
  available?: boolean;
};
const same = (a: string, b: string) => resolve(a) === resolve(b);
const equalLocation = (a: TmuxLocation | undefined, b: TmuxLocation | undefined) =>
  Boolean(a && b && a.session === b.session && a.windowId === b.windowId);

type Snapshot = {
  rows: TmuxLocation[];
  current?: TmuxLocation;
};

async function tmuxSnapshot(pi: ExtensionAPI, cwd: string): Promise<Snapshot> {
  try {
    const [all, active] = await Promise.all([
      pi.exec('tmux', ['list-windows', '-a', '-F', '#{session_name}\t#{window_id}\t#{window_name}'], { cwd }),
      process.env.TMUX
        ? pi.exec('tmux', ['display-message', '-p',
          ...(process.env.TMUX_PANE ? ['-t', process.env.TMUX_PANE] : []),
          '#{session_name}\t#{window_id}\t#{window_name}'], { cwd })
        : Promise.resolve({ code: 1, stdout: '', stderr: '' }),
    ]);
    const parse = (line: string): TmuxLocation | undefined => {
      const [session, windowId, ...rest] = line.split('\t');
      return session && /^@[0-9]+$/.test(windowId || '') && rest.length
        ? { session, windowId: windowId!, windowName: rest.join('\t') } : undefined;
    };
    return {
      rows: all.code === 0 ? all.stdout.split('\n').flatMap(s => { const row = parse(s); return row ? [row] : []; }) : [],
      current: active.code === 0 ? parse(active.stdout.trim()) : undefined,
    };
  } catch {
    return { rows: [] };
  }
}

/** Stable main checkout detection also works from a worktree when workmux is unavailable. */
export async function projectRoot(pi: ExtensionAPI, cwd: string, worktrees: OpenWorktree[]): Promise<string> {
  const matches = worktrees.filter(w => same(w.path, cwd) && w.project_path);
  if (matches.length === 1) return resolve(matches[0]!.project_path!);
  try {
    const git = await pi.exec('git', ['worktree', 'list', '--porcelain'], { cwd });
    if (git.code === 0) {
      const first = git.stdout.split('\n').find(line => line.startsWith('worktree '));
      if (first) return resolve(first.slice('worktree '.length));
    }
  } catch { /* Not all shared tasks are Git repositories. */ }
  return resolve(cwd);
}

function exactWorktree(record: TaskRecord, worktrees: OpenWorktree[]): OpenWorktree | undefined {
  if (!record.worktreePath || !record.branch) return undefined;
  // Native Pi --fork fallback uses Git + tmux, not workmux. Actual Git path
  // and branch identity are revalidated by inspectReview before showing diffs.
  if (!record.workmuxHandle && record.tmuxTarget && !record.workmuxTargetName) {
    return { handle:record.tmuxTarget, branch:record.branch,
      path:record.worktreePath, project_path:record.projectRoot, is_open:true };
  }
  if (!record.workmuxHandle) return undefined;
  const matched = worktrees.filter(w => w.handle === record.workmuxHandle
    && w.branch === record.branch && same(w.path, record.worktreePath!)
    && w.project_path && same(w.project_path, record.projectRoot));
  return matched.length === 1 ? matched[0] : undefined;
}

export function taskHubRows(
  records: TaskRecord[], worktrees: OpenWorktree[], live: TmuxLocation[], current?: TmuxLocation,
  isMain = false,
): HubRow[] {
  const isLive = (location: TmuxLocation | undefined) =>
    Boolean(location && live.some(x => equalLocation(x, location)));
  const currentMatches = records.filter(record => equalLocation(record.targetLocation, current));
  const currentTask = currentMatches.length === 1 ? currentMatches[0] : undefined;
  const rows: HubRow[] = [];
  if (currentTask) {
    const main = currentTask.mainLocation;
    if (main && isLive(main) && !equalLocation(current, main)) {
      rows.push({ kind: 'main', label: '← Main으로 돌아가기', target: main });
    }
  }

  // The current location is always recognizable, even when the current process
  // doesn't carry a task record (for example on the original Main).
  rows.push({
    kind: 'current',
    label: '현재 화면 · ' + (currentTask ? currentTask.title : isMain ? 'Main' : 'Pi 대화')
      + (current ? ' · 연결됨' : ' · 위치 확인 불가'),
  });

  // Spawn order never changes when an agent starts, stops, or finishes a turn.
  // The durable index already sorts by creation timestamp; do not re-sort by runtime status.
  const titleCount = new Map<string, number>();
  for (const record of records) titleCount.set(record.title, (titleCount.get(record.title) || 0) + 1);
  const entries = records.map(record => {
    const worktree = record.workspace === 'worktree' ? exactWorktree(record, worktrees) : undefined;
    const available = isLive(record.targetLocation) && (record.workspace === 'shared' || Boolean(worktree?.is_open));
    const location = equalLocation(record.targetLocation, current) ? ' · 현재 작업' : '';
    const status = record.dispatchFailed
      ? '위임 실패 · 남은 리소스 확인 필요'
      : available
      ? record.agentSessionId
        ? record.context === 'fork'
          ? (record.forkParentVerified === true
            ? record.promptObserved && record.assistantObserved ? 'Fork·지시·모델 응답 관측'
              : record.promptObserved ? 'Fork·개발 지시 관측 · 모델 응답 미확인'
              : 'Fork 출처 확인 · 지시 처리 미확인'
            : 'Child Pi 연결 · 원본 Fork 확인 불가')
          : 'Child Pi 연결 · Independent'
        : '실행 창만 확인됨 · Child Pi 미확인'
      : record.targetLocation ? '대상 종료 또는 확인 불가' : '연결 정보 없음 · 이전 작업 탐색';
    const displayName = titleCount.get(record.title)! > 1 ? record.title + ' [' + record.id.slice(0, 8) + ']' : record.title;
    return { kind: 'task' as const, record, available, label: displayName
      + location + ' · ' + (record.workspace === 'shared' ? '같은 폴더' : '별도 작업 공간')
      + ' · ' + status
      + (record.handoff ? ' · 인계 기록' : '') + (record.review ? ' · 검토 기록' : '') };
  });
  rows.push(...entries.slice(0, 15));
  return rows;
}

/**
 * Record a link only after workmux/tmux reports the precise target created by
 * this launch. We never treat an agent name or matching branch as identity.
 */
export async function trackLaunchedTask(pi: ExtensionAPI, plan: LaunchPlan, title?: string, diagnosticFlowId?: string): Promise<string | undefined> {
  try {
    const [snapshot, mux] = await Promise.all([tmuxSnapshot(pi, plan.cwd), workmuxRows(pi, plan.cwd)]);
    const root = await projectRoot(pi, plan.cwd, mux.rows);
    const known = await listTasks(root);
    const current = snapshot.current;
    const origin = current && known.find(t => equalLocation(t.targetLocation, current));
    const main = process.env.PIC_COMPOSE_MAIN === '1' ? current : origin?.mainLocation;
    const link: TaskLink = { projectRoot: root, ...(title ? { title } : {}), ...(diagnosticFlowId ? {diagnosticFlowId} : {}) };
    if (main) link.mainLocation = main;

    if (plan.workspace === 'shared' && plan.tmuxTarget) {
      const targets = snapshot.rows.filter(row => row.session === plan.tmuxTarget);
      if (targets.length === 1) link.targetLocation = targets[0];
    } else if (plan.workspace === 'worktree' && plan.worktreePath && plan.tmuxTarget) {
      const targets = snapshot.rows.filter(row => row.session === plan.tmuxTarget);
      link.worktreePath = plan.worktreePath;
      if (targets.length === 1) link.targetLocation = targets[0];
    } else if (plan.workspace === 'worktree' && plan.branch && plan.workmuxTargetName) {
      const worktrees = mux.rows.filter(w => w.branch === plan.branch && w.project_path
        && same(w.project_path, root) && w.is_open);
      let windows = snapshot.rows.filter(row => row.windowName.includes(plan.workmuxTargetName!));
      // Status hooks can rename a window after launch. Accept a fallback only
      // when exactly one tmux window has a pane rooted at this newly created
      // workmux Worktree path. A matching branch/title alone is never enough.
      if (worktrees.length === 1 && windows.length === 0) {
        const targetPath = worktrees[0]!.path;
        try {
          const panes = await pi.exec('tmux', ['list-panes', '-a',
            '-F', '#{window_id}\t#{pane_current_path}'], { cwd: targetPath });
          if (panes.code === 0) {
            const ids = new Set(panes.stdout.split('\n').flatMap(line => {
              const [windowId, cwd] = line.split('\t');
              return windowId && cwd && same(cwd, targetPath) ? [windowId] : [];
            }));
            windows = snapshot.rows.filter(row => ids.has(row.windowId));
          }
        } catch { /* Ambiguous or unavailable pane identity remains unverified. */ }
      }
      if (worktrees.length === 1) {
        // The Git/workmux identity is already exact even if the tmux window is
        // still starting. Preserve it for Handoff; never invent a live target.
        link.worktreePath = worktrees[0]!.path;
        link.workmuxHandle = worktrees[0]!.handle;
        if (windows.length === 1) link.targetLocation = windows[0];
      }
    }

    await recordTask(plan, link);
    if (!link.targetLocation) return 'Launch command was accepted, but the exact running target was not verified. '
      + 'The work is listed as unverified; use the advanced work picker to inspect it.';
    return undefined;
  } catch (error) {
    return 'Launch command was accepted but the work link could not be saved: ' + String(error)
      + '. Existing tmux and Git resources were not changed.';
  }
}


/**
 * A single small Pi-native picker. Running-work observations belong in workmux
 * Dashboard, not a second TUI implementation in Pi Compose.
 */
export async function refreshTaskIndicator(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus('compose-tasks', '/compose · 관련 Agent');
  ctx.ui.setWidget('compose-hint', undefined);
}
const brief = (text: string, limit = 24): string => {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.length > limit ? chars.slice(0, limit).join('') + '…' : chars.join('');
};
const evidenceText = (record: TaskRecord): string => [
  'Agent: ' + record.title,
  'Git HEAD는 기록 시점의 값이며 현재 상태와 다를 수 있습니다.',
  ...(record.workspace === 'shared' ? ['Shared Directory의 Git 변경은 개별 Agent에 귀속되지 않습니다.'] : []),
  record.handoff ? '\n[개발자 인계 주장 · 독립 검증 전]\n'
    + '작업 내용: ' + record.handoff.summary + '\nWHY / 제약: ' + record.handoff.why
    + '\n실행했다고 보고한 검사: ' + record.handoff.checks
    + '\n미해결: ' + record.handoff.outstanding
    + '\n기록 HEAD: ' + record.handoff.gitHead : '\n인계 보고 없음. Agent에서 /compose-handoff 실행 가능 (선택형).',
  record.review ? '\n[독립 검토 실행 · 통합 승인 아님]\n'
    + record.review.reportExcerpt + '\n검토 HEAD: ' + record.review.gitHead
    + (record.review.incomplete ? '\n검증 누락 범위가 있습니다.' : '')
    : '\n독립 검토 없음. Agent에서 /compose-verify 실행 가능 (선택형).',
  '\nMain에서 병합 또는 Worktree 정리를 자동으로 실행하지 않습니다.',
].join('\n');

async function taskActions(pi: ExtensionAPI, ctx: ExtensionContext, row: HubRow, worktrees: OpenWorktree[], root:string, flowId?: string): Promise<'open' | 'back'> {
  const record = row.record;
  if (!record) return 'back';
  // Git is the authoritative review source. It can outlive a workmux process.
  const reviewedPath=record.workspace==='worktree'?record.worktreePath:undefined;
  const actions = [
    ...(row.available ? ['기존 Agent 화면으로 이동'] : []),
    '실행 상태·복구 확인',
    ...(record.agentSessionFile && !row.available ? ['저장된 Child Pi 재개'] : []),
    ...(record.workspace==='worktree' && reviewedPath && record.branch ? ['Git 변경 검토'] : []),
    ...(record.workspace==='shared' ? ['Shared Git 변경 확인 (작성 Agent 특정 불가)'] : []),
    '원본 위임 지시 확인',
    ...(record.handoff || record.review ? ['인계·검토 결과 확인'] : []),
    '← 작업 목록으로',
  ];
  while (true) {
    const choice = await ctx.ui.select('작업 · ' + brief(record.title, 34), actions);
    if (!choice || choice.startsWith('←')) return 'back';
    diagnosticEvent('navigation.detail',{source:'menu',flowId,data:{kind:choice==='기존 Agent 화면으로 이동'?'agent':choice==='원본 위임 지시 확인'?'instruction':'result'},taskId:record.id});
    if (choice === '기존 Agent 화면으로 이동') return 'open';
    if (choice === 'Git 변경 검토' && reviewedPath && record.branch) {
      try {
        // Git/workmux own the truth. No Handoff is required to review actual changes.
        const review = await inspectReview(reviewedPath, record.branch, record.baseSha);
        await ctx.ui.confirm('Git 변경 · ' + brief(record.title), [
          '브랜치: ' + review.branch, '비교 기준: ' + review.base,
          ...(review.warning ? ['주의: ' + review.warning] : []),
          '\n변경·새 파일 목록:\n' + review.changes,
          '\n변경 규모:\n' + review.stat,
          '\nGit Patch (미추적 새 파일 내용은 포함되지 않음):\n' + review.patch,
          ...(review.truncated ? ['\nDiff 출력 일부만 표시했습니다. 작업 폴더에서 git diff로 전체를 확인하세요.'] : []),
          '\n코드를 변경하거나 자동 병합하지 않았습니다.',
        ].join('\n'));
      } catch (error) {
        ctx.ui.notify('Git 변경을 확인하지 못했습니다: ' + String(error) + '. Worktree/브랜치가 바뀌었는지 Git에서 확인하세요.', 'warning');
      }
      continue;
    }
    if(choice==='실행 상태·복구 확인') {
      let gitState='해당 없음 (Shared)';
      if(record.workspace==='worktree'&&record.branch){
        try{
          const w=await inspectWorktree({cwd:root,branch:record.branch});
          gitState=w.status+(w.path?' / 작업 폴더: '+w.path:'')+(w.dirty?' / 미커밋 변경 있음':'');
        }catch(e){gitState='확인 실패: '+String(e);}
      }
      await ctx.ui.confirm('실행·리소스 확인 · '+brief(record.title),[
        '원본 대화: '+(record.sourceSessionId||'독립 실행 / 식별 불가'),
        '실행 명령: '+(record.dispatchFailed?'실패 · 잔여 리소스 확인':'전달됨 (모델 상태 별도 확인)'),
        '실행 대상: '+(row.available?'정확한 기존 창 있음':'창 종료 또는 확인 불가'),
        'Child Pi 세션: '+(record.agentSessionId||'미확인'),
        '원본 Fork: '+(record.context==='independent'?'해당 없음':record.forkParentVerified===true?'일치 확인':'확인 불가'),
        '개발 지시: '+(record.promptObserved?'Child JSONL에서 원문 관측':'전달 여부 미확인'),
        '모델 응답: '+(record.assistantObserved?'Child JSONL에서 기록 관측':'관측되지 않음 (실패 확정 아님)'),
        'Git 작업 공간: '+gitState,
        '\n다음 행동: '+(row.available?'기존 Agent 화면으로 이동해 직접 확인'
          :record.agentSessionFile?'저장된 Child Pi 재개 (승인 필요)':'기존 Git·tmux 리소스를 확인하세요. 확인 없이 중복 실행하지 않습니다.'),
        '\n프로세스·세션·모델 응답·개발 완료는 서로 다른 사실입니다.',
      ].join('\n'));
      continue;
    }
    if(choice==='저장된 Child Pi 재개' && record.agentSessionFile && !row.available){
      try{
        const plan=await planResume({workspace:record.workspace,cwd:root,
          sessionFile:record.agentSessionFile,branch:record.branch});
        const approved=await ctx.ui.confirm('기존 Child Pi 대화 재개',[
          '작업: '+record.title,'저장 세션 ID: '+plan.sessionId,
          '작업 폴더: '+plan.cwd,'새 tmux 세션: '+plan.tmuxTarget,
          ...plan.warnings,'\n기존 저장 대화를 --session으로 재개합니다. 새 Fork를 만들지 않습니다.',
          '다른 tmux 대상에서 이미 실행 중인 Pi가 있을 수 있으므로 먼저 확인하세요.',
        ].join('\n'));
        if(!approved)continue;
        const outcome=await executeResume(plan);
        if(outcome.status==='target_occupied_no_launch'){
          ctx.ui.notify('정확한 tmux 대상이 이미 있습니다. 중복 실행하지 않았습니다. /compose에서 기존 실행 창을 확인하세요.','warning');
          continue;
        }
        const latest=await tmuxSnapshot(pi,root);
        const matches=latest.rows.filter(t=>t.session===plan.tmuxTarget);
        if(matches.length===1){
          const relinked=await relinkResumedTask(root,record.id,plan.sessionId,plan.sessionFile,matches[0]!);
          ctx.ui.notify(relinked?'이전 Child 실행 창을 연결했습니다. /compose에서 선택하세요.':
            '명령 전달됨. 정확한 세션 연결을 다시 확인해야 합니다.','info');
        }else{
          ctx.ui.notify('tmux 명령은 성공했지만 정확한 창 연결이 확인되지 않았습니다. 다시 시작하지 마세요.','warning');
        }
        return 'back';
      }catch(e){ctx.ui.notify('재개 실패. 리소스를 삭제하거나 다른 Pi를 시작하지 않았습니다: '+String(e),'error');}
      continue;
    }
    if(choice==='Shared Git 변경 확인 (작성 Agent 특정 불가)'){
      try{
        const status=await pi.exec('git',['status','--short','--untracked-files=normal'],{cwd:record.launchCwd||root});
        const diff=await pi.exec('git',['diff','--no-ext-diff','HEAD','--'],{cwd:record.launchCwd||root});
        if(status.code!==0||diff.code!==0)throw new Error(status.stderr||diff.stderr||'Git 조회 실패');
        await ctx.ui.confirm('Shared Checkout 변경 · 작성자 추정 금지',[
          '이 Git 변경은 특정 Child Agent에 귀속할 수 없습니다.',
          '\n변경 목록:\n'+(status.stdout||'(없음)'),
          '\nDiff 일부:\n'+(diff.stdout.slice(0,10000)||'(없음)'),
          '\n결과 확인만 수행했습니다. 자동 병합하지 않습니다.',
        ].join('\n'));
      }catch(e){ctx.ui.notify('Shared Git 상태 확인 실패: '+String(e),'warning');}
      continue;
    }
    if (choice === '원본 위임 지시 확인') {
      // An exact recorded instruction is not a summary of the entire Pi Fork.
      await ctx.ui.confirm('위임 원문 · 읽기 전용', [
        '작업: ' + record.title,
        '컨텍스트: ' + (record.context === 'fork' ? 'Fork' : 'Independent'),
        ...(record.sourceSessionId ? ['Fork 원본 세션 ID: ' + record.sourceSessionId] : []),
        ...(record.agentSessionId ? ['실제 Agent Pi 세션 ID: ' + record.agentSessionId] : ['실제 Agent Pi 세션: 연결 미확인']),
        ...(record.context === 'fork' ? ['원본 대화 계보 검증: '
          + (record.forkParentVerified === true ? '확인됨' : '확인되지 않음 (모델 이해 여부와 별개)')] : []),
        '공간: ' + (record.workspace === 'worktree' ? 'Worktree' : 'Shared'),
        ...(record.branch ? ['브랜치: ' + record.branch] : []),
        '\n실제 위임 지시 (원본 대화 전체 아님):\n' + (record.instruction || record.title),
      ].join('\n'));
    } else if (choice === '인계·검토 결과 확인') {
      diagnosticEvent(record.handoff||record.review?'result.opened':'result.unavailable', {source:'menu',flowId,outcome:record.handoff||record.review?'success':'unavailable',taskId:record.id,data:{hasResult:!!(record.handoff||record.review)}});
      await ctx.ui.confirm('작업 결과 · 읽기 전용', evidenceText(record));
    }
  }
}

export async function showTaskHub(
  pi: ExtensionAPI, ctx: ExtensionContext, onLaunch?: (advanced?: boolean) => Promise<void>,
): Promise<void> {
  if (!ctx.hasUI) return;
  const [mux, snapshot] = await Promise.all([workmuxRows(pi, ctx.cwd), tmuxSnapshot(pi, ctx.cwd)]);
  const root = await projectRoot(pi, ctx.cwd, mux.rows);
  const saved=await listTasks(root);
  // Repair the record/Child session startup race from Pi's own saved JSONL.
  // A matching title or branch is never enough; exact cwd, parent and prompt
  // must be verified before adopting a saved child.
  const records:TaskRecord[]=[];
  for(const record of saved.slice(0,15)){
    let candidates:string[]=[];
    if(!record.agentSessionFile){
      const cwd=record.workspace==='worktree'?record.worktreePath:record.launchCwd||record.projectRoot;
      if(cwd){
        try{candidates=(await SessionManager.list(cwd,ctx.sessionManager.getSessionDir())).slice(0,40).map(x=>x.path);}
        catch{/* unavailable sessions remain unknown */}
      }
    }
    records.push(await reconcileTaskSession(root,record.id,candidates) || record);
  }
  records.push(...saved.slice(15));
  const flow=startFlow('navigation.opened',{source:'slash',projectId:root,data:{availableTargets:records.length,screen:process.env.PIC_COMPOSE_MAIN==='1'?'main':'agent'}});
  const taskRows = taskHubRows(records, mux.rows, snapshot.rows, snapshot.current,
    process.env.PIC_COMPOSE_MAIN === '1'
      || records.some(record => equalLocation(record.mainLocation, snapshot.current)));
  // The current location stays the first row; cursor selection is a separate notion.
  const rows: HubRow[] = [
    ...taskRows.filter(row => row.kind === 'current' || row.kind === 'main'),
    ...(onLaunch ? [{ kind: 'new' as const, label: '+ 현재 대화 Fork → 새 Worktree에서 개발' }] : []),
    ...taskRows.filter(row => row.kind === 'task'),
    ...(onLaunch ? [{ kind: 'advanced' as const, label: '다른 실행 방식 (Independent / Shared / 다른 원본 대화)' }] : []),
    { kind: 'monitor', label: '전체 작업 관찰 · workmux Dashboard' },
    { kind: 'history', label: '이전 Pi 대화·기능 찾기' },
  ];
  const choices = rows.map((row, index) => {
    if (row.kind !== 'task' || !row.record) return row.label;
    const r = row.record;
    const prefix = brief(r.title);
    // Always distinguish identical names, without guessing by a branch name.
    return (index + 1) + '. ' + prefix + ' [' + r.id.slice(0, 8) + '] · '
      + (r.context === 'fork' ? 'Fork' : 'Independent') + ' · '
      + (row.available
        ? r.agentSessionId
          ? r.context === 'fork'
            ? (r.forkParentVerified === true ? 'Pi + Fork 확인' : 'Pi 연결, Fork 미확인')
            : 'Pi 연결'
          : '실행 창만 확인'
        : '기록만 있음');
  });
  // Native select handles terminal width, keyboard focus and input restoration.
  const selected = await ctx.ui.select('관련 작업 · ' + basename(root), choices);
  if (!selected) {finishFlow(flow,'navigation.finished',{source:'slash',outcome:'cancelled',data:{reason:'no_selection'}});return;}
  const row = rows[choices.indexOf(selected)];
  diagnosticEvent('navigation.selected',{source:'menu',flowId:flow.flowId,outcome:'success',data:{kind:row?.kind||'unknown',elapsedMs:Date.now()-flow.started}});
  if (!row || row.kind === 'current') {finishFlow(flow,'navigation.finished',{source:'menu',outcome:'cancelled',data:{reason:'current'}});return;}
  if (row.kind === 'new' || row.kind === 'advanced') { if (onLaunch) await onLaunch(row.kind === 'advanced'); finishFlow(flow,'navigation.finished',{source:'menu',outcome:'success',data:{kind:'new'}}); return; }
  if (row.kind === 'monitor') { const opened=await openWorkmuxMonitor(pi, ctx); finishFlow(flow,'navigation.finished',{source:'menu',outcome:opened?'success':'failure',data:{kind:'monitor'}});return; }
  if (row.kind === 'history') {
    // /compose sessions is an exact Pi-native switch, not another Agent list.
    if ('switchSession' in ctx && typeof ctx.switchSession === 'function') {
      await showSavedSessions(ctx as ExtensionCommandContext);
    } else {
      ctx.ui.notify('이전 기능 대화: /compose sessions 또는 Pi /resume', 'info');
    }
    finishFlow(flow,'navigation.finished',{source:'menu',outcome:'success',data:{kind:'history'}});
    return;
  }
  if (row.kind === 'task' && await taskActions(pi, ctx, row, mux.rows, root, flow.flowId) !== 'open') {
    finishFlow(flow,'navigation.finished',{source:'menu',outcome:'cancelled',data:{kind:'task'}});
    return;
  }

  const target = row.target || row.record?.targetLocation;
  if (!target || !snapshot.rows.some(live => equalLocation(live, target))) {
    ctx.ui.notify('정확한 기존 tmux 창을 확인하지 못했습니다. 새로운 Pi는 실행하지 않습니다.', 'warning');
    finishFlow(flow,'navigation.finished',{source:'menu',outcome:'unavailable',data:{reason:'target_unavailable'}});
    return;
  }
  if (row.record?.workspace === 'worktree'
    && !exactWorktree(row.record, mux.rows)?.is_open) {
    ctx.ui.notify('Worktree 실행 창이 닫혔거나 연결 정보가 바뀌었습니다. 실행하지 않습니다.', 'warning');
    finishFlow(flow,'navigation.finished',{source:'menu',outcome:'unavailable',data:{reason:'worktree_closed'}});
    return;
  }
  const moved=await returnToTmux(pi, ctx, { name: target.session, cwd: root, windowId: target.windowId });
  finishFlow(flow,'navigation.finished',{source:'menu',outcome:moved?'success':'failure',data:{kind:row.kind}});
}

/** Match only this running Pi's persisted session and exact tmux window. */
async function linkCurrentPi(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile || !process.env.TMUX) return;
  const snapshot = await tmuxSnapshot(pi, ctx.cwd);
  if (!snapshot.current) return;
  const worktrees = await workmuxRows(pi, ctx.cwd);
  const root = await projectRoot(pi, ctx.cwd, worktrees.rows);
  const linked=await bindAgentSession(root, snapshot.current, ctx.cwd,
    ctx.sessionManager.getSessionId(), sessionFile);
  if(linked==='saved') {
    const task=(await listTasks(root)).find(t=>t.agentSessionId===ctx.sessionManager.getSessionId());
    diagnosticEvent('launch.agent_linked',{source:'automatic',flowId:task?.diagnosticFlowId,outcome:'success',sessionId:ctx.sessionManager.getSessionId(),taskId:task?.id,projectId:root,data:{linked:true}});
    // session_start is not proof of work. This link happens at agent_start or
    // agent_settled; a Pi run was observed, not its prompt contents or correct output.
    diagnosticEvent('launch.agent_started',{source:'automatic',flowId:task?.diagnosticFlowId,
      outcome:'success',sessionId:ctx.sessionManager.getSessionId(),taskId:task?.id,
      projectId:root,data:{stage:'agent'}});
    if (task?.context === 'fork') {
      diagnosticEvent('launch.context_linked',{source:'automatic',flowId:task.diagnosticFlowId,
        outcome:task.forkParentVerified===true?'success':'unavailable',
        sessionId:ctx.sessionManager.getSessionId(),taskId:task.id,projectId:root,
        data:{linked:task.forkParentVerified===true}});
      if(task.forkParentVerified!==true && ctx.hasUI) {
        ctx.ui.notify('Child Pi는 연결됐지만 승인한 원본 Pi 대화의 parentSession을 확인하지 못했습니다. 원본 맥락을 검증하기 전에는 Fork 성공으로 판단하지 마세요.', 'warning');
      }
    }
  }
}

export function registerTaskHub(pi: ExtensionAPI, openHub: (ctx: ExtensionContext) => Promise<void>): void {
  // Optional fast path. /compose is the discoverable and portable default.
  pi.registerShortcut?.('alt+w', {
    description: 'Pi Compose: 관련 작업 탐색 (/compose)',
    handler: openHub,
  });
  pi.on?.('session_start', async (_event, ctx) => {
    await refreshTaskIndicator(ctx);
  });
  // Pi may not persist its session file until the first conversation message.
  // These existing Pi events retry without polling, timers or a daemon.
  pi.on?.('agent_start', async (_event, ctx) => {
    await linkCurrentPi(pi, ctx).catch(() => undefined);
  });
  pi.on?.('agent_settled', async (_event, ctx) => {
    await linkCurrentPi(pi, ctx).catch(() => undefined);
  });
}
