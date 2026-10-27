import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { OrcaAgentStore } from '../src/orca/agent-sessions.mjs';

const bridge = new URL('../scripts/orca-native-bridge.mjs', import.meta.url).pathname;
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding:'utf8' }).trim();
}
function rpc(root,command,data,expectError=false) {
  try {
    const out=execFileSync(process.execPath,[bridge,command],{
      cwd:process.cwd(),encoding:'utf8',input:JSON.stringify(data),
      env:{...process.env,PI_COMPOSE_STATE_DIR:join(root,'state')},timeout:20000,
    });
    const packet=JSON.parse(out.trim());
    assert.equal(packet.ok,true);
    return packet.data;
  } catch (err) {
    if(!expectError) throw err;
    const packet=JSON.parse(err.stdout.trim());
    assert.equal(packet.ok,false);
    return packet.error;
  }
}
test('native Orca bridge prepares a real Main, and refuses an empty Main Fork',()=>{
  const tmp=mkdtempSync(join(tmpdir(),'orca-ui-'));
  try {
    const cwd=join(tmp,'repo');mkdirSync(cwd);
    git(cwd,'init','-b','main');
    writeFileSync(join(cwd,'README.md'),'# test');
    git(cwd,'add','.');git(cwd,'-c','user.email=test@example.com',
      '-c','user.name=Test','commit','-m','init');
    const main=rpc(tmp,'main',{cwd,title:'결제 설계'});
    assert.equal(main.record.role,'main');
    assert.equal(main.record.state,'prepared');
    assert.match(readFileSync(main.launcher,'utf8'),/--session-id/);
    assert.ok(rpc(tmp,'list',{cwd}).some(x=>x.id===main.record.id));
    const error=rpc(tmp,'work',{cwd,mainId:main.record.id,task:'구현',workspace:'shared'},true);
    assert.match(error,/먼저 Pi와 설계를 논의/);
    const support=rpc(tmp,'support',{cwd,mainId:main.record.id,task:'조사',workspace:'shared'});
    assert.equal(support.record.role,'support');
    assert.equal(support.record.sourceSessionFile,null);
    assert.notEqual(support.record.sessionId,main.record.sessionId);
    const foreign=join(tmp,'foreign');mkdirSync(foreign);git(foreign,'init');
    assert.match(rpc(tmp,'support',{cwd:foreign,mainId:main.record.id,task:'조사',workspace:'shared'},true),
      /다른 프로젝트/);
  } finally{rmSync(tmp,{recursive:true,force:true});}
});
test('native Orca bridge forks a saved Main with full Pi JSONL, preserving Main bytes',()=>{
  const tmp=mkdtempSync(join(tmpdir(),'orca-saved-'));
  try{
    const cwd=join(tmp,'repo');mkdirSync(cwd);
    git(cwd,'init','-b','main');writeFileSync(join(cwd,'a.txt'),'x');
    git(cwd,'add','.');git(cwd,'-c','user.email=test@example.com',
      '-c','user.name=Test','commit','-m','init');
    const store=new OrcaAgentStore(join(tmp,'state'));
    const session=SessionManager.create(cwd,join(tmp,'sessions'));
    session.appendMessage({role:'user',content:[{type:'text',
      text:'Must preserve backward compatibility for v1 API'}],timestamp:Date.now()});
    const original=session.getSessionFile();
    const main=store.registerMain({cwd,title:'API',sessionId:session.getSessionId(),sessionFile:original});
    const baseline=readFileSync(original,'utf8');
    const work=rpc(tmp,'work',{cwd,mainId:main.id,task:'구현',workspace:'shared'});
    assert.ok(work.proof.allMatch);
    assert.equal(work.record.sourceSessionFile,original);
    assert.equal(readFileSync(original,'utf8'),baseline);
    assert.match(readFileSync(work.launcher,'utf8'),/--session/);
  }finally{rmSync(tmp,{recursive:true,force:true});}
});
