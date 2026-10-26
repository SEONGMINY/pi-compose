import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { attachTaskEvidence } from '../../src/task-index.ts';

/**
 * Optional handoff extension.
 * Git and workmux own their state; no custom session registry, daemon, or diff engine.
 */
export default function handoffExtension(pi: ExtensionAPI): void {
  pi.registerCommand('compose-handoff', {
    description: 'Ask the current Pi agent to prepare an explicit, evidence-linked handoff; optionally send to a named workmux agent',
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify('Use an interactive Pi session to request a handoff.', 'warning');
        return;
      }
      const destination = args.trim();
      pi.sendUserMessage([
        'Prepare a concise handoff for the work actually completed in this session.',
        'Keep the original reasons (WHY), especially strict prohibitions and rejected alternatives. Never invent completed work or tests.',
        'Explicitly distinguish implemented facts, proposals needing human approval, tests that really ran, and unverified claims.',
        'Use the compose_handoff tool to collect current Git changes and deliver the handoff.',
        destination ? 'The user selected this workmux recipient: ' + destination : 'No recipient was selected: return the handoff to this Pi session only.',
        'Do not merge branches, remove Worktrees, or stop Pi sessions.',
      ].join('\n'));
    },
  });

  pi.registerTool({
    name: 'compose_handoff',
    label: 'Prepare development handoff',
    description: 'ONLY when the user explicitly requests a developer handoff. Capture real Git state. Optional direct workmux send requires UI confirmation; sending does NOT prove delivery, reading, or correctness. Do not claim tests you have not run.',
    parameters: Type.Object({
      summary: Type.String({ description: 'Concise factual description of implemented work' }),
      why: Type.String({ description: 'Original rationale/contract, including strong prohibitions or reason UNKNOWN when unavailable' }),
      checks: Type.String({ description: 'Actual checks executed and results, or "Not run"' }),
      outstanding: Type.String({ description: 'Unfinished work, unresolved conflicts, or "None known"' }),
      baseRef: Type.Optional(Type.String({ description: 'Explicit Git base reference for committed+uncommitted diff; omit when unknown rather than guessing' })),
      recipient: Type.Optional(Type.String({ description: 'Optional exact workmux agent handle chosen by the user' })),
    }),
    async execute(_callId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const runGit = async (args: string[]): Promise<string> => {
        const result = await pi.exec('git', args, { cwd });
        if (result.code !== 0) {
          throw new Error('Git inspection failed (' + args[0] + '): ' + (result.stderr || result.code));
        }
        return result.stdout;
      };
      const statusBefore = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
      const gitRoot = (await runGit(['rev-parse', '--show-toplevel'])).trim();
      const head = (await runGit(['rev-parse', 'HEAD'])).trim();
      const branch = (await runGit(['branch', '--show-current'])).trim();
      let base: string | undefined;
      if (params.baseRef) {
        if (params.baseRef.startsWith('-')) throw new Error('Invalid base reference');
        base = (await runGit(['rev-parse', '--verify', '--end-of-options', params.baseRef + '^{commit}'])).trim();
      }
      const lines = (s: string) => s.split('\0').filter(Boolean);
      const staged = lines(await runGit(['diff', '--cached', '--name-only', '-z']));
      const unstaged = lines(await runGit(['diff', '--name-only', '-z']));
      const untracked = lines(await runGit(['ls-files', '--others', '--exclude-standard', '-z']));
      const sinceBase = base ? lines(await runGit(['diff', '--name-only', '-z', base])) : [];
      const names = [...new Set([...sinceBase, ...staged, ...unstaged, ...untracked])].sort();
      const checkCommands = [
        ['diff', '--check'],
        ['diff', '--cached', '--check'],
        ...(base ? [['diff', '--check', base]] : []),
      ];
      const checkResults = await Promise.all(checkCommands.map(args => pi.exec('git', args, { cwd })));
      for (const result of checkResults) {
        if (result.code !== 0 && result.code !== 2) {
          throw new Error('Git diff --check could not complete: ' + (result.stderr || result.code));
        }
      }
      const findings = checkResults.filter(result => result.code === 2)
        .map(result => (result.stdout || result.stderr).slice(0, 350));
      const checkState = findings.length ? 'findings' : 'pass';
      // A changing worktree invalidates the collected evidence. Do not send a stale report.
      const statusAfter = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
      const headAfter = (await runGit(['rev-parse', 'HEAD'])).trim();
      if (statusBefore !== statusAfter || headAfter !== head) {
        throw new Error('Git state changed while preparing Handoff. Retry when the worktree is stable.');
      }
      const sessionFile = ctx.sessionManager.getSessionFile() || '(not saved)';
      const message = [
        '[Pi Compose handoff — developer report, NOT independent verification]',
        'Implemented: ' + params.summary,
        'WHY / contract: ' + params.why,
        'Checks claimed by developer: ' + params.checks,
        'Outstanding: ' + params.outstanding,
        'Git: ' + gitRoot + ' | branch=' + (branch || '(detached)') + ' | HEAD=' + head,
        'Base: ' + (base || '(not supplied; committed changes before HEAD not inspected)'),
        'Files: ' + names.length + (names.length
          ? ' (' + names.slice(0, 30).join(', ') + (names.length > 30 ? ', … ' + (names.length - 30) + ' more' : '') + ')'
          : ' (none detected)'),
        'staged=' + staged.length + ', unstaged=' + unstaged.length + ', untracked=' + untracked.length,
        'git diff --check: ' + checkState + (checkState !== 'pass' ? ' (' + findings.join('; ').slice(0, 350) + ')' : ''),
        'Pi session: ' + sessionFile,
        'Scope: file paths only; untracked file contents and ignored files not inspected. Changes after this snapshot are not covered.',
        'Evidence: all ' + names.length + ' changed paths are available in Tool details; the short message lists only the first 30. Git status was re-read, but concurrent edits with identical status are not ruled out.',
        'Handoff is a claim to check; it does not authorize changing the user contract, merging, or cleanup.',
      ].join('\n');

      let hubLink = 'not_linked';
      try {
      // Git owns Worktree provenance; never associate a report using a title or
      // branch alone. Only an exact, unique path+branch Task Hub record may match.
      const worktrees = await pi.exec('git', ['worktree', 'list', '--porcelain'], { cwd });
      const mainCheckout = worktrees.code === 0
        ? worktrees.stdout.split('\n').find(line => line.startsWith('worktree '))?.slice(9)
        : undefined;
        if (mainCheckout && branch) hubLink = await attachTaskEvidence(
          mainCheckout, gitRoot, branch, {
            handoff: {
              kind: 'developer_claim', recordedAt: new Date().toISOString(),
              gitHead: head, summary: params.summary.slice(0, 3000),
              why: params.why.slice(0, 3000), checks: params.checks.slice(0, 2000),
              outstanding: params.outstanding.slice(0, 2000), changedFileCount: names.length,
            },
          });
      } catch { /* Handoff remains in this session; never claim it was linked. */ }

      let delivery: 'not_requested' | 'cancelled' | 'confirmation_unavailable' | 'submitted_unverified' | 'failed' = 'not_requested';
      let deliveryError: string | undefined;
      if (params.recipient?.trim()) {
        if (!ctx.hasUI) {
          delivery = 'confirmation_unavailable';
        } else {
          const approved = await ctx.ui.confirm(
            'Send handoff to another agent?',
            'Target: ' + params.recipient + '\nThis will send a developer report, not a verified result. Continue?',
          );
          if (!approved) {
            delivery = 'cancelled';
          } else {
            try {
              const result = await pi.exec('workmux', ['send', params.recipient, message], { cwd });
              if (result.code !== 0) throw new Error(result.stderr || 'exit ' + result.code);
              delivery = 'submitted_unverified';
            } catch (error) {
              delivery = 'failed';
              deliveryError = error instanceof Error ? error.message : String(error);
            }
          }
        }
      }
      return {
        content: [{
          type: 'text' as const,
          text: message + '\n\nDelivery: ' + delivery + (deliveryError ? ' (' + deliveryError + ')' : '') +
            (delivery === 'submitted_unverified' ? '. Receipt/read not confirmed.' : '') +
            '\nTask Hub result link: ' + hubLink + ' (only exact Worktree matches are linked)',
        }],
        details: {
          status: 'handoff_prepared_not_verified',
          cwd: gitRoot, head, base: base || null, sessionFile,
          changedFileCount: names.length, changedPaths: names, stagedCount: staged.length,
          unstagedCount: unstaged.length, untrackedCount: untracked.length,
          whitespaceCheck: checkState, delivery, hubLink,
        },
      };
    },
  });
}
