import { SessionManager } from '@earendil-works/pi-coding-agent';
import { readAgentRelationship } from '../agent-relationships.ts';
import { makePolicySnapshot, type PolicySnapshot } from './store.ts';

/** Strong, Handoff-only freshness check: compare the cache to the persisted
 * owner Main's current active Pi branch. Ordinary Work turns use cheap snapshots.
 */
export async function isSnapshotCurrentAtHandoff(snapshot:PolicySnapshot):Promise<boolean>{
  const sessions=await SessionManager.listAll();
  const info=sessions.find(s=>s.id===snapshot.mainSessionId);
  if(!info)return false;
  const manager=SessionManager.open(info.path);
  if(manager.getSessionId()!==snapshot.mainSessionId)return false;
  const rel=readAgentRelationship(snapshot.mainSessionId,manager.getEntries());
  if(rel?.role!=='main'||rel.product!==snapshot.product)return false;
  const leaf=manager.getLeafId();
  if(!leaf||leaf!==snapshot.activeLeafId)return false;
  const current=makePolicySnapshot(snapshot.mainSessionId,snapshot.product,
    leaf,manager.getBranch());
  return current.revision===snapshot.revision;
}
