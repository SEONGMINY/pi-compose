import { randomUUID } from 'node:crypto';

/** User intent first: Fork the exact current Pi conversation into an isolated Worktree.
 * The random suffix prevents collisions without reading or changing Git state.
 * These are defaults, never an implicit authorization to spawn.
 */
export function proposedBranch(task: string, id = randomUUID().slice(0, 8)): string {
  const slug = task.normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36).replace(/-+$/g, '');
  const suffix = id.toLowerCase().replace(/[^a-f0-9]/g, '').slice(0, 8);
  if (!/^[a-f0-9]{4,8}$/.test(suffix)) throw new Error('Invalid branch nonce');
  return 'feat/' + (slug || 'task') + '-' + suffix;
}

export type DelegationChoices = {
  context: 'fork' | 'independent';
  workspace: 'worktree' | 'shared';
};

export const DEFAULT_DELEGATION: Readonly<DelegationChoices> = Object.freeze({
  context: 'fork',
  workspace: 'worktree',
});

export function needsSource(choices: DelegationChoices): boolean {
  return choices.context === 'fork';
}
