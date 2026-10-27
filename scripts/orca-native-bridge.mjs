#!/usr/bin/env node
/**
 * Native Orca IPC talks to this narrow Node bridge over stdin/stdout.
 * The bridge owns Pi SDK and Git; React cannot read or mutate session JSONL.
 * stdout contains ONE JSON envelope only. No shell execution of renderer input.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { OrcaAgentStore } from '../src/orca/agent-sessions.mjs';

const extension = resolve(dirname(fileURLToPath(import.meta.url)), '../extensions/orca-compose.ts');
const store = new OrcaAgentStore();
const gitRoot = cwd => execFileSync('git',['rev-parse','--show-toplevel'],{
  cwd,encoding:'utf8',timeout:15_000,
}).trim();
const response = envelope => process.stdout.write(JSON.stringify(envelope)+'\n');
async function input() {
  let body='';
  for await (const chunk of process.stdin) {
    body += chunk.toString('utf8');
    if (body.length>16_000) throw new Error('요청 크기가 너무 큽니다.');
  }
  return body ? JSON.parse(body) : {};
}
const requiredText = (value,name,max=5000) => {
  if (typeof value!=='string' || !value.trim() || value.length>max) {
    throw new Error(name+'이(가) 비어 있거나 너무 깁니다.');
  }
  return value.trim();
};
function belonging(mainId, cwd) {
  const main=store.get(requiredText(mainId,'Main ID',48));
  if (!main||main.role!=='main') throw new Error('선택한 Main Agent가 없습니다.');
  if (gitRoot(cwd)!==main.projectRoot) {
    throw new Error('다른 프로젝트의 Main Agent를 선택했습니다.');
  }
  return main;
}
const gitRootSafe = cwd => {try{return gitRoot(cwd)}catch{return null}};
async function run(command,args) {
  if (command==='sessions') {
    const cwd=resolve(requiredText(args.cwd,'프로젝트 경로',2000));
    const root=gitRoot(cwd);
    const sessions=await SessionManager.list(cwd);
    return sessions.filter(session=>session.path && session.cwd &&
        gitRootSafe(session.cwd)===root && session.messageCount>0)
      .slice(0,100).map(session=>({
        id:session.id, title:session.name || session.firstMessage?.slice(0,90) || 'Pi 대화',
        messageCount:session.messageCount, path:session.path,
      }));
  }
  if (command==='attach') {
    const id = requiredText(args.id,'Agent ID',48);
    const existing = store.get(id);
    if (!existing || gitRoot(args.cwd)!==existing.projectRoot) {
      throw new Error('다른 프로젝트의 Agent를 연결할 수 없습니다.');
    }
    return store.attachTerminal({
      id,tabId:requiredText(args.tabId,'터미널 ID',100),
      worktreeId:requiredText(args.worktreeId,'작업 공간 ID',512),
    });
  }
  if (command==='list') {
    const projectRoot=gitRoot(requiredText(args.cwd,'프로젝트 경로',2000));
    return store.list().filter(item=>item.projectRoot===projectRoot)
      .map(item=>({id:item.id,title:item.title,role:item.role,
        parentMainId:item.parentMainId||null,cwd:item.cwd,workspace:item.workspace||'shared',
        sessionId:item.sessionId,launcher:item.launcher||null,
        orcaTabId:item.orcaTabId||null,orcaWorktreeId:item.orcaWorktreeId||null,
        ...(item.role==='work'?{proof:store.inspect(item.id).fork}:{}),
        state:item.state||'prepared'}));
  }
  const cwd=resolve(requiredText(args.cwd,'프로젝트 경로',2000));
  if (command==='import') {
    const id=requiredText(args.sessionId,'세션 ID',120);
    const file=SessionManager.findById(cwd,id);
    if (!file) throw new Error('선택한 Pi 세션이 없거나 다른 프로젝트에 속합니다.');
    const result=store.registerExistingMain({
      cwd,sessionFile:file,sessionId:id,
      title:requiredText(args.title,'Main 이름',200),
      launcherPath:{extension,piBinary:process.env.PI_COMPOSE_PI_BINARY||'pi'},
    });
    return {record:result,launcher:result.launcher};
  }
  if (command==='main') {
    const result=store.createMain({
      cwd,title:requiredText(args.title,'Main 이름',200),
      launcherPath:{extension,piBinary:process.env.PI_COMPOSE_PI_BINARY||'pi'},
    });
    return {record:result,launcher:result.launcher};
  }
  if (command==='work'||command==='support') {
    const main=belonging(args.mainId,cwd);
    const workspace=args.workspace;
    if (!['shared','worktree'].includes(workspace))throw new Error('지원하지 않는 Git 작업 공간입니다.');
    const result=store.prepareForMain({
      mainId:main.id,role:command,workspace,
      task:requiredText(args.task,'작업 지시'),
      SessionManager,
      launcherPath:{extension,piBinary:process.env.PI_COMPOSE_PI_BINARY||'pi'},
    });
    return {record:result,launcher:result.launcher,
      ...(command==='work'?{proof:store.inspect(result.id).fork}:{})};
  }
  throw new Error('지원하지 않는 Pi Compose 작업입니다.');
}
const command=process.argv[2];
try {response({ok:true,data:await run(command,await input())});}
catch(error){response({ok:false,error:error instanceof Error?error.message:String(error)});process.exitCode=1;}
