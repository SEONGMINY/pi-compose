import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { OrcaAgentStore } from '../src/orca/agent-sessions.mjs';

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

test('actual Pi SessionManager: Work inherits Main conversation and constraints; Support does not', () => {
  const tmp=mkdtempSync(join(tmpdir(),'compose-real-pi-'));
  try {
    const cwd=join(tmp,'repo');
    mkdirSync(cwd);
    git(cwd,'init','-b','main');
    writeFileSync(join(cwd,'README.md'),'# Fixture\n');
    git(cwd,'add','README.md');
    git(cwd,'-c','user.email=test@example.com','-c','user.name=Tester','commit','-m','init');
    const source=SessionManager.create(cwd,join(tmp,'main-sessions'));
    source.appendMessage({role:'user',content:[{type:'text',text:'Never remove the legacy API label field'}],timestamp:Date.now()});
    source.appendMessage({role:'user',content:[{type:'text',text:'Reason: existing mobile clients still require label'}],timestamp:Date.now()});
    const sourcePath=source.getSessionFile();
    assert.ok(sourcePath && existsSync(sourcePath));
    const store=new OrcaAgentStore(join(tmp,'state'));
    const main=store.registerMain({
      cwd, sessionId:source.getSessionId(), sessionFile:sourcePath, title:'Legacy compatibility',
    });
    const original=readFileSync(sourcePath,'utf8');
    const mgr={
      open:path=>SessionManager.open(path),
      forkFrom:(path,cwd,dir,options)=>SessionManager.forkFrom(path,cwd,join(tmp,'fork-sessions'),options),
    };
    const launcherPath={extension:'/tmp/orca-compose.ts',piBinary:'pi'};
    const work=store.prepare({role:'work',main,task:'Implement without dropping label',
      workspace:'shared',projectCwd:cwd,launcherPath,SessionManager:mgr});
    assert.equal(store.inspect(work.id).fork.allMatch,true);
    assert.equal(work.sourceEntryId,source.getLeafEntry()?.id);
    const fork=SessionManager.open(work.sessionFile);
    assert.equal(fork.getBranch().length,source.getBranch().length);
    assert.deepEqual(fork.getBranch().map(e=>e.id),source.getBranch().map(e=>e.id));
    assert.equal(readFileSync(sourcePath,'utf8'),original);
    const support=store.prepare({role:'support',main,task:'Run tests only',
      workspace:'shared',projectCwd:cwd,launcherPath,SessionManager:mgr});
    assert.equal(support.sessionFile,null);
    assert.equal(support.sourceSessionFile,null);
    assert.equal(store.inspect(support.id).fork,null);
  } finally { rmSync(tmp,{recursive:true,force:true}); }
});
