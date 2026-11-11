import test from 'node:test';
import assert from 'node:assert/strict';
import { planWorkPolicyReview, POLICY_REVIEW_PROMPT, type WorkPolicyReviewState } from '../src/policy/work-review-request.ts';

const state=(status:WorkPolicyReviewState['status'],
  extras:Partial<WorkPolicyReviewState>={}):WorkPolicyReviewState=>({
    status,pendingDecisionIds:[],withdrawnDecisionIds:[],...extras,
  });

test('?p reviews only approved changes the Work has not handled yet',()=>{
  const result=planWorkPolicyReview(state('pending',{pendingDecisionIds:['new-approved-main-decision']}));
  assert.equal(result.kind,'review');
  if(result.kind==='review'){
    assert.equal(result.prompt,POLICY_REVIEW_PROMPT);
    assert.match(result.prompt,/이 Work의 현재 작업 맥락에서 검토/);
    assert.match(result.prompt,/파일 수정·터미널 명령·테스트 실행·Handoff 전송을 하지 마세요/);
    assert.match(result.prompt,/승인 후보는 확정 정책으로 해석하거나 승격하지 마세요/);
  }
});

test('?p can inspect withdrawal of a previously approved decision',()=>{
  assert.equal(planWorkPolicyReview(state('pending',{withdrawnDecisionIds:['withdrawn'] })).kind,'review');
});

test('?p can complete an already-delivered but unanswered policy review',()=>{
  assert.equal(planWorkPolicyReview(state('delivered')).kind,'review');
});

test('?p does not run a model for a Work that already checked all new policy',()=>{
  const plan=planWorkPolicyReview(state('checked'));
  assert.equal(plan.kind,'notice');
  if(plan.kind==='notice') {
    assert.equal(plan.level,'info');
    assert.match(plan.message,/추가로 검토할 Main 정책 변경이 없습니다/);
  }
});

test('?p never promotes unresolved Main candidate into confirmed policy',()=>{
  const plan=planWorkPolicyReview(state('unavailable',{unreviewedApprovalCount:1,
    pendingDecisionIds:['confirmed-but-freshness-not-established']}));
  assert.equal(plan.kind,'notice');
  if(plan.kind==='notice'){
    assert.equal(plan.level,'warning');
    assert.match(plan.message,/Main에서 \/compose policy/);
  }
});

test('?p fails closed when Main snapshot/owner cannot be verified',()=>{
  const plan=planWorkPolicyReview(state('unavailable'));
  assert.equal(plan.kind,'notice');
  if(plan.kind==='notice')assert.match(plan.message,/최신성 또는 소유자 검증에 실패/);
});

test('inconsistent pending state without policy delta never invents model review',()=>{
  assert.equal(planWorkPolicyReview(state('pending')).kind,'notice');
});
