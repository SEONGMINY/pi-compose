import { type HandoffPackage, stablePackageId, hashMessage, renderPackage, validateHandoffPackage } from './package.ts';
import { renderApprovedMainBrief } from './brief.ts';

/**
 * A reviewable unit is an already-grounded claim with its required context.
 * The UI never chooses a bare title independently of why/scope/verification.
 */
export type ContextReviewUnit = {
  id: string;
  title: string;
  summary: string;
  statement: string;
  kind: HandoffPackage['claims'][number]['kind'];
  verification: HandoffPackage['claims'][number]['verification'];
  requiredContext: HandoffPackage['context'];
  evidence: HandoffPackage['evidence'];
  contextAssessment: HandoffPackage['contextAssessment'];
};

export function contextReviewUnits(pkg: HandoffPackage): ContextReviewUnit[] {
  const valid = validateHandoffPackage(pkg);
  const evidence = new Map(valid.evidence.map(item => [item.id, item]));
  return valid.claims.map(claim => {
    const requiredContext = valid.context.filter(item => item.requiredByClaimIds.includes(claim.candidateId));
    const sourceIds = new Set([
      ...claim.evidenceIds,
      ...requiredContext.map(item => item.evidenceId),
    ]);
    return {
      id: claim.candidateId, title: claim.title, summary: claim.summary,
      statement: claim.statement, kind: claim.kind,
      verification: claim.verification, requiredContext,
      evidence: [...sourceIds].map(id => evidence.get(id)!).filter(Boolean),
      contextAssessment: valid.contextAssessment,
    };
  });
}

/**
 * Project a reviewed set of already-grounded units into a complete package.
 * No model call runs when the user toggles a selection. All unrelated claims
 * and supporting quotations are discarded, and the exact body is regenerated.
 */
/** Update the exact visible Brief, never silently change a previously approved body. */
export function withPolicySync(
  input:HandoffPackage,policySync:HandoffPackage['policySync'],
):HandoffPackage {
  const base=validateHandoffPackage(input);
  const updated={...base,policySync};
  if(!base.approvedMainBrief)return validateHandoffPackage(updated);
  const approvedMainBrief=renderApprovedMainBrief(updated);
  return validateHandoffPackage({...updated,
    approvedMainBrief,approvedMainBriefHash:hashMessage(approvedMainBrief)});
}

export function selectContextPackage(
  input: HandoffPackage, ids: readonly string[], reviewId: string, note = '',
): HandoffPackage {
  const pkg = validateHandoffPackage(input);
  if (!reviewId) throw Error('review-id-required');
  const chosen = new Set(ids);
  if (!chosen.size || chosen.size !== ids.length ||
      ids.some(id => !pkg.selectedCandidateIds.includes(id)))
    throw Error('invalid-context-selection');
  const selectedCandidateIds = pkg.selectedCandidateIds.filter(id => chosen.has(id));
  const claims = pkg.claims.filter(claim => chosen.has(claim.candidateId));
  const context = pkg.context.flatMap(item => {
    const requiredByClaimIds = item.requiredByClaimIds.filter(id => chosen.has(id));
    return requiredByClaimIds.length ? [{...item, requiredByClaimIds}] : [];
  });
  const requiredEvidence = new Set([
    ...claims.flatMap(claim => claim.evidenceIds),
    ...context.map(item => item.evidenceId),
  ]);
  const evidence = pkg.evidence.filter(item => requiredEvidence.has(item.id));
  const reviewerNote = note.trim().slice(0,1200);
  const contextAssessment: HandoffPackage['contextAssessment'] =
    pkg.contextAssessment==='unavailable'?'unavailable'
      :context.length?'selected':'none-needed';
  const {qualityReview: _discardedReview, ...base} = pkg;
  const draft = {
    ...base,
    // Scope the replay identifier to the exact selected context. A user-driven
    // evidence refinement may change WHY without changing candidate IDs; that
    // must not silently reuse an older, different stored body.
    id: stablePackageId(pkg.source.workSessionId,pkg.source.workReportEntryId,
      reviewId+':'+hashMessage(JSON.stringify({claims,context,evidence,policySync:pkg.policySync})).slice(0,20),
      pkg.targetMainSessionId,selectedCandidateIds,reviewerNote),
    selectedCandidateIds, claims, context, evidence,
    contextAssessment,
    ...(reviewerNote ? {reviewerNote} : {reviewerNote:undefined}),
  };
  const finalMessage = renderPackage(draft);
  const approvedMainBrief = renderApprovedMainBrief(draft);
  return validateHandoffPackage({
    ...draft,
    finalMessage,finalMessageHash:hashMessage(finalMessage),
    approvedMainBrief,approvedMainBriefHash:hashMessage(approvedMainBrief),
  });
}
