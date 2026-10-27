import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { diagnosticEvent, diagnosticStatus, discloseDiagnostics, startFlow, finishFlow } from '../src/diagnostics.mjs';
import { installedProvenance, installedExecutables } from '../src/provenance.mjs';

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
  const packageCandidates=[
    ...((Array.isArray(settings.value?.packages)?settings.value.packages:[])
      .map(p=>({scope:'global',source:typeof p==='string'?p:p?.source,base:agentDir()}))),
    ...((Array.isArray(project.value?.packages)?project.value.packages:[])
      .map(p=>({scope:'project',source:typeof p==='string'?p:p?.source,base:join(process.cwd(),'.pi')}))),
  ];
  const composeSources=packageCandidates
    .filter(p=>typeof p.source==='string'
      && /(?:pi-compose|packages\\/(?:navigation|optional))/i.test(p.source))
    .map(p=>({scope:p.scope,source:p.source,location:/^(npm:|git:|https?:)/.test(p.source)
      ?p.source:resolve(p.base,p.source)}));
  const hookFile = join(agentDir(), 'extensions/workmux-status.ts');
  const hasHook = existsSync(hookFile)
    || (Array.isArray(settings.value?.extensions)
      && settings.value.extensions.some(e => typeof e === 'string'
        && /workmux-status\.(ts|js)/.test(e)));
  return {
    settingsOk:settings.ok && project.ok, consentOk:consent.ok,
    prompted:consent.ok && consent.value?.prompted === true,
    choice:consent.value?.choice,
    packages, composeSources, hook:hasHook ? 'detected' : 'not-detected',
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
  const build=installedProvenance(root);
  console.log('Pi Compose version: ' + pkgVersion + ' | installed commit: ' + (build.revision || 'UNKNOWN') + ' | provenance: ' + build.origin);
  console.log('Installed package root: ' + build.packageRoot + (build.ref ? ' | source ref: ' + build.ref : ''));
  const executables=installedExecutables();
  for(const entry of executables) console.log('PATH pic: '+entry.command+' -> '+entry.path);
  if (executables.length > 1) console.log('WARNING: Multiple different pic executables exist on PATH; inspect the one actually invoked.');
  if (!build.revision) console.log('WARNING: Commit cannot be verified. Use the pinned installer or run inside a Git checkout. An npm git URL alone is NOT proof of the installed revision.');
  console.log('Main Extension path: ' + join(build.packageRoot,'extensions/compose.ts'));
  console.log('Child navigation path: ' + join(build.packageRoot,'packages/navigation/extensions/navigator.ts'));
  console.log('Run /compose version inside EACH currently running Pi to check its loaded Extension path and process age.');
  console.log('Node: '+s.node+' | Pi: '+(s.pi||'missing')+' | tmux: '+(s.tmux||'missing')+' | workmux: '+(s.workmux||'missing'));
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 19))
    console.log('WARNING: Node.js >= 22.19.0 is required. Select a compatible Node version.');
  console.log('Child navigation: '+s.packages.navigation+' | Handoff/Verify: '+s.packages.features+' | Pi status Hook: '+s.hook);
  for(const source of s.composeSources)console.log('Registered Pi Compose package ('+source.scope+'): '+source.location);
  if(new Set(s.composeSources.map(x=>x.location)).size>1)console.log('WARNING: More than one Pi Compose package source is registered. Old Extensions may still be loaded in a running Pi process. Inspect pi config and /compose version in each window.');
  const diag=diagnosticStatus();
  console.log('Local UX diagnostics: '+(diag.enabled?'enabled':'disabled')+' | Retention: '+diag.retentionDays+' days | Inspect: pic diagnostics status');
  if (!s.settingsOk) console.log('WARNING: Pi settings.json cannot be parsed. No configuration will be modified.');
  if (s.packages.navigation === 'custom' || s.packages.features === 'custom')
    console.log('Pi resource filters were customized; inspect exact enabled extensions with pi config.');
  if (s.packages.navigation === 'project-only' || s.packages.features === 'project-only')
    console.log('Some Packages are PROJECT-ONLY; new Worktrees may not load them. Use pi config --local or explicitly opt in globally.');
  if (s.hook === 'not-detected') console.log('workmux status Hook was not detected; dashboard agent state may be empty. Run pic setup.');
  if (s.choice === 'skip') console.log('Earlier configuration declined; preserving your choice. Use pic setup to enable core defaults.');
  console.log('If settings changed while Pi was running, use /reload in that session.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 19);
  return s.settingsOk && nodeOk && s.pi && s.tmux && s.workmux ? 0 : 1;
}

/**
 * All first-party Compose capabilities are the product default, not an opt-in
 * bundle. Pi owns settings and resource exclusions. A previous explicit
 * decline/removal is respected; "pic setup" is the deliberate repair command.
 */
export async function setupRecommended(root,{runPi,runWorkmux,firstRun=false,manual=false} = {}) {
  const state=inspectSetup(root);
  if(!state.settingsOk){
    console.error('pic: Pi settings are malformed. Nothing was modified. Inspect pic doctor.');
    diagnosticEvent('setup.finished',{source:'cli',outcome:'failure',data:{reason:'settings_invalid'}});
    return 1;
  }
  const flow=startFlow('setup.started',{source:manual?'cli':'automatic'});
  const missing=[
    ['navigation',state.packages.navigation==='missing',join(root,'packages/navigation')],
    ['handoff-verify',state.packages.features==='missing',join(root,'packages/optional')]
  ];
  for(const [component,needed,path] of missing){
    if(!needed)continue;
    diagnosticEvent('setup.component',{source:'automatic',flowId:flow.flowId,outcome:'unavailable',data:{component}});
    console.log('pic: Setting up default Pi Compose '+component+' Extension via official pi install...');
    let code;
    try {code=await runPi(['install',path]);}catch{code=1;}
    if(code!==0){
      console.error('pic: '+component+' install failed. Earlier successful steps remain. Retry with pic setup.');
      diagnosticEvent('setup.component',{source:'automatic',flowId:flow.flowId,outcome:'failure',data:{component}});
      finishFlow(flow,'setup.finished',{source:'automatic',outcome:'failure',data:{reason:'pi_package_error'}});
      return code||1;
    }
    // A zero exit code is not sufficient if Pi did not persist the package.
    const verified=inspectSetup(root);
    const key=component==='navigation'?'navigation':'features';
    if(verified.packages[key]==='missing'||verified.packages[key]==='unknown') {
      console.error('pic: '+component+' command exited successfully but Pi package is not registered. Check pic doctor, retry pic setup.');
      diagnosticEvent('setup.component',{source:'automatic',flowId:flow.flowId,outcome:'failure',data:{component}});
      finishFlow(flow,'setup.finished',{source:'automatic',outcome:'failure',data:{reason:'pi_package_error'}});
      return 1;
    }
    diagnosticEvent('setup.component',{source:'automatic',flowId:flow.flowId,outcome:'success',data:{component}});
  }
  // This is an acknowledgement, not a feature registry. Never re-enable a
  // package later intentionally removed by the user.
  remember('core-default-v2');
  if(state.hook==='not-detected' && process.stdin.isTTY && process.stdout.isTTY
    && (manual||!state.prompted)) {
    console.log('pic: workmux Dashboard requires a Pi status Hook to show active agents.');
    console.log('workmux setup may also offer changes for other installed coding agents.');
    diagnosticEvent('setup.hook_prompted',{source:'automatic',flowId:flow.flowId});
    if(await yes('Open workmux official Hook-only setup? Review each agent before accepting.',false)){
      const code=await runWorkmux(['setup','--hooks']);
      if(code!==0){
        finishFlow(flow,'setup.finished',{source:'automatic',outcome:'failure',data:{reason:'workmux_hook_error'}});
        console.error('pic: workmux Hook setup did not complete. Core features are ready; retry: pic setup.');
        return code||1;
      }
      if(inspectSetup(root).hook==='not-detected')
        console.log('pic: Pi status Hook not detected. workmux setup may have skipped Pi; use pic setup to retry.');
    }else{
      console.log('pic: Hook unchanged. workmux Dashboard opens, but its Agents view may be empty.');
    }
  }
  finishFlow(flow,'setup.finished',{source:manual?'cli':'automatic',outcome:'success'});
  if(!firstRun)console.log('pic: Core Compose features prepared. New Pi sessions load extensions automatically; existing ones may need /reload.');
  return 0;
}
export async function maybeOnboard(root,handlers) {
  if(!process.stdin.isTTY||!process.stdout.isTTY||process.env.PIC_SETUP_SKIP==='1')return;
  try {discloseDiagnostics();} catch {console.error('pic: Could not save UX diagnostics disclosure. See pic diagnostics status.');}
  const s=inspectSetup(root);
  if(!s.settingsOk)return;
  // A previous explicit skip or completed default installation is not
  // permission to re-enable resources the user later removed.
  // Any earlier explicit onboarding choice is treated as a preference. We
  // cannot distinguish a later deliberate Pi package removal from a missing
  // install; never silently re-enable it on upgrade. pic setup is the override.
  if(s.prompted)return;
  await setupRecommended(root,{...handlers,firstRun:true}).then(code=>{
    if(code!==0)console.error('pic: Core setup incomplete. Retry with pic setup; unrelated Pi settings were preserved.');
  });
}
