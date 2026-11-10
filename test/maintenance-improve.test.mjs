import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEdits, executeImprovement, parseVerdict, readPolicy, runTrustedChecks } from '../maintenance/improve.mjs';

function git(dir,...args){return execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();}
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t,mode='draft') {
  const root=await mkdtemp(join(tmpdir(),'maintenance-improve-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  git(root,'init','--initial-branch=main');
  await mkdir(join(root,'src')); await mkdir(join(root,'.maintenance','reviews'),{recursive:true});
  await mkdir(join(root,'test'));
  await writeFile(join(root,'.gitignore'),'.maintenance/\n');
  await writeFile(join(root,'src','a.js'),'export const flag = false;\n');
  await writeFile(join(root,'test','maintenance-smoke.test.mjs'),"import test from 'node:test';test('smoke',()=>{});\n");
  git(root,'add','.gitignore','src/a.js','test/maintenance-smoke.test.mjs');
  git(root,'-c','user.name=Test','-c','user.email=test@example.com','commit','-m','base');
  const base=git(root,'rev-parse','HEAD');
  const policyFile=join(root,'.maintenance','automation-policy.json');
  await writeFile(policyFile,JSON.stringify({schemaVersion:1,mode,allowAutoMain:mode==='local-main',
    allowedPaths:['src/a.js'],checks:['project']}));
  const id=randomUUID();
  const review={id,taskIds:['earlier-task'],candidate:{title:'Improve flag',layer:'architecture',executionState:'proposed-not-approved'},
    decision:{selected:'architecture',blocked:false,economicEvidence:'forecast-not-verified'},
    findings:[{evidence:[{source:'repo-file',path:'src/a.js',sha256:hash('export const flag = false;\n')}]}]};
  await writeFile(join(root,'.maintenance','reviews',`${id}.json`),JSON.stringify(review));
  return {root,dir:join(root,'.maintenance'),policyFile,id,base};
}
const propose=async()=>JSON.stringify({edits:[{path:'src/a.js',old:'flag = false',replacement:'flag = true'}],rationale:'Improve behavior'});
const verify=async()=>JSON.stringify({verdict:'pass',summary:'Verified existing contract',risks:[],limitations:[]});
const checks=async()=>[{name:'project',exitCode:0,timedOut:false}];

test('dry run reads policy and review but does not edit main',async t=>{
  const f=await fixture(t);
  const r=await executeImprovement({repo:f.root,dir:f.dir,policyFile:f.policyFile,reviewId:f.id,dryRun:true});
  assert.equal(r.dryRun,true);assert.equal(git(f.root,'rev-parse','HEAD'),f.base);
  assert.match(await readFile(join(f.root,'src/a.js'),'utf8'),/false/);
});

test('native worktree checks do not use Docker and have fixed binaries',async t=>{
  const f=await fixture(t);
  const calls=[];
  const results=await runTrustedChecks(f.root,['maintenance','project'],async (bin,args)=>{
    calls.push({bin,args});return {code:0,timedOut:false,stdout:'ok',stderr:''};
  });
  assert.equal(results.length,2);
  assert.equal(calls[0].bin,process.execPath);
  assert.equal(calls[1].bin,'npm');
  assert.deepEqual(calls[1].args,['run','check']);
  assert.equal(calls.some(c=>c.bin==='docker'),false);
});

test('approved improvement fast-forwards LOCAL main after verified checks',async t=>{
  const f=await fixture(t,'local-main');
  const r=await executeImprovement({repo:f.root,dir:f.dir,policyFile:f.policyFile,reviewId:f.id,propose,verify,checks});
  assert.equal(r.state,'integrated-local',r.error);
  assert.notEqual(git(f.root,'rev-parse','HEAD'),f.base);
  assert.equal(await readFile(join(f.root,'src/a.js'),'utf8'),'export const flag = true;\n');
  assert.equal(r.mode,'local-main');
});


test('draft mode preserves a reachable branch without modifying main',async t=>{
  const f=await fixture(t,'draft');
  const r=await executeImprovement({repo:f.root,dir:f.dir,policyFile:f.policyFile,reviewId:f.id,propose,verify,checks});
  assert.equal(r.state,'verified-draft',r.error);
  assert.equal(git(f.root,'rev-parse','HEAD'),f.base);
  assert.equal(git(f.root,'rev-parse',r.branch),r.commit);
  assert.match(await readFile(join(f.root,'src/a.js'),'utf8'),/false/);
});

test('independent review failure leaves main unchanged',async t=>{
  const f=await fixture(t,'local-main');
  const r=await executeImprovement({repo:f.root,dir:f.dir,policyFile:f.policyFile,reviewId:f.id,
    propose,checks,verify:async()=>JSON.stringify({verdict:'block',summary:'Concern',risks:['Bug'],limitations:[]})});
  assert.equal(r.state,'blocked');
  assert.equal(git(f.root,'rev-parse','HEAD'),f.base);
  assert.match(await readFile(join(f.root,'src/a.js'),'utf8'),/false/);
});

test('unapproved file edits are rejected even if the model proposes them',async t=>{
  const f=await fixture(t);
  await assert.rejects(applyEdits(f.root,{edits:[{path:'src/other.js',old:'x',replacement:'y'}],rationale:'x'},
    {allowedPaths:['src/a.js']}),/not allowed/);
  assert.match(await readFile(join(f.root,'src/a.js'),'utf8'),/false/);
});

test('policy cannot be placed in tracked code or accept arbitrary commands',async t=>{
  const f=await fixture(t);
  await assert.rejects(readPolicy(f.root,join(f.root,'src/a.js')),/Policy must/);
  await writeFile(f.policyFile,JSON.stringify({schemaVersion:1,mode:'draft',allowedPaths:['src/a.js'],checks:['bash -c rm'] }));
  await assert.rejects(readPolicy(f.root,f.policyFile),/fixed commands/);
});

test('verifier output must be structured and may not mask risks',()=>{
  assert.equal(parseVerdict(JSON.stringify({verdict:'block',summary:'Risk',risks:['unsafe'],limitations:[]})).verdict,'block');
  assert.throws(()=>parseVerdict('PASS'),/Expected JSON/);
});
