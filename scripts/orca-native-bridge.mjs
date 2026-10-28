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
const runGit = (cwd, ...args) => execFileSync('git',args,{
  cwd,encoding:'utf8',timeout:15_000,
}).trim();
const gitRoot = cwd => {
  const common = resolve(cwd,runGit(cwd,'rev-parse','--git-common-dir'));
  return common.endsWith('/.git') ? dirname(common) : runGit(cwd,'rev-parse','--show-toplevel');
};
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
  if (command==='begin-worktree-creation') {
    const cwd=resolve(requiredText(args.cwd,'프로젝트 경로',2000));
    const main=belonging(args.mainId,cwd);
    const role=requiredText(args.role,'역할',20);
    return store.beginCreation({
      mainId:main.id, role, cwd,
      title:requiredText(args.title,'작업 이름',200),
      relatedWorkId: args.relatedWorkId || null,
      activeLeafId: args.activeLeafId || null,
      expectedSourceEntryId: args.expectedSourceEntryId || null
    });
  }
  if (command==='pending-worktree-creation') {
    const cwd=resolve(requiredText(args.cwd,'프로젝트 경로',2000));
    const main=belonging(args.mainId,cwd);
    return store.pendingCreation(main.id);
  }
  if (command==='record-worktree-creation') {
    const cwd=resolve(requiredText(args.cwd,'프로젝트 경로',2000));
    const main=belonging(args.mainId,cwd);
    return store.recordCreatedWorkspace({
      mainId:main.id,
      operationId:requiredText(args.creationIntentId,'생성 의도 ID',48),
      workspace:args.managedWorktree
    });
  }
  if (command==='preview-work-fork') {
    const cwd=resolve(requiredText(args.cwd,'프로젝트 경로',2000));
    const main=belonging(args.mainId,cwd);
    return store.previewMainFork({
      mainId:main.id, SessionManager,
      ...(typeof args.activeLeafId==='string' && args.activeLeafId
        ? {activeLeafId:args.activeLeafId} : {})
    });
  }
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
  if (command==='linked-work-results') {
    const cwd=resolve(requiredText(args.cwd,'프로젝트 경로',2000));
    const main=belonging(args.mainId,cwd);
    return store.linkedWorkResults({mainId:main.id,SessionManager});
  }
  if (command==='support-result') {
    const id=requiredText(args.id,'Support ID',48);
    const support=store.get(id);
    if (!support || support.role!=='support' ||
        gitRoot(args.cwd)!==support.projectRoot) {
      throw new Error('이 프로젝트의 Support 결과만 조회할 수 있습니다.');
    }
    return store.supportResult({id,SessionManager});
  }
  if (command==='connection-failed') {
    const id=requiredText(args.id,'Work ID',48);
    const target=store.get(id);
    if (!target || gitRoot(args.cwd)!==target.projectRoot) {
      throw new Error('선택한 Work의 상태를 변경할 수 없습니다.');
    }
    return store.markConnectionFailed({
      id, message: requiredText(args.message, '연결 오류', 500)
    });
  }
  if (command==='attach-chat') {
    const id = requiredText(args.id,'Agent ID',48);
    const existing = store.get(id);
    if (!existing || gitRoot(args.cwd)!==existing.projectRoot) {
      throw new Error('선택한 Work 대화를 연결할 수 없습니다.');
    }
    if (existing.sessionId !== requiredText(args.sessionId,'Pi 원본 세션 ID',120)) {
      throw new Error('연결하려는 Orca Chat과 등록된 Agent의 Pi 세션 ID가 다릅니다.');
    }
    return store.attachNativeChat({
      id,
      orcaSessionId:requiredText(args.orcaSessionId,'Orca 세션 ID',100),
      worktreeId:requiredText(args.worktreeId,'작업 공간 ID',512),
      replaceClosed: args.replaceClosed === true,
    });
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
  if (command==='set-work-main-visibility') {
    const cwd=resolve(requiredText(args.cwd,'프로젝트 경로',2000));
    const main=belonging(args.mainId,cwd);
    const workId=requiredText(args.id,'Work ID',48);
    if (typeof args.hidden!=='boolean') throw new Error('목록 표시 설정이 올바르지 않습니다.');
    return store.setWorkMainVisibility({
      mainId:main.id, workId, hidden:args.hidden
    });
  }
  if (command==='list') {
    const projectRoot=gitRoot(requiredText(args.cwd,'프로젝트 경로',2000));
    return store.list().filter(item=>item.projectRoot===projectRoot)
      .map(item=>({id:item.id,title:item.title,role:item.role,
        parentMainId:item.parentMainId||null,relatedWorkId:item.relatedWorkId||null,
        hiddenFromMainAt:item.hiddenFromMainAt||null,
        cwd:item.cwd,workspace:item.workspace||'shared',
        sessionId:item.sessionId,sessionFile:item.sessionFile||null,cwd:item.cwd,launcher:item.launcher||null,
        orcaSessionId:item.orcaSessionId||null,
        connectionError:item.connectionError||null,
        orcaTabId:item.orcaTabId||null,orcaWorktreeId:item.orcaWorktreeId||null,
        ...(item.workspace==='worktree'?{branch:item.branch,baseSha:item.baseSha}:{}),
        ...(item.role==='work'?{proof:store.inspect(item.id).fork,
          sourceEntryId:item.sourceEntryId,excludedInProgress:!!item.excludedInProgress}:{}),
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
      SessionManager,
    });
    return {record:result,launcher:result.launcher};
  }
  if (command==='work'||command==='support') {
    const main=belonging(args.mainId,cwd);
    const workspace=args.workspace;
    if (!['shared','worktree'].includes(workspace))throw new Error('지원하지 않는 Git 작업 공간입니다.');
    const title=requiredText(args.title || args.task,'Agent 이름',200);
    const relatedWorkId=args.relatedWorkId;
    if (relatedWorkId!==undefined && (command!=='support'||typeof relatedWorkId!=='string')) {
      throw new Error('Support Agent에만 Work 연결을 지정할 수 있습니다.');
    }
    let executionCwd=cwd;
    if (command==='support' && relatedWorkId) {
      const linked=store.get(relatedWorkId);
      if (!linked || linked.role!=='work' || linked.parentMainId!==main.id ||
          linked.projectRoot!==main.projectRoot) {
        throw new Error('이 Support가 연결된 Work를 확인할 수 없습니다.');
      }
      executionCwd=linked.cwd;
    }
    const managedWorktree = workspace === 'worktree' ? args.managedWorktree : undefined;
    const creationIntentId = workspace === 'worktree'
      ? requiredText(args.creationIntentId,'Orca Worktree 생성 의도 ID',48) : null;
    if (creationIntentId) {
      store.assertCreationReceipt({
        mainId:main.id, operationId:creationIntentId, role:command, managedWorktree,
        title, relatedWorkId:relatedWorkId || null,
        activeLeafId: args.activeLeafId || null,
        expectedSourceEntryId: args.expectedSourceEntryId || null
      });
    }
    if (managedWorktree && (
      typeof managedWorktree.id !== 'string' ||
      typeof managedWorktree.path !== 'string' ||
      gitRootSafe(managedWorktree.path) !== main.projectRoot
    )) {
      throw new Error('Orca가 생성한 동일 Git 프로젝트의 Worktree만 연결할 수 있습니다.');
    }
    const result=store.prepareForMain({
      mainId:main.id,role:command,workspace,title,
      relatedWorkId,projectCwd:executionCwd,
      managedWorktree, creationIntentId,
      ...(typeof args.activeLeafId === 'string' && args.activeLeafId
        ? { activeLeafId: args.activeLeafId } : {}),
      ...(typeof args.expectedSourceEntryId === 'string' && args.expectedSourceEntryId
        ? { expectedSourceEntryId: args.expectedSourceEntryId } : {}),
      SessionManager,
      launcherPath:{extension,piBinary:process.env.PI_COMPOSE_PI_BINARY||'pi'},
    });
    if (creationIntentId) {
      store.finishCreation({ mainId:main.id, operationId:creationIntentId, agentId:result.id });
    }
    return {record:result,launcher:result.launcher,
      ...(command==='work'?{proof:store.inspect(result.id).fork}:{})};
  }
  throw new Error('지원하지 않는 Pi Compose 작업입니다.');
}
const command=process.argv[2];
try {response({ok:true,data:await run(command,await input())});}
catch(error){response({ok:false,error:error instanceof Error?error.message:String(error)});process.exitCode=1;}
