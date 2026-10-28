import { SessionManager } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { fileURLToPath } from 'node:url';
import { OrcaAgentStore, displayLaunch } from '../src/orca/agent-sessions.mjs';

const extension = fileURLToPath(import.meta.url);
const store = new OrcaAgentStore();

export default function orcaComposeExtension(pi) {
  // Explicit, read-only on-demand model access. Never copy Work's full
  // transcript into Main at completion, and never mutate Work from this tool.
  pi.registerTool({
    name: 'compose_work_results',
    label: 'Linked Work Results',
    description: 'Read the actual completed response of a Work linked to THIS Pi Main. Only call when the user asks what a Work did; no writes or automatic handoff.',
    promptSnippet: 'If the user asks about a linked Work result, use compose_work_results rather than guessing from the Git worktree.',
    parameters: Type.Object({
      workId: Type.Optional(Type.String({description:'Specific linked Work ID; omit for all connected Work'}))
    }),
    async execute(_toolCallId, args, _signal, _onUpdate, ctx) {
      try {
        const main = store.selectedMain({
          sessionId: ctx.sessionManager.getSessionId(),
          sessionFile: ctx.sessionManager.getSessionFile(),
          cwd: ctx.cwd
        });
        const results = store.linkedWorkResults({mainId:main.id,SessionManager});
        const selected = args.workId ? results.filter(item => item.workId === args.workId) : results;
        const text = selected.length
          ? selected.map(result =>
              'Work: ' + result.workTitle + ' (' + result.workId + ')\n' +
              '원본 응답: ' + result.entryId + '\n' +
              (result.reportText || '완료된 응답에 보고 텍스트가 없습니다.') +
              (result.truncated ? '\n(긴 결과 일부 생략; Work 원본을 확인하세요.)' : '')
            ).join('\n\n---\n\n')
          : '이 Main에 연결된 Work의 완료 보고를 아직 확인할 수 없습니다.';
        return { content: [{type:'text',text}] };
      } catch (error) {
        return { isError:true,content:[{type:'text',text:error instanceof Error?error.message:String(error)}] };
      }
    }
  });

  // These commands are local UI actions, not model tool calls. No command
  // transcript, temporary shell output or Git diff is injected into Main.
  pi.registerCommand('compose-main', {
    description: 'Register THIS saved Pi design conversation as a Main Agent',
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      try {
        const name = args.trim() || await ctx.ui.input('Main Agent 이름', '예: 결제 설계');
        if (name === undefined) return;
        const main = store.registerMain({
          sessionId: ctx.sessionManager.getSessionId(),
          sessionFile: ctx.sessionManager.getSessionFile(),
          cwd: ctx.cwd,
          title: name,
        });
        ctx.ui.notify('Main Agent 등록됨: ' + main.title +
          '\n현재 Pi 대화가 원본입니다. 다른 Main 대화는 독립적으로 등록할 수 있습니다.', 'info');
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
      }
    },
  });

  async function prepare(role, args, ctx) {
    if (!ctx.hasUI) return;
    try {
      const main = store.selectedMain({
        sessionId: ctx.sessionManager.getSessionId(),
        sessionFile: ctx.sessionManager.getSessionFile(),
        cwd: ctx.cwd,
      });
      const task = args.trim() || await ctx.ui.input(
        role === 'work' ? 'Work Agent 개발 지시' : 'Support Agent 조사·테스트 지시', '',
      );
      if (!task?.trim()) return;
      const selection = await ctx.ui.select('작업 폴더 (컨텍스트 유형과는 별개)',
        ['현재 작업 폴더 공유', 'Orca 관리 Git Worktree']);
      if (!selection) return;
      if (selection.startsWith('Orca')) {
        ctx.ui.notify('별도 Worktree 생성은 Orca의 기존 Worktree 생성 기능을 사용합니다. Orca에서 Main 대화의 Work 생성 메뉴를 이용해 주세요. Pi CLI에서 Git Worktree를 직접 만들지 않습니다.', 'info');
        return;
      }
      const activeLeafId = ctx.sessionManager.getLeafId();
      const record = store.prepare({
        role, main, task, workspace: 'shared', SessionManager, projectCwd: ctx.cwd,
        ...(role === 'work' && activeLeafId ? { activeLeafId } : {}),
        launcherPath: { extension, piBinary: process.env.PI_COMPOSE_PI_BINARY || 'pi' },
      });
      ctx.ui.notify(displayLaunch(record), 'info');
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  pi.registerCommand('compose-work', {
    description: 'Fork THIS Main Pi JSONL into an isolated Work Agent. Choose Shared/Worktree.',
    handler: (args, ctx) => prepare('work', args, ctx),
  });

  pi.registerCommand('compose-support', {
    description: 'Prepare a fresh independent Support Agent. Main history is not inherited.',
    handler: (args, ctx) => prepare('support', args, ctx),
  });

  pi.registerCommand('compose-agents', {
    description: 'Show agent lineage and exact Work fork verification (never infer completion)',
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const records = store.list().filter(a => a.projectRoot &&
        a.projectRoot === store.list().find(x => x.role === 'main' &&
          x.sessionId === ctx.sessionManager.getSessionId())?.projectRoot);
      if (!records.length) {
        ctx.ui.notify('이 대화에 등록된 Main Agent가 없습니다. /compose-main부터 시작하세요.', 'info');
        return;
      }
      const lines = records.map(record => {
        if (record.role === 'main') return '[Main Agent] ' + record.title + ' · 원본 ' + record.sessionId;
        const fact = store.inspect(record.id);
        return '[' + (record.role === 'work' ? 'Work Agent' : 'Support Agent') + '] ' +
          record.title + ' · ' + record.state +
          (fact.fork ? ' · 원본 기록 일치 ' + fact.fork.copied + '/' + fact.fork.expected : ' · 독립 대화');
      });
      ctx.ui.notify(lines.join('\n'), 'info');
    },
  });
}
