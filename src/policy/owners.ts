import { listProductHandoffSessions, findParentMainSessionId } from '../product-sessions.ts';
import type { AgentRelationship } from '../agent-relationships.ts';

/**
 * Request hierarchy and Fork lineage are independent. Resolve both and refuse
 * a silent subscription when two different Mains appear in those relations.
 */
export async function resolvePolicyMain(work:AgentRelationship):Promise<string|undefined>{
  if(work.role!=='work'||!work.forkSourceSessionId)return;
  const peers=await listProductHandoffSessions(work.product);
  const source=peers.find(p=>p.id===work.forkSourceSessionId);
  const requesterMain=findParentMainSessionId(peers,work.sessionId);
  const forkMain=source?.role==='main'?source.id:
    source?.role==='work'?findParentMainSessionId(peers,source.id):undefined;
  if(requesterMain&&forkMain&&requesterMain!==forkMain)return;
  return requesterMain??forkMain;
}
