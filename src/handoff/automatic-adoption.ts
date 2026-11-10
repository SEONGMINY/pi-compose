import type { HandoffPackage } from './package.ts';
import type { MainComparison } from './compare.ts';

export type AutoAdoptionDecision =
  | {action:'adopt';reason:'new-work-report'}
  | {action:'duplicate';reason:'already-covered'}
  | {action:'hold';reason:
      'brief-not-approved'|'source-main-mismatch'|'source-branch-not-active'|
      'incomplete-context'|'comparison-incomplete'|'conflict-or-uncertainty'};

/**
 * Work approval authorizes adding ONLY a source-attributed Work report.
 * Never automatically adopt a proposal as policy. Never silently drop an
 * approved part of the Brief or re-author the approved text.
 *
 * The Main must check its *current active branch*. A Work that branched from
 * another Main, or from a branch the Main has since abandoned, is held.
 */
export function decideAutomaticAdoption(
  pkg:HandoffPackage,
  comparison:MainComparison,
  mainSessionId:string,
  activeBranchEntryIds:ReadonlySet<string>,
):AutoAdoptionDecision {
  if(!pkg.approvedMainBrief || !pkg.approvedMainBriefHash)
    return {action:'hold',reason:'brief-not-approved'};
  if(mainSessionId!==pkg.targetMainSessionId ||
     pkg.source.forkSourceSessionId!==mainSessionId)
    return {action:'hold',reason:'source-main-mismatch'};
  if(!activeBranchEntryIds.has(pkg.source.forkLeafId))
    return {action:'hold',reason:'source-branch-not-active'};
  if(pkg.contextAssessment==='unavailable')
    return {action:'hold',reason:'incomplete-context'};
  if(comparison.packageId!==pkg.id||
     comparison.mainSessionId!==mainSessionId||
     comparison.items.length!==pkg.claims.length||
     new Set(comparison.items.map(item=>item.claimId)).size!==pkg.claims.length||
     pkg.claims.some(claim=>!comparison.items.some(item=>item.claimId===claim.candidateId)))
    return {action:'hold',reason:'comparison-incomplete'};
  if(comparison.items.some(item=>
    item.status==='conflict'||item.status==='insufficient'||
    item.unresolvedQuestions.length>0))
    return {action:'hold',reason:'conflict-or-uncertainty'};
  if(comparison.items.every(item=>item.status==='duplicate'))
    return {action:'duplicate',reason:'already-covered'};
  return {action:'adopt',reason:'new-work-report'};
}
