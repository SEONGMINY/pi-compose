import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { HandoffPackage } from './package.ts';
import { readAgentRelationship } from '../agent-relationships.ts';

/**
 * Verify the real Work -> Work* -> Main Fork chain. Work-to-Work forks have
 * a leaf in their immediate parent, NOT in the Main session itself.
 */
export async function workOriginOnMainBranch(
  pkg:HandoffPackage, mainId:string, activeIds:ReadonlySet<string>,
):Promise<boolean>{
  if(pkg.targetMainSessionId!==mainId)return false;
  const sessions=await SessionManager.listAll();
  const byId=new Map(sessions.map(s=>[s.id,s.path]));
  let sourceId=pkg.source.workSessionId;
  const visited=new Set<string>();
  for(let depth=0;depth<20;depth++){
    if(visited.has(sourceId))return false;
    visited.add(sourceId);
    const path=byId.get(sourceId);
    if(!path)return false;
    const manager=SessionManager.open(path);
    if(manager.getSessionId()!==sourceId)return false;
    const identity=readAgentRelationship(sourceId,manager.getEntries());
    if(identity?.role!=='work'||identity.product!==pkg.product||
       !identity.forkSourceSessionId||!identity.forkSourceLeafId)return false;
    if(sourceId===pkg.source.workSessionId &&
       (identity.forkSourceSessionId!==pkg.source.forkSourceSessionId ||
        identity.forkSourceLeafId!==pkg.source.forkLeafId))return false;
    const parentId=identity.forkSourceSessionId;
    if(parentId===mainId)return activeIds.has(identity.forkSourceLeafId);
    sourceId=parentId;
  }
  return false;
}

export function decideDirectReferenceImport(
  pkg:HandoffPackage,mainId:string,lineageValid:boolean,
):{action:'import'|'hold';reason:string}{
  if(pkg.targetMainSessionId!==mainId)return {action:'hold',reason:'wrong-recipient'};
  if(!pkg.approvedMainBrief||!pkg.approvedMainBriefHash)
    return {action:'hold',reason:'missing-approved-brief'};
  if(!lineageValid)return {action:'hold',reason:'fork-branch-not-active'};
  // A user-approved limited or stale Work report remains a WORK REPORT.
  // It does not claim tests passed or override Main policies.
  return {action:'import',reason:'work-approved-reference'};
}
