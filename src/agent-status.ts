import { resolve } from 'node:path';

export type AgentObservation = {
  status: 'working' | 'waiting' | 'done';
  workdir: string;
  project_path?: string | null;
  agent_kind?: string | null;
};

export type TaskStatus = 'working' | 'waiting' | 'settled';

/** Use only a successful, unambiguous workmux status --json observation. */
export function parseWorkmuxStatus(output: string, projectRoot: string): AgentObservation[] {
  const value: unknown = JSON.parse(output);
  if (!value || typeof value !== 'object') return [];
  const report = value as Record<string, unknown>;
  const context = report.context as Record<string, unknown> | undefined;
  if (context?.backend !== 'tmux'
    || report.state_files_invalid_matching_context !== 0
    || report.state_files_invalid_unattributed !== 0
    || !Array.isArray(report.target_errors) || report.target_errors.length !== 0
    || !Array.isArray(report.agents)) return [];
  return report.agents.flatMap(agent => {
    if (!agent || typeof agent !== 'object') return [];
    const x = agent as Record<string, unknown>;
    if (!['working', 'waiting', 'done'].includes(String(x.status))
      || typeof x.workdir !== 'string' || !x.workdir.startsWith('/')) return [];
    if (typeof x.project_path !== 'string' || resolve(x.project_path) !== resolve(projectRoot)) return [];
    return [{
      status: x.status as AgentObservation['status'], workdir: resolve(x.workdir),
      project_path: x.project_path, agent_kind: typeof x.agent_kind === 'string' ? x.agent_kind : undefined,
    }];
  });
}

/**
 * A worktree can host several agents. We never pick an arbitrary status.
 * Workmux's Pi integration does not reliably expose waiting for input.
 */
export function worktreeStatus(
  rows: AgentObservation[], worktreePath: string,
): TaskStatus | undefined {
  const exact = rows.filter(row => resolve(row.workdir) === resolve(worktreePath));
  if (exact.length !== 1) return undefined;
  const agent = exact[0]!;
  if (agent.status === 'waiting' && agent.agent_kind === 'pi') return undefined;
  return agent.status === 'done' ? 'settled' : agent.status;
}
