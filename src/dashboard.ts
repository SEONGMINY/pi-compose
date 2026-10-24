import { spawn } from 'node:child_process';

export type DashboardOptions = {
  sessionOnly?: boolean;
  tab?: 'agents' | 'worktrees';
};

/** Delegate the interactive UI to workmux; do not parse or re-label agent status. */
export function dashboardArgs(options: DashboardOptions = {}): string[] {
  return ['dashboard', ...(options.sessionOnly ? ['--session'] : []), ...(options.tab ? ['--tab', options.tab] : [])];
}

export async function openDashboard(
  options: DashboardOptions = {},
  runner: (bin: string, args: string[]) => Promise<number> = (bin, args) =>
    new Promise<number>((resolve, reject) => {
      const child = spawn(bin, args, { stdio: 'inherit', shell: false });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (signal) reject(new Error(`workmux dashboard terminated by signal ${signal}`));
        else resolve(code ?? 1);
      });
    }),
): Promise<void> {
  let code: number;
  try {
    code = await runner('workmux', dashboardArgs(options));
  } catch (error) {
    throw new Error(`Could not open workmux dashboard: ${error instanceof Error ? error.message : String(error)}. Install/configure workmux and tmux first.`);
  }
  if (code !== 0) throw new Error(`workmux dashboard exited with code ${code}`);
}
