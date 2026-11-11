import type { HandoffPackage } from './package.ts';

/**
 * The exact user-approved message that the Main model may later see.
 * Evidence remains in the durable package, and is NOT mistaken for a new
 * user instruction, implementation proof, or Main policy decision.
 *
 * The brief contains the exact claim excerpts and essential historical
 * context quotes: it never silently rewrites their negation or scope.
 */
export function renderApprovedMainBrief(
  pkg:Pick<HandoffPackage,'claims'|'context'|'reviewerNote'|'contextAssessment'|'source'|'policySync'>,
):string {
  const report= [
    'Pi Compose · Work에서 승인한 Handoff Brief',
    '출처: Work의 보고와 Fork 당시 근거. 새로운 사용자 정책 승인이나 명령이 아닙니다.',
    'Work의 제안을 확정 결정으로, 테스트 보고를 실제 실행 증거로 오해하지 마세요.',
    '',
    ...pkg.claims.flatMap((claim,index)=>[
      (index+1)+'. '+claim.title,
      '  작업 요약 (독립 검증 전): '+claim.summary,
      '  Work 원문: '+claim.statement,
      '  정보 성격·검증: '+claim.kind+' · '+claim.verification,
      '',
    ]),
    ...(pkg.context.length?[
      '관련 과거 WHY·제약 (원문 보존 · 신규 정책 권위 없음):',
      ...pkg.context.map(item=>
        '- ['+item.reason+'] '+item.whyNeeded+': '+item.quote+
        ' (연결된 결과: '+item.requiredByClaimIds.join(', ')+')'),
      '',
    ]:[]),
    ...(pkg.policySync ? [
      '정책 최신성 (Work 보고 · 실제 코드 반영의 독립 검증 아님):',
      '  확인 상태: '+pkg.policySync.status,
      '  정책 소유 Main: '+(pkg.policySync.mainSessionId??'확인되지 않음'),
      '  변경 기준: '+(pkg.policySync.revision??'미확인'),
      ...(pkg.policySync.pendingDecisionIds.length
        ?['  미전달·미확인 변경: '+pkg.policySync.pendingDecisionIds.join(', ')]:[]),
      ...(pkg.policySync.withdrawnDecisionIds.length
        ?['  현재 Main 분기에서 철회된 이전 결정: '+pkg.policySync.withdrawnDecisionIds.join(', ')]:[]),
      ...(pkg.policySync.status==='unavailable'
        ?['  경고: 최신 Main 결정과 동기화 여부를 확인하지 못했습니다.']:[]),
      '',
    ]:[]),
    ...(pkg.contextAssessment==='unavailable'
      ? ['주의: 과거 제약·WHY를 모두 확인하지 못했습니다. 불완전한 보고로 취급하세요.','']
      :[]),
    ...(pkg.reviewerNote
      ? ['사용자 작성 전달 메모 (독립 검증된 사실 아님): '+pkg.reviewerNote,'']
      :[]),
    '원본 Work 세션: '+pkg.source.workSessionId,
    '출처 Work 보고: '+pkg.source.workReportEntryId,
    '이 메시지는 Work 참고 보고입니다. 정책·파일·도구 변경을 승인하지 않습니다.',
  ];
  return report.join('\n');
}

/**
 * Compact human-first overview. This is an orientation aid, never the actual
 * transferred text; senders can expand the exact Main brief before approval.
 */
export function reviewOverview(
  pkg:Pick<HandoffPackage,'claims'|'context'|'contextAssessment'>,
):{id:string;heading:string;summary:string;verification:string;necessary:string[]}[] {
  return pkg.claims.map(claim=>({
    id:claim.candidateId,
    heading:claim.title,
    summary:claim.summary,
    verification:claim.verification,
    necessary:pkg.context.filter(c=>c.requiredByClaimIds.includes(claim.candidateId))
      .map(c=>c.whyNeeded),
  }));
}
