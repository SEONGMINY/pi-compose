export type SetupState = {
  settingsOk: boolean;
  consentOk: boolean;
  prompted: boolean;
  choice?: string;
  packages: {
    navigation: 'missing' | 'configured' | 'custom' | 'project-only' | 'unknown';
    features: 'missing' | 'configured' | 'custom' | 'project-only' | 'unknown';
  };
  hook: 'detected' | 'not-detected';
  node: string;
  pi?: string | null;
  tmux?: string | null;
  workmux?: string | null;
};
export type SetupRunners = {
  runPi: (args: string[]) => Promise<number>;
  runWorkmux: (args: string[]) => Promise<number>;
};
export function inspectSetup(root: string, options?: { versions?: boolean }): SetupState;
export function printDoctor(root: string): number;
export function setupRecommended(
  root: string, options: SetupRunners & { firstRun?: boolean },
): Promise<number>;
export function maybeOnboard(root: string, handlers: SetupRunners): Promise<void>;
