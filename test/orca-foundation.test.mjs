import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { OrcaAgentStore } from '../src/orca/agent-sessions.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}
function fakeManager() {
  return {
    open(path) {
      const entries=readFileSync(path,'utf8').trim().split('\n').map(JSON.parse);
      return { getLeafEntry: () => entries.at(-1), getBranch: () => entries.slice(1) };
    },
    forkFrom(source, cwd, _dir, options) {
      const data=readFileSync(source,'utf8').trim().split('\n').map(JSON.parse);
      const targetDir=join(cwd,'.test-sessions');
      mkdirSync(targetDir,{recursive:true});
      const path=join(targetDir,options.id+'.jsonl');
      writeFileSync(path,[
        JSON.stringify({type:'session',id:options.id,cwd,parentSession:source}),
        ...data.slice(1).map(JSON.stringify),
      ].join('\n')+'\n');
      return {getSessionId:()=>options.id,getSessionFile:()=>path};
    },
  };
}
function fixture(fn) {
  const temp=mkdtempSync(join(tmpdir(),'compose-orca-'));
  const cwd=join(temp,'example');
  mkdirSync(cwd);
  git(cwd,'init','-b','main');
  writeFileSync(join(cwd,'README.md'),'# Sample\n');
  git(cwd,'add','README.md');
  git(cwd,'-c','user.email=test@example.com','-c','user.name=Tester','commit','-m','Initial commit');
  const session=join(temp,'main.jsonl');
  const id=randomUUID();
  const history=[
    {type:'session',id,cwd,timestamp:new Date().toISOString()},
    {type:'message',id:'u1',parentId:null,message:{role:'user',content:[{type:'text',text:'API v1 compatibility MUST NOT break'}]}},
    {type:'message',id:'a2',parentId:'u1',message:{role:'assistant',content:[{type:'text',text:'Keep old field because existing clients depend on it'}]}},
    {type:'message',id:'u3',parentId:'a2',message:{role:'user',content:[{type:'text',text:'Do not delete label field, ever'}]}},
  ];
  writeFileSync(session,history.map(JSON.stringify).join('\n')+'\n');
  const store=new OrcaAgentStore(join(temp,'store'));
  try {return fn({temp,cwd,session,id,history,store});}
  finally {rmSync(temp,{recursive:true,force:true});}
}
function options(data) {
  return {
    ...data,
    SessionManager: fakeManager(),
    launcherPath:{extension:'/tmp/orca-compose.ts',piBinary:'pi'},
  };
}

test('many Main conversations coexist and exact source identity is enforced', () => fixture(
  ({cwd,session,id,store}) => {
    const main=store.registerMain({cwd,sessionFile:session,sessionId:id,title:'Architecture'});
    assert.equal(main.role,'main');
    assert.equal(store.registerMain({cwd,sessionFile:session,sessionId:id,title:'Other'}).id,main.id);
    assert.equal(store.selectedMain({cwd,sessionFile:session,sessionId:id}).id,main.id);
    assert.throws(()=>store.selectedMain({cwd,sessionFile:'/tmp/other',sessionId:id}),/다릅니다/);
    assert.throws(()=>store.selectedMain({cwd,sessionFile:session,sessionId:randomUUID()}),/compose-main/);
  }
));

test('Work copies ALL Pi JSONL entries without changing source; launcher is not auto-executed', () => fixture(
  ({cwd,session,id,store,history}) => {
    const main=store.registerMain({cwd,sessionFile:session,sessionId:id,title:'API design'});
    const mainBefore=readFileSync(session,'utf8');
    const agent=store.prepare(options({
      role:'work',main,task:'Implement User API WITHOUT removing label',
      workspace:'shared',projectCwd:cwd,
    }));
    assert.equal(agent.sourceSessionFile,session);
    assert.equal(agent.sourceSessionId,id);
    assert.equal(agent.sourceEntryId,'u3');
    assert.equal(agent.state,'prepared');
    assert.equal(agent.role,'work');
    const copy=readFileSync(agent.sessionFile,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(copy[0].parentSession,session);
    assert.deepEqual(copy.slice(1),history.slice(1));
    assert.equal(readFileSync(session,'utf8'),mainBefore);
    assert.deepEqual(store.inspect(agent.id).fork,{allMatch:true,copied:3,expected:3});
    assert.match(readFileSync(agent.launcher,'utf8'),/--session/);
    assert.match(readFileSync(agent.launcher,'utf8'),/WITHOUT removing label/);
  }
));

test('Support has its own session ID, no source JSONL or parent context', () => fixture(
  ({cwd,session,id,store}) => {
    const main=store.registerMain({cwd,sessionFile:session,sessionId:id,title:'Design'});
    const agent=store.prepare(options({role:'support',main,
      task:'Run tests and return summary',workspace:'shared',projectCwd:cwd}));
    assert.equal(agent.sourceSessionFile,null);
    assert.equal(agent.sourceSessionId,null);
    assert.equal(agent.sessionFile,null);
    assert.equal(agent.role,'support');
    assert.match(readFileSync(agent.launcher,'utf8'),/--session-id/);
    assert.ok(!readFileSync(agent.launcher,'utf8').includes(session));
    assert.equal(store.inspect(agent.id).fork,null);
  }
));

test('context and workspace decisions are independent; Worktree does not copy uncommitted files', () => fixture(
  ({cwd,session,id,store}) => {
    const main=store.registerMain({cwd,sessionFile:session,sessionId:id,title:'Architecture'});
    writeFileSync(join(cwd,'uncommitted.txt'),'Important but not committed');
    const agent=store.prepare(options({role:'work',main,task:'Change architecture',
      workspace:'worktree',projectCwd:cwd}));
    assert.equal(agent.workspace,'worktree');
    assert.equal(git(cwd,'worktree','list','--porcelain').includes(agent.cwd),true);
    assert.equal(readFileSync(agent.sessionFile,'utf8').split('\n')[0].includes(session),true);
    assert.equal(agent.cwd === cwd,false);
    assert.equal(agent.branch.startsWith('compose/work-'),true);
  }
));

test('multiple Work/Support records never rewrite the Main JSONL or each other', () => fixture(
  ({cwd,session,id,store}) => {
    const main=store.registerMain({cwd,sessionFile:session,sessionId:id,title:'API'});
    const first=store.prepare(options({role:'work',main,task:'Implementation',workspace:'shared',projectCwd:cwd}));
    const second=store.prepare(options({role:'support',main,task:'Test',workspace:'shared',projectCwd:cwd}));
    assert.notEqual(first.sessionId,second.sessionId);
    assert.equal(store.list().filter(e=>e.parentMainId===main.id).length,2);
    assert.equal(store.list().length,3);
  }
));
