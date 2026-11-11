/**
 * Work owns interpretation of approved Main policy updates.
 * This pure policy maps observable delivery facts to an optional user-initiated
 * review turn. It does not approve Main decisions or alter Work's fork.
 */
export type WorkPolicyReviewState={
  status:'checked'|'delivered'|'pending'|'unavailable';
  pendingDecisionIds:readonly string[];
  withdrawnDecisionIds:readonly string[];
  unreviewedApprovalCount?:number;
};
export type WorkPolicyReviewPlan=
  |{kind:'review';prompt:string}
  |{kind:'notice';level:'info'|'warning';message:string};

export const POLICY_REVIEW_PROMPT=[
  'Main의 승인된 정책 변경을 이 Work의 현재 작업 맥락에서 검토해주세요.',
  '이 Work에 전달된 정책 변경의 실제 원문·이유(기록되어 있는 경우에만)·이전 상태와의 차이·현재 작업에 주는 영향·필요한 후속 조치를 간결하게 설명해주세요.',
  '확정되지 않은 Main 승인 후보는 확정 정책으로 해석하거나 승격하지 마세요.',
  '이 응답은 정책 검토이며, 파일 수정·터미널 명령·테스트 실행·Handoff 전송을 하지 마세요.',
  '정책 전달 또는 검토를 코드 구현·테스트 완료라고 표현하지 마세요. 근거가 없으면 미확인이라고 표시해주세요.',
].join('\n');

export function planWorkPolicyReview(state:WorkPolicyReviewState):WorkPolicyReviewPlan{
  const newCount=state.pendingDecisionIds.length+state.withdrawnDecisionIds.length;
  const unreviewed=state.unreviewedApprovalCount??0;

  if(state.status==='unavailable'){
    return {kind:'notice',level:'warning',
      message:unreviewed
        ? 'Main에 미확정 승인 후보 '+unreviewed+
          '건이 있어 정책 최신성을 확인할 수 없습니다. Main에서 /compose policy로 원문을 검토해주세요.'
        : 'Main 정책 최신성 또는 소유자 검증에 실패했습니다. 확인되지 않은 내용을 Work 정책으로 사용하지 않습니다.'};
  }
  // An explicit request should never silently create a model turn if the
  // current Work has already reviewed all known changes.
  if(state.status==='checked'){
    return {kind:'notice',level:'info',
      message:'이 Work가 추가로 검토할 Main 정책 변경이 없습니다. 새로운 모델 호출을 시작하지 않았습니다.'};
  }
  if(state.status==='delivered'||(state.status==='pending'&&newCount>0)){
    return {kind:'review',prompt:POLICY_REVIEW_PROMPT};
  }
  return {kind:'notice',level:'info',
    message:'검토할 확정 정책 변경이 없습니다. 새로운 모델 호출을 시작하지 않았습니다.'};
}
