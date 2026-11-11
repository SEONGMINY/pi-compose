import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasBeenInspected, latestPolicyReviews, resolvedApprovalIds,
  POLICY_REVIEW_VERSION,
} from '../src/policy/reviews.ts';

const review=(id:string,status:string,extra:Record<string,unknown>={})=>({
  type:'custom',customType:'compose_policy_reviewed',
  data:{approvalEntryId:id,status,reviewVersion:POLICY_REVIEW_VERSION,...extra},
});

test('latest approval review overrides an earlier ambiguous classification',()=>{
  const entries=[
    review('u1','ambiguous',{reason:'원문 검증 실패'}),
    review('u2','published'),
    review('u1','resolved',{resolution:'covered-by-decision',coveredByDecisionId:'approved-123'}),
  ];
  const latest=latestPolicyReviews(entries);
  assert.equal(latest.get('u1')?.status,'resolved');
  assert.deepEqual([...resolvedApprovalIds(entries)].sort(),['u1','u2']);
});

test('unresolved candidate remains visible until a real review is recorded',()=>{
  const entries=[review('u1','ambiguous',{reason:'동일 정책 대체 여부 미확정'})];
  assert.deepEqual([...resolvedApprovalIds(entries)],[]);
  assert.equal(hasBeenInspected(latestPolicyReviews(entries).get('u1')),true);
  const resolved=[...entries,review('u1','ignored',{resolution:'not-policy',userReviewed:true})];
  assert.deepEqual([...resolvedApprovalIds(resolved)],['u1']);
});

test('earlier ambiguous review can be rechecked after review-version upgrade',()=>{
  assert.equal(hasBeenInspected({approvalEntryId:'u1',status:'ambiguous',reviewVersion:1}),false);
  assert.equal(hasBeenInspected({approvalEntryId:'u1',status:'ambiguous',reviewVersion:POLICY_REVIEW_VERSION}),true);
  assert.equal(hasBeenInspected({approvalEntryId:'u1',status:'ignored',reviewVersion:1}),true);
  assert.equal(hasBeenInspected(undefined),false);
});

test('review records for invalid entry types are ignored',()=>{
  const entries=[
    {type:'message',customType:'compose_policy_reviewed',
      data:{approvalEntryId:'u1',status:'ignored'}},
    {type:'custom',customType:'unrelated',data:{approvalEntryId:'u2',status:'resolved'}},
    {type:'custom',customType:'compose_policy_reviewed',
      data:{approvalEntryId:'u3',status:'made-up'}},
  ];
  assert.deepEqual([...resolvedApprovalIds(entries)],[]);
});
