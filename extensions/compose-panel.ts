import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import type { LaunchPlan } from '../src/launch.ts';
import type { TaskRecord } from '../src/task-index.ts';

export interface HubPreviewItem {
  kind: 'current' | 'main' | 'task' | 'history' | 'new';
  label: string;
  record?: TaskRecord;
  available?: boolean;
}

/** A short label is never substituted for the actual delegation instruction. */
export function taskName(instruction: string, suppliedTitle?: string): string {
  return (suppliedTitle?.trim() || instruction.split('\n').find(s => s.trim()) || '새 작업')
    .replace(/\s+/g, ' ').trim().slice(0, 64);
}

type Segment = { text: string; tone?: 'accent' | 'dim' | 'warning' | 'success' };
type Paint = (name: 'accent' | 'dim' | 'warning' | 'success', value: string) => string;

/**
 * Wrap by terminal cell width (Korean, ANSI, emoji), not String.length.
 * Kept independent of Pi's runtime so layout rules can be inspected directly.
 */
export function wrapSegments(lines: Segment[], width: number, paint: Paint): string[] {
  const w = Math.max(1, width);
  return lines.flatMap(line => {
    const wrapped = wrapTextWithAnsi(line.text, w);
    return (wrapped.length ? wrapped : ['']).map(part =>
      line.tone ? paint(line.tone, part) : part);
  });
}

function part(text: string, tone?: Segment['tone']): Segment { return { text, tone }; }
function separator(width: number): Segment { return part('─'.repeat(Math.max(1, Math.min(width, 48))), 'dim'); }

export function launchReviewLines(
  plan: LaunchPlan, origin: { current: boolean; title?: string; conversationPreview?: string[] },
  detailed: boolean, width: number,
): Segment[] {
  const context = plan.context === 'fork'
    ? origin.current ? '현재 Pi 대화 Fork' : '선택한 Pi 대화 Fork'
    : '독립 실행 · 이전 대화 상속 없음';
  const result: Segment[] = [
    part('새 개발 Agent 실행', 'accent'),
    separator(width),
    part('맡길 작업', 'dim'),
    // The full instruction must stay reachable even if the short title is
    // ambiguous. Its first line is wrapped instead of being sliced.
    part(origin.title?.trim() || plan.task.split('\n').find(line => line.trim()) || '새 작업'),
    part(''),
    part('컨텍스트', 'dim'),
    part(context),
    part('작업 공간', 'dim'),
    part(plan.workspace === 'worktree' ? '별도 Git Worktree' : '현재 디렉터리 공유'),
    ...(plan.branch ? [part('브랜치', 'dim'), part(plan.branch)] : []),
    ...plan.warnings.flatMap(w => [part('주의', 'warning'), part(w, 'warning')]),
  ];
  if (!detailed && (plan.task.includes('\n') || plan.task !== (origin.title?.trim() || plan.task.split('\n')[0]))) {
    // The user-approved instruction itself is the only source of explicit
    // constraints here. Show it rather than inventing an AI-generated summary.
    result.push(part(''), part('실제 위임 지시·제약 (원문)', 'accent'),
      ...plan.task.split('\n').map(line => part(line)));
  }
  if (detailed) {
    result.push(part(''), separator(width), part('실제 위임 지시 원문', 'accent'),
      ...plan.task.split('\n').map(line => part(line)));
    if (plan.source) result.push(part(''), part('원본 Pi 세션 ID', 'dim'), part(plan.source.id));
    if (origin.conversationPreview?.length) result.push(
      part(''), part('최근 사용자 발화 · 전체 대화가 아님', 'dim'),
      ...origin.conversationPreview.map(x => part(x)));
    result.push(part(''), part('실행 디렉터리', 'dim'), part(plan.cwd));
  } else {
    result.push(part(''), part('강한 제약·지시 원문은 Tab 상세에서 확인', 'warning'));
  }
  // Preview metadata is NOT evidence that Pi's session Fork delivered context.
  return result;
}

function taskLabels(record: TaskRecord, current: boolean, available?: boolean): Segment[] {
  return [
    part('출처', 'dim'),
    part(record.context === 'independent'
      ? 'Independent · 이전 대화 상속 없음'
      : record.sourceSessionId ? 'Fork · 원본 Pi 세션 기록 있음 (전달 성공 여부 미확인)'
        : 'Fork · 원본 세션 연결 정보 없음'),
    part('작업 공간', 'dim'),
    part(record.workspace === 'worktree' ? '별도 Git Worktree' : '현재 디렉터리 공유'),
    part('실행 대상', 'dim'),
    part(current ? '현재 작업 화면' : available ? '기존 실행 대상 확인됨 · 이동 가능'
      : '실행 대상 확인 불가 · 자동 재시작 없음'),
  ];
}

export function hubListLines(
  items: readonly HubPreviewItem[], selected: number, width: number, pageSize = 6,
): Segment[] {
  const results: Segment[] = [part('작업 탐색', 'accent'), separator(width)];
  // Keep the focused task in the list viewport, even with many agents.
  const first = Math.max(0, Math.min(selected, Math.max(0, items.length - pageSize)));
  for (let i = first; i < Math.min(items.length, first + pageSize); i++) {
    const item = items[i]!;
    // Always distinguish cursor/focus from the location currently opened.
    const prefix = i === selected ? '❯ ' : '  ';
    const title = item.kind === 'task' && item.record
      ? item.label.split(' · ')[0] || item.record.title : item.label;
    results.push(part(prefix + title, i === selected ? 'accent' : undefined));
    if (i === selected && item.record) results.push(part(
      '  ' + (item.record.context === 'fork' ? 'Fork' : 'Independent') + ' · '
      + (item.record.workspace === 'worktree' ? 'Worktree' : 'Shared') + ' · '
      + (item.available ? '실행 대상 열림' : '이동 대상 확인 불가')
      + (item.record.handoff ? ' · 인계 보고 있음' : '')
      + (item.record.review ? ' · 독립 검토 기록 있음' : ''), 'dim'));
  }
  if (items.length > pageSize) results.push(part('작업 ' + (first + 1) + '–'
    + Math.min(items.length, first + pageSize) + '/' + items.length, 'dim'));
  results.push(separator(width));
  return results;
}

export function hubDetailLines(item: HubPreviewItem, width: number): Segment[] {
  const results: Segment[] = [part('작업 상세 · 목록으로 돌아가려면 Esc', 'accent'), separator(width)];
  if (!item.record) {
    return [...results, part(item.label),
      part('이 항목은 추가 작업 맥락을 저장하지 않습니다.', 'dim')];
  }
  const record = item.record;
  results.push(part('작업 이름', 'dim'), part(record.title), part(''));
  results.push(...taskLabels(record, item.label.includes('현재 작업'), item.available));
  results.push(part(''), separator(width),
    part('실제 위임 지시 (원본 세션 전체 요약 아님)', 'accent'));
  results.push(...(record.instruction || record.title).split('\n').map(text => part(text)));
  if (record.sourceSessionId) results.push(part(''), part('Fork 원본 세션 ID', 'dim'), part(record.sourceSessionId));
  if (record.branch) results.push(part(''), part('브랜치', 'dim'), part(record.branch));
  if (record.worktreePath) results.push(part(''), part('Worktree 경로', 'dim'), part(record.worktreePath));
  results.push(part(''), separator(width), part('결과 인계와 검토', 'accent'));
  if (record.handoff) {
    results.push(part('개발자의 인계 보고 · 독립 검증 전', 'warning'),
      part('작성 시점: ' + record.handoff.recordedAt, 'dim'),
      part('구현한 내용', 'dim'), part(record.handoff.summary),
      part('원래 이유·제약 (개발자 보고)', 'dim'), part(record.handoff.why),
      part('실행했다고 보고한 검사', 'dim'), part(record.handoff.checks),
      part('미해결 사항', 'dim'), part(record.handoff.outstanding),
      part('기록 당시 Git HEAD: ' + record.handoff.gitHead, 'dim'));
  } else {
    results.push(part('등록된 인계 보고 없음 · Agent에서 /compose-handoff 작성 (선택 기능)', 'dim'));
  }
  if (record.review) {
    results.push(part('독립 검토 실행 기록 · 자동 승인 아님', 'accent'),
      part('검토 시점: ' + record.review.recordedAt + (record.review.incomplete ? ' · 일부 확인 불가' : ''), 'dim'),
      part('검토 결과 (원문 일부)', 'dim'), part(record.review.reportExcerpt),
      part('검토 기준 Git HEAD: ' + record.review.gitHead, 'dim'));
  } else {
    results.push(part('독립 검토 기록 없음 · Agent에서 /compose-verify 실행 (선택 기능)', 'dim'));
  }
  results.push(part(''), part('작업 완료·결과 승인·Git 병합·Worktree 삭제는 서로 다른 결정입니다.', 'warning'));
  return results;
}

/** The visible viewport keeps help/confirmation keys outside scrolling content. */
function visiblePage(
  segments: Segment[], width: number, height: number, offset: number, paint: Paint,
  footer: string,
): string[] {
  const w = Math.max(1, width);
  const full = wrapSegments(segments, w, paint);
  const room = Math.max(3, height - 3);
  const start = Math.max(0, Math.min(offset, Math.max(0, full.length - room)));
  const shown = full.slice(start, start + room);
  const position = full.length > room
    ? '  ' + (start + 1) + '–' + Math.min(full.length, start + room) + '/' + full.length : '';
  const lines = [...shown, '', paint('dim', footer + position)];
  // Pi expects a line <= supplied width; padding blanks the former dialog line
  // when list/detail mode or terminal dimensions change.
  return lines.map(line => truncateToWidth(line, w, '', true));
}

function viewportRows(tui: { terminal: { rows: number } }): number {
  // Leave space for Pi's input area and status while keeping dialogs usable
  // in smaller terminals. Normal custom UI is not drawn over the transcript.
  return Math.max(8, Math.min(22, tui.terminal.rows - 6));
}

export async function approveLaunch(
  ctx: ExtensionContext,
  plan: LaunchPlan,
  origin: { current: boolean; title?: string; conversationPreview?: string[] },
): Promise<boolean> {
  if (ctx.mode !== 'tui') {
    return ctx.ui.confirm('개발 Agent 실행', [
      '작업: ' + taskName(plan.task, origin.title),
      '컨텍스트: ' + (plan.context === 'fork' ? 'Fork' : 'Independent'),
      '작업 공간: ' + plan.workspace,
      ...(plan.branch ? ['브랜치: ' + plan.branch] : []),
      ...plan.warnings,
      '원본 작업 지시:\n' + plan.task,
      ...(plan.source ? ['원본 Pi 세션 ID: ' + plan.source.id] : []),
      ...(origin.conversationPreview?.length
        ? ['최근 사용자 발화 (전체 대화 아님):\n' + origin.conversationPreview.join('\n')] : []),
    ].join('\n'));
  }
  // Pi's normal dialog (NOT a screen overlay) owns redraw and editor restoration.
  return ctx.ui.custom<boolean>((tui, theme, keybindings, done) => {
    let detailed = false;
    let offset = 0;
    const paint: Paint = (name, value) => theme.fg(name, value);
    return {
      render(width) {
        return visiblePage(launchReviewLines(plan, origin, detailed, width), width,
          viewportRows(tui), offset, paint,
          'Enter 실행 · Esc 취소 · Tab ' + (detailed ? '요약' : '상세') + ' · ↑↓ 스크롤');
      },
      handleInput(data) {
        if (keybindings.matches(data, 'tui.select.cancel') || matchesKey(data, Key.escape)) return done(false);
        if (keybindings.matches(data, 'tui.select.confirm') || matchesKey(data, Key.enter)) return done(true);
        if (matchesKey(data, Key.tab)) { detailed = !detailed; offset = 0; return tui.requestRender(); }
        if (matchesKey(data, Key.down) || matchesKey(data, Key.pageDown)) { offset += 3; return tui.requestRender(); }
        if (matchesKey(data, Key.up) || matchesKey(data, Key.pageUp)) { offset = Math.max(0, offset - 3); return tui.requestRender(); }
      },
      invalidate() {},
    };
  });
}

export async function pickTask(
  ctx: ExtensionContext, project: string, items: readonly HubPreviewItem[],
): Promise<number | undefined> {
  if (!items.length) return undefined;
  if (ctx.mode !== 'tui') {
    const names = items.map((x, i) => (i + 1) + '. ' + x.label);
    const chosen = await ctx.ui.select('작업 · ' + project, names);
    return chosen ? names.indexOf(chosen) : undefined;
  }
  return ctx.ui.custom<number | undefined>((tui, theme, keybindings, done) => {
    let selected = 0;
    let detail = false;
    let offset = 0;
    const paint: Paint = (name, value) => theme.fg(name, value);
    return {
      render(width) {
        const height = viewportRows(tui);
        const data = detail
          ? hubDetailLines(items[selected]!, width)
          : hubListLines(items, selected, width,
            Math.max(2, Math.min(6, Math.floor((height - 6) / 2))));
        // The project heading appears only in the list. Never show technical
        // tmux/window IDs unless the user opens a particular task's details.
        const page = detail ? data : [part('프로젝트 · ' + project, 'dim'), ...data];
        return visiblePage(page, width, height, offset, paint, detail
          ? 'Esc 목록 · Enter 이동 · ↑↓ 스크롤'
          : '↑↓ 작업 선택 · Enter 이동 · Tab 상세 · Esc 닫기');
      },
      handleInput(data) {
        if (keybindings.matches(data, 'tui.select.cancel') || matchesKey(data, Key.escape)) {
          if (detail) { detail = false; offset = 0; return tui.requestRender(); }
          return done(undefined);
        }
        if (keybindings.matches(data, 'tui.select.confirm') || matchesKey(data, Key.enter)) return done(selected);
        if (matchesKey(data, Key.tab)) {
          detail = !detail; offset = 0; return tui.requestRender();
        }
        if (!detail && (keybindings.matches(data, 'tui.select.up') || matchesKey(data, Key.up))) {
          selected = (selected + items.length - 1) % items.length; offset = 0;
          return tui.requestRender();
        }
        if (!detail && (keybindings.matches(data, 'tui.select.down') || matchesKey(data, Key.down))) {
          selected = (selected + 1) % items.length; offset = 0;
          return tui.requestRender();
        }
        if (detail && (matchesKey(data, Key.down) || matchesKey(data, Key.pageDown))) { offset += 3; return tui.requestRender(); }
        if (detail && (matchesKey(data, Key.up) || matchesKey(data, Key.pageUp))) {
          offset = Math.max(0, offset - 3); return tui.requestRender();
        }
      },
      invalidate() {},
    };
  });
}
