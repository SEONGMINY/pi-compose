import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import type { LaunchPlan } from '../src/launch.ts';
import type { TaskRecord } from '../src/task-index.ts';

export interface HubPreviewItem {
  kind: 'current' | 'main' | 'task' | 'history' | 'new';
  label: string;
  record?: TaskRecord;
}

function short(text: string, max = 64): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function taskName(instruction: string, suppliedTitle?: string): string {
  const name = short(suppliedTitle?.trim() || instruction.split('\n').find(x => x.trim()) || '새 작업');
  return name || '새 작업';
}

/** Review is a single execution gate for command and natural language launch. */
export async function approveLaunch(
  ctx: ExtensionContext,
  plan: LaunchPlan,
  origin: { current: boolean; sessionName?: string; conversationPreview?: string[] },
): Promise<boolean> {
  const label = plan.context === 'fork'
    ? (origin.current ? '현재 Pi 대화 Fork' : '선택한 저장 대화 Fork')
    : '독립 실행 · Main 대화 미전달';
  const destination = plan.workspace === 'worktree'
    ? 'Git Worktree · ' + plan.branch : '현재 디렉터리';
  const summary = [
    '작업: ' + taskName(plan.task),
    '맥락: ' + label,
    '공간: ' + destination,
    ...plan.warnings.map(x => '주의: ' + x),
    '전체 지시·원본 세션 ID는 상세에서 확인',
  ].join('\n');

  // RPC dialogs cannot host terminal-only custom overlays.
  if (ctx.mode !== 'tui') {
    return await ctx.ui.confirm('개발 Agent 실행', summary
      + '\n\n위임 지시 원문:\n' + plan.task
      + (plan.source ? '\n\n원본 세션: ' + plan.source.id : '')
      + (origin.conversationPreview?.length
        ? '\n\n최근 사용자 발화 (대화 전체 아님):\n' + origin.conversationPreview.join('\n')
        : ''));
  }

  return await ctx.ui.custom<boolean>((tui, theme, keys, done) => {
    let details = false;
    let offset = 0;
    const invalidate = () => tui.requestRender();
    return {
      render(width) {
        const w = Math.max(12, width - 3);
        const out: string[] = [
          theme.fg('accent', '새 개발 Agent 실행'),
          '',
          '작업  ' + taskName(plan.task),
          '맥락  ' + label,
          '공간  ' + destination,
          ...plan.warnings.map(x => theme.fg('warning', '주의: ' + x)),
        ];
        if (!details) {
          out.push('', theme.fg('dim', '전체 작업 지시와 세션 ID는 Tab으로 확인할 수 있습니다.'));
        } else {
          const lines = [
            ...plan.task.split('\n').flatMap(x => wrapTextWithAnsi(x, w)),
            ...(origin.conversationPreview?.length ? ['', '최근 사용자 발화 (원본 전체 아님):',
              ...origin.conversationPreview] : []),
            ...(plan.source ? ['', '원본 세션 ID: ' + plan.source.id] : []),
            '프로젝트: ' + plan.cwd,
          ];
          const wrapped = lines.flatMap(x => wrapTextWithAnsi(x, w));
          out.push('', theme.fg('accent', '위임 지시 원문 · 대화 Fork 성공 검증은 아님'),
            ...wrapped.slice(offset, offset + 8).map(x => theme.fg('dim', x)));
          if (wrapped.length > 8) out.push(theme.fg('dim', 'PgUp/PgDn 스크롤 · ' + (offset + 1) + '/' + wrapped.length));
        }
        out.push('', theme.fg('dim', 'Enter 실행 · Esc 취소 · Tab ' + (details ? '요약' : '상세')));
        return out.map(x => truncateToWidth(x, width));
      },
      handleInput(data) {
        if (keys.matches(data, 'tui.select.cancel') || matchesKey(data, Key.escape)) return done(false);
        if (keys.matches(data, 'tui.select.confirm') || matchesKey(data, Key.enter)) return done(true);
        if (matchesKey(data, Key.tab)) { details = !details; offset = 0; return invalidate(); }
        if (matchesKey(data, Key.pageDown)) { offset += 5; return invalidate(); }
        if (matchesKey(data, Key.pageUp)) { offset = Math.max(0, offset - 5); return invalidate(); }
      },
      invalidate() {},
    };
  }, { overlay: true, overlayOptions: { anchor: 'center', width: 76, maxHeight: 23 } });
}

/** Read-only preview. Enter opens a verified target; Tab never launches or resumes anything. */
export async function pickTask(
  ctx: ExtensionContext, project: string, items: readonly HubPreviewItem[],
): Promise<number | undefined> {
  if (ctx.mode !== 'tui') {
    const labels = items.map((x, i) => (i + 1) + '. ' + x.label);
    const choice = await ctx.ui.select('작업 · ' + project, labels);
    return choice ? labels.indexOf(choice) : undefined;
  }
  return await ctx.ui.custom<number | undefined>((tui, theme, keys, done) => {
    let selected = 0;
    let expanded = false;
    let offset = 0;
    const invalidate = () => tui.requestRender();
    return {
      render(width) {
        const w = Math.max(12, width - 3);
        const rows: string[] = [theme.fg('accent', project + ' · 작업'), ''];
        const pageSize = 7;
        const first = Math.max(0, Math.min(selected - 3, Math.max(0, items.length - pageSize)));
        for (let i = first; i < Math.min(items.length, first + pageSize); i++) {
          const item = items[i]!;
          const label = item.kind === 'task' && item.record
            ? short(item.label.split(' · ')[0] || item.record.title, 120) : short(item.label, 120);
          rows.push((i === selected ? theme.fg('accent', '❯ ') : '  ')
            + (i === selected ? theme.fg('accent', label) : label));
        }
        const item = items[selected];
        rows.push('', theme.fg('accent', '─ 선택한 항목 ─'));
        if (item?.record) {
          const record = item.record;
          const details = [
            record.context === 'fork'
              ? '원본: Fork · ' + (record.sourceSessionId ? 'Pi 세션 확인됨' : '원본 식별 불가')
              : '원본: Independent · 다른 대화 상속 안 함',
            '공간: ' + (record.workspace === 'worktree' ? 'Git Worktree' : '현재 디렉터리'),
            '상태: ' + (item.label.split(' · ').slice(-1)[0] || '확인 불가'),
          ];
          rows.push(...details.map(x => theme.fg('dim', x)));
          if (expanded) {
            const full = [
              '실제 위임 지시 (요약·추론 아님):',
              ...(record.instruction || record.title).split('\n'),
              ...(record.sourceSessionId ? ['원본 Pi 세션 ID: ' + record.sourceSessionId] : []),
              ...(record.branch ? ['브랜치: ' + record.branch] : []),
              ...(record.worktreePath ? ['Worktree: ' + record.worktreePath] : []),
            ].flatMap(x => wrapTextWithAnsi(x, w));
            rows.push(...full.slice(offset, offset + 8).map(x => theme.fg('dim', x)));
            if (full.length > 8) rows.push(theme.fg('dim', 'PgUp/PgDn 상세 스크롤'));
          } else {
            rows.push(theme.fg('dim', '지시: ' + short(record.instruction || record.title, 95)));
          }
        } else if (item) {
          rows.push(theme.fg('dim', item.kind === 'main'
            ? '원래 Main의 정확한 tmux 창으로 이동 · 프로세스 재실행 없음'
            : item.kind === 'new' ? '새 Agent를 위한 작업·맥락·작업 공간 선택'
              : item.kind === 'current' ? '현재 작업 화면 · 이동 없음'
                : '기존 Pi 대화와 이전 Worktree 탐색'));
        }
        rows.push('', theme.fg('dim', '↑↓ 선택 · Enter 이동/선택 · Tab 상세 · Esc 닫기'));
        return rows.map(x => truncateToWidth(x, width));
      },
      handleInput(data) {
        if (keys.matches(data, 'tui.select.cancel') || matchesKey(data, Key.escape)) return done(undefined);
        if (keys.matches(data, 'tui.select.confirm') || matchesKey(data, Key.enter)) return done(selected);
        if (keys.matches(data, 'tui.select.up') || matchesKey(data, Key.up)) {
          selected = (selected + items.length - 1) % items.length; expanded = false; offset = 0; return invalidate();
        }
        if (keys.matches(data, 'tui.select.down') || matchesKey(data, Key.down)) {
          selected = (selected + 1) % items.length; expanded = false; offset = 0; return invalidate();
        }
        if (matchesKey(data, Key.tab)) { expanded = !expanded; offset = 0; return invalidate(); }
        if (matchesKey(data, Key.pageDown)) { offset += 5; return invalidate(); }
        if (matchesKey(data, Key.pageUp)) { offset = Math.max(0, offset - 5); return invalidate(); }
      },
      invalidate() {},
    };
  }, { overlay: true, overlayOptions: { anchor: 'center', width: 82, maxHeight: 26 } });
}
