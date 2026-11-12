import { REVIEW_ENTRY } from './decisions.ts';

export const POLICY_REVIEW_VERSION=3;
export type PolicyReviewRecord={
  approvalEntryId:string;
  reviewVersion?:number;
  status:'published'|'ignored'|'ambiguous'|'resolved';
  reason?:string;
  resolution?:'not-policy'|'covered-by-decision';
  coveredByDecisionId?:string;
  userReviewed?:boolean;
};

export function latestPolicyReviews(
  entries:readonly unknown[],
):Map<string,PolicyReviewRecord>{
  const latest=new Map<string,PolicyReviewRecord>();
  for(const raw of entries){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
    const entry=raw as {type?:unknown;customType?:unknown;data?:unknown};
    if(entry.type!=='custom'||entry.customType!==REVIEW_ENTRY)continue;
    const d=entry.data;
    if(!d||typeof d!=='object'||Array.isArray(d))continue;
    const data=d as Partial<PolicyReviewRecord>;
    if(typeof data.approvalEntryId!=='string')continue;
    if(!['published','ignored','ambiguous','resolved'].includes(data.status??''))continue;
    latest.set(data.approvalEntryId,data as PolicyReviewRecord);
  }
  return latest;
}

/** Only actual terminal reviews can remove a warning: no silent dismissal. */
export function resolvedApprovalIds(entries:readonly unknown[]):Set<string>{
  const resolved=new Set<string>();
  for(const [id,review] of latestPolicyReviews(entries)){
    if(review.status==='published'||review.status==='ignored'||review.status==='resolved')
      resolved.add(id);
  }
  return resolved;
}

export function hasBeenInspected(
  record:PolicyReviewRecord|undefined,
  currentReviewVersion=POLICY_REVIEW_VERSION,
):boolean{
  if(!record)return false;
  return record.status!=='ambiguous'||record.reviewVersion===currentReviewVersion;
}
