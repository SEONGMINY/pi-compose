import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

const agentDir = () => {
  const custom = process.env.PI_CODING_AGENT_DIR;
  return custom?.startsWith('~/') ? resolve(homedir(), custom.slice(2))
    : resolve(custom || join(homedir(), '.pi', 'agent'));
};
const consentPath = () => join(agentDir(), 'compose', 'onboarding-v1.json');
// Only the once-shown consent is stored here. Pi/workmux still own all feature settings.
function json(path) {
  if (!existsSync(path)) return { ok: true, value: {} };
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return { ok: value !== null && typeof value === 'object' && !Array.isArray(value), value };
  } catch { return { ok: false, value: null }; }
}
function packageState(settings, target, baseDir = agentDir()) {
  const list = Array.isArray(settings?.packages) ? settings.packages : [];
  const found = list.find(p => {
    const source = typeof p === 'string' ? p : p?.source;
    return typeof source === 'string' && !/^(npm:|git:|https?:)/.test(source)
      && resolve(baseDir, source) === resolve(target);
  });
  if (!found) return 'missing';
  // Never undo any Pi resource filtering chosen in pi config.
  if (typeof found === 'object' && Object.hasOwn(found, 'extensions')) return 'custom';
  return 'configured';
}
function commandVersion(command) {
  const result = spawnSync(command, ['--version'], {encoding:'utf8',timeout:5000});
  return result.error || result.status !== 0 ? null
    : (result.stdout || result.stderr).trim().split('\n')[0].slice(0,100);
}
export function inspectSetup(root, { versions = false } = {}) {
  const settings = json(join(agentDir(), 'settings.json'));
  const consent = json(consentPath());
  // Respect existing project-scoped Pi Package declarations too. Their relative
  // sources resolve from the project's .pi directory, not from the user agentDir.
  const project = json(join(process.cwd(), '.pi', 'settings.json'));
  const packages = settings.ok && project.ok ? {
    navigation: packageState(settings.value, join(root, 'packages/navigation')) !== 'missing'
      ? packageState(settings.value, join(root, 'packages/navigation'))
      : packageState(project.value, join(root, 'packages/navigation'), join(process.cwd(), '.pi')) !== 'missing'
        ? 'project-only' : 'missing',
    features: packageState(settings.value, join(root, 'packages/optional')) !== 'missing'
      ? packageState(settings.value, join(root, 'packages/optional'))
      : packageState(project.value, join(root, 'packages/optional'), join(process.cwd(), '.pi')) !== 'missing'
        ? 'project-only' : 'missing',
  } : {navigation: 'unknown', features: 'unknown'};
  const hookFile = join(agentDir(), 'extensions/workmux-status.ts');
  const hasHook = existsSync(hookFile)
    || (Array.isArray(settings.value?.extensions)
      && settings.value.extensions.some(e => typeof e === 'string'
        && /workmux-status\.(ts|js)/.test(e)));
  return {
    settingsOk:settings.ok && project.ok, consentOk:consent.ok,
    prompted:consent.ok && consent.value?.prompted === true,
    choice:consent.value?.choice,
    packages, hook:hasHook ? 'detected' : 'not-detected',
    node:process.version,
    pi:versions ? commandVersion('pi') : undefined,
    tmux:versions ? commandVersion('tmux') : undefined,
    workmux:versions ? commandVersion('workmux') : undefined,
  };
}
function remember(choice) {
  const path = consentPath();
  mkdirSync(dirname(path), {recursive:true,mode:0o700});
  writeFileSync(path, JSON.stringify({prompted:true,choice})+'\n', {mode:0o600});
}
async function yes(message, defaultYes) {
  const rl = createInterface({input:process.stdin,output:process.stdout});
  try {
    const value = (await rl.question(message + (defaultYes ? ' [Y/n] ' : ' [y/N] '))).trim().toLowerCase();
    return value ? value === 'y' || value === 'yes' : defaultYes;
  } finally { rl.close(); }
}
export function printDoctor(root) {
  const s = inspectSetup(root,{versions:true});
  let pkgVersion = 'unknown';
  try { pkgVersion = JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version; } catch {}
  console.log('Pi Compose version: ' + pkgVersion + ' (Git SHA: see npm install source)');
  console.log('Node: '+s.node+' | Pi: '+(s.pi||'missing')+' | tmux: '+(s.tmux||'missing')+' | workmux: '+(s.workmux||'missing'));
  console.log('Child navigation: '+s.packages.navigation+' | Handoff/Verify: '+s.packages.features+' | Pi status Hook: '+s.hook);
  if (!s.settingsOk) console.log('WARNING: Pi settings.json cannot be parsed. No configuration will be modified.');
  if (s.packages.navigation === 'custom' || s.packages.features === 'custom')
    console.log('Pi resource filters were customized; inspect exact enabled extensions with pi config.');
  if (s.packages.navigation === 'project-only' || s.packages.features === 'project-only')
    console.log('Some Packages are PROJECT-ONLY; new Worktrees may not load them. Use pi config --local or explicitly opt in globally.');
  if (s.hook === 'not-detected') console.log('workmux status Hook was not detected; dashboard agent state may be empty. Run pic setup.');
  if (s.choice === 'skip') console.log('Initial setup was declined. Run pic setup whenever you want to opt in.');
  console.log('If settings changed while Pi was running, use /reload in that session.');
  return s.settingsOk ? 0 : 1;
}
export async function setupRecommended(root,{runPi,runWorkmux,firstRun=false} = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('pic: Interactive terminal required to approve setup. Run pic setup from a terminal.');
    return 2;
  }
  const s=inspectSetup(root);
  if (!s.settingsOk) { printDoctor(root); return 1; }
  const nav=s.packages.navigation==='missing';
  const features=s.packages.features==='missing';
  const hook=s.hook==='not-detected';
  if (!nav && !features && !hook) { if (!firstRun) printDoctor(root); remember('existing'); return 0; }
  console.log('\nPi Compose recommended setup (one-time):');
  console.log('Child Pi navigation: '+(nav?'new Pi package':'preserve your existing choice'));
  console.log('Handoff + Verify: '+(features?'new Pi package':'preserve your existing choice'));
  console.log('workmux Pi Hook: '+(hook?'optional workmux setup':'already detected'));
  console.log('Pi packages affect normal pi too. Existing skills, extensions, models and sessions are preserved.');
  console.log('workmux setup may offer changes to OTHER coding agents and active tmux status formats.');
  if (!await yes('Prepare the missing recommended features?',true)) {
    remember('skip');
    console.log('pic: Skipped; launch remains available. Later: pic setup');
    return 0;
  }
  for (const [name,needed,path] of [
    ['Navigation',nav,join(root,'packages/navigation')],
    ['Handoff/Verify',features,join(root,'packages/optional')],
  ]) {
    if (!needed) continue;
    console.log('pic: Installing '+name+' via pi install...');
    const code=await runPi(['install',path]);
    if (code!==0) {
      console.error('pic: '+name+' failed. Successful steps were not undone; retry: pic setup');
      return code;
    }
  }
  if (hook) {
    if (await yes('Open the official workmux setup and review Pi status Hook installation?',false)) {
      const code=await runWorkmux(['setup']);
      if (code!==0) {
        console.error('pic: workmux setup failed. Pi extensions remain installed; retry: pic setup');
        return code;
      }
      if (inspectSetup(root).hook==='not-detected') {
        console.log('pic: Pi Hook not detected after workmux setup. You may have skipped it there; retry via pic setup.');
      }
    } else console.log('pic: workmux Hook skipped. Dashboard UI remains accessible, Agent status may be empty.');
  }
  remember('recommended');
  console.log('pic: Setup recorded. Existing Pi processes may require /reload; new sessions use the Pi configuration.');
  return 0;
}
export async function maybeOnboard(root, handlers) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.PIC_SETUP_SKIP==='1') return;
  const s=inspectSetup(root);
  if (!s.settingsOk || s.prompted) return;
  if (s.packages.navigation!=='missing' && s.packages.features!=='missing' && s.hook!=='not-detected') return;
  const result=await setupRecommended(root,{...handlers,firstRun:true});
  if (result!==0) console.error('pic: Optional setup incomplete. Core Pi Compose can still start; fix with pic setup.');
}
