/** Repo-local user scope contract, pinned to every Task. Not a semantic classifier. */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

export const SCOPE_CONTRACT_PATH = 'tools/development-harness/contracts/pi-compose-maintenance.json';
const hash = value=>createHash('sha256').update(value).digest('hex');
const LOCAL_SETUP_FILES=['.devh.json','.codex/hooks.json','.pi/settings.json',
  '.codex/devh-hooks.merge-example.json','.pi/devh-settings.merge-example.json'];
async function localSetupDigests(root){
  const files={};
  for(const path of LOCAL_SETUP_FILES){
    try{files[path]=hash(await readFile(join(root,path)))}
    catch(e){if(e.code==='ENOENT')files[path]=null;else throw e;}
  }
  return files;
}
const nonempty = s=>typeof s==='string'&&s.trim().length>0&&s.length<=500;
const validPath = s=>typeof s==='string'&&s.length>0&&!s.startsWith('/')&&!s.includes('..')&&!s.includes('\\');

export function validateScopeContract(data){
  if(!data||data.schemaVersion!==1||!nonempty(data.id)||!Number.isSafeInteger(data.revision)||data.revision<1||
     data.decisionState!=='approved-scope'||!nonempty(data.purpose)||
     !nonempty(data.appliesTo?.packageName)||!nonempty(data.appliesTo?.repository)||
     !Array.isArray(data.requirements)||!data.requirements.length||
     !data.requirements.every(r=>nonempty(r?.id)&&r.status==='approved'&&nonempty(r.text))||
     new Set(data.requirements.map(r=>r.id)).size!==data.requirements.length||
     !Array.isArray(data.boundaries?.included)||!data.boundaries.included.every(nonempty)||
     !Array.isArray(data.boundaries?.excluded)||!data.boundaries.excluded.every(nonempty)||
     !Array.isArray(data.boundaries?.protectedPaths)||!data.boundaries.protectedPaths.every(validPath)||
     !data.boundaries.protectedPaths.includes(SCOPE_CONTRACT_PATH))
    throw Error('Invalid project scope contract (schema/version/authority/boundaries)');
  return data;
}
async function load(root){
  const file=join(root,SCOPE_CONTRACT_PATH);
  try{
    const raw=await readFile(file,'utf8');
    return {contract:validateScopeContract(JSON.parse(raw)),sha256:hash(raw)};
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function shellGit(root,args){
  return execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:3000,maxBuffer:200_000}).trim();
}
function explicitExternalGoal(prompt){
  // Only clear affirmative requests. References or prohibitions must not be treated
  // as approvals, nor should this heuristic pretend to prove semantic scope.
  const text=String(prompt??'').trim();
  const firstClause=text.split(/[.!?\n;]/)[0];
  if(/(?:하지\s*마|하지\s*않|금지|do not|don't|without)/i.test(firstClause))return false;
  return /^(?:(?:please|now)\s+)?(?:develop|implement|modify|fix|edit|build)\s+(?:(?:the|an)\s+)?(?:upstream\s+)?(?:Pi|Codex)\s+(?:upstream\s+)?(?:runtime|core|source|cli)(?:\b|\s)/i.test(firstClause)
    || /^(?:Pi|Codex)\s*(?:자체|본체|원본|업스트림)\s*(?:소스(?:코드)?|코어|내부)?\s*(?:를|을)?\s*(?:개발|수정|구현|변경)/.test(firstClause);
}

/** The snapshot is pinned before code modification; later edits cannot self-approve. */
export async function captureScope(root,prompt){
  let loaded;
  try{loaded=await load(root)}catch(e){return {status:'needs-review',basis:'invalid-contract',reason:String(e.message??e).slice(0,200),contract:null};}
  if(!loaded){
    let name=null;
    try{name=JSON.parse(await readFile(join(root,'package.json'),'utf8')).name??null}catch{}
    if(name==='pi-compose')return {status:'needs-review',basis:'missing-pi-compose-scope-contract',
      reason:'The target pi-compose repository is missing its approved scope contract.',contract:null};
    return {status:'not-configured',basis:'no-project-contract',contract:null};
  }
  const {contract,sha256}=loaded;
  let packageName=null;
  try{packageName=JSON.parse(await readFile(join(root,'package.json'),'utf8')).name??null}catch{}
  const identityMatches=contract.appliesTo.packageName===packageName;
  const explicitExternal=explicitExternalGoal(prompt);
  return {
    status:identityMatches&&!explicitExternal?'repository-anchored':'needs-review',
    basis:!identityMatches?'repository-identity-mismatch':explicitExternal?'explicit-external-target':'repo-identity-only',
    localSetup:await localSetupDigests(root),
    contract:{id:contract.id,revision:contract.revision,sha256,path:SCOPE_CONTRACT_PATH,
      requirementIds:contract.requirements.map(r=>r.id)},
    reason:!identityMatches?'Project package does not match the approved target':explicitExternal?'Request explicitly targets the upstream agent, not pi-compose':null,
    caveat:'Repository identity and explicit text hints do not verify semantic intent or functionality.'
  };
}

/** Check actual local Git changes, after tests, without rewriting the original snapshot. */
export async function assessTaskScope(root,task){
  const before=task.scope;
  if(!before||before.status==='not-configured')return {status:'unverified',basis:'no-pinned-scope-contract',changedPaths:null};
  if(before.status==='needs-review')return {status:'needs-review',basis:before.basis,changedPaths:null,reason:before.reason};
  let current;
  try{current=await load(root)}catch(e){return {status:'needs-review',basis:'contract-invalid-after-work',reason:String(e.message??e).slice(0,200),changedPaths:null};}
  if(!current||current.sha256!==before.contract.sha256)return {
    status:'needs-review',basis:'scope-contract-changed',reason:'The approved contract changed after Task start; no automatic approval is inferred.',changedPaths:null};
  const currentSetup=await localSetupDigests(root);
  const modifiedSetup=Object.keys(currentSetup).filter(path=>currentSetup[path]!==before.localSetup?.[path]);
  if(modifiedSetup.length)return {status:'needs-review',basis:'local-harness-settings-changed',
    reason:'Local hook/configuration state changed after Task start; approval is not implied.',changedPaths:modifiedSetup};
  if(task.source?.clean!==true||!task.source.head)return {
    status:'unverified',basis:'no-clean-git-baseline',reason:'Cannot attribute the modified files to this Task.',changedPaths:null};
  let files=[];
  try{
    shellGit(root,['merge-base','--is-ancestor',task.source.head,'HEAD']);
    const changed=shellGit(root,['diff','--name-only',task.source.head,'--']);
    const untracked=shellGit(root,['ls-files','--others','--exclude-standard']);
    files=[...new Set([...changed.split('\n'),...untracked.split('\n')].filter(Boolean))].sort();
  }catch{return {status:'unverified',basis:'git-changes-unavailable',changedPaths:null};}
  const protectedFiles=files.filter(p=>current.contract.boundaries.protectedPaths.includes(p));
  if(protectedFiles.length)return {status:'needs-review',basis:'protected-policy-path-modified',
    reason:'Approved policy/contract files changed during Task; user decision is not inferred from a Git diff.',changedPaths:files,protectedFiles};
  return {status:'no-violation-observed',basis:'repository-and-git-diff',changedPaths:files,
    caveat:'Does not prove semantic compliance or acceptance; checks only repository identity and protected paths.'};
}

export async function getScopeContract(root){
  const value=await load(root);
  return value?{schemaVersion:1,sha256:value.sha256,contract:value.contract}:{schemaVersion:1,status:'not-configured'};
}

/** Only fully structurally checked pi-compose Tasks may authorize an automatic
 * maintenance intervention. A JSON contract or model cannot self-approve. */
export function trustedImprovementScope(task){
  return Boolean(['completed','delivered-unverified','verification-failed'].includes(task?.status) &&
    task?.scope?.status==='repository-anchored' &&
    task.scopeGate?.status==='no-violation-observed' && task.scope.contract?.id==='pi-compose-maintenance' &&
    (Array.isArray(task.scopeGate?.changedPaths) && (task.scopeGate.changedPaths.length===0 ||
      task.semanticGate?.status==='no-drift-observed')));
}
