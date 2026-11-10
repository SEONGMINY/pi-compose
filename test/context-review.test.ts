import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { hashMessage, renderPackage, validateHandoffPackage, createSelectedHandoffPackage, type HandoffPackage } from '../src/handoff/package.ts';
import { contextReviewUnits, selectContextPackage } from '../src/handoff/context-review.ts';
import { prepareManualHandoffCandidates } from '../extensions/handoff-candidates.ts';
import { findVerificationReportQuote } from '../src/handoff/report-verification.ts';

function twoUnits():HandoffPackage {
  const body={
    version:1 as const,id:'00000000-0000-4000-8000-000000000011',
    createdAt:'2026-11-10T09:00:00Z',product:'sample',
    source:{workSessionId:'work-1',forkSourceSessionId:'main-1',
      forkLeafId:'fork-1',workReportEntryId:'work-report'},
    targetMainSessionId:'main-1',
    selectedCandidateIds:['HC1','HC2'],
    claims:[
      {candidateId:'HC1',title:'Implemented behavior',summary:'Filter work reported done.',
        statement:'The filter was implemented.',kind:'work-reported' as const,
        verification:'reported-only' as const,evidenceIds:['E1']},
      {candidateId:'HC2',title:'Optional proposal',summary:'A separate caching suggestion.',
        statement:'Consider caching the list.',kind:'proposal' as const,
        verification:'reported-only' as const,evidenceIds:['E2']},
    ],
    context:[{id:'CX1',reason:'why' as const,
      whyNeeded:'Do not drop the permission constraint.',
      quote:'Keep the role permission rule unchanged.',
      evidenceId:'E3',requiredByClaimIds:['HC1','HC2']}],
    evidence:[
      {id:'E1',sessionId:'work-1',entryId:'work-report',role:'assistant' as const,
        quote:'The filter was implemented.'},
      {id:'E2',sessionId:'work-1',entryId:'work-report',role:'assistant' as const,
        quote:'Consider caching the list.'},
      {id:'E3',sessionId:'work-1',entryId:'original-requirement',role:'user' as const,
        quote:'Keep the role permission rule unchanged.'},
    ],
    contextAssessment:'selected' as const,
  };
  const finalMessage=renderPackage(body);
  return validateHandoffPackage({...body,finalMessage,finalMessageHash:hashMessage(finalMessage)});
}

test('review units show exactly which essential WHY and source accompany a selectable claim',()=>{
  const units=contextReviewUnits(twoUnits());
  assert.equal(units.length,2);
  assert.equal(units[0]?.requiredContext[0]?.reason,'why');
  assert.deepEqual(units[0]?.evidence.map(e=>e.id),['E1','E3']);
  assert.equal(units[0]?.verification,'reported-only');
});

test('selection preserves required shared context but excludes unselected independent claim',()=>{
  const pkg=selectContextPackage(twoUnits(),['HC1'],'review-one');
  assert.deepEqual(pkg.selectedCandidateIds,['HC1']);
  assert.deepEqual(pkg.claims.map(c=>c.candidateId),['HC1']);
  assert.deepEqual(pkg.context[0]?.requiredByClaimIds,['HC1']);
  assert.deepEqual(pkg.evidence.map(e=>e.id),['E1','E3']);
  assert.ok(!pkg.finalMessage.includes('Consider caching the list.'));
  assert.ok(pkg.finalMessage.includes('Keep the role permission rule unchanged.'));
  assert.equal(pkg.qualityReview,undefined);
  assert.equal(hashMessage(pkg.finalMessage),pkg.finalMessageHash);
});

test('selection ID and user note are stable, scoped and never smuggled into source evidence',()=>{
  const first=selectContextPackage(twoUnits(),['HC2'],'review-one','Please discuss later.');
  const second=selectContextPackage(twoUnits(),['HC2'],'review-one','Please discuss later.');
  const changed=selectContextPackage(twoUnits(),['HC2'],'review-one','Different note.');
  assert.equal(first.id,second.id);
  assert.notEqual(first.id,changed.id);
  assert.equal(first.reviewerNote,'Please discuss later.');
  assert.ok(first.finalMessage.includes('User review note (request, NOT verified fact or policy)'));
  assert.equal(first.evidence.length,2);
  assert.ok(first.evidence.every(item=>!item.quote.includes('Please discuss later.')));
  assert.throws(()=>selectContextPackage(twoUnits(),[],'review-one'),/invalid-context-selection/);
  assert.throws(()=>selectContextPackage(twoUnits(),['HC3'],'review-one'),/invalid-context-selection/);
  assert.throws(()=>selectContextPackage(twoUnits(),['HC1','HC1'],'review-one'),/invalid-context-selection/);
});

test('model-less manual < can still present an attributed in-progress Work report',async()=>{
  const report='The feature is currently blocked. No tests have been executed.';
  const ctx={
    model:undefined,
    sessionManager:{
      getSessionId:()=> 'work-1',
      getLeafId:()=> 'report',
      getBranch:()=> [
        {id:'instruction',type:'message',message:{role:'user',content:[{type:'text',text:'Do not change logout policy.'}]}},
        {id:'report',type:'message',message:{role:'assistant',stopReason:'stop',
          content:[{type:'text',text:report}]}},
      ],
    },
  } as unknown as ExtensionContext;
  const result=await prepareManualHandoffCandidates(ctx);
  assert.equal(result.status,'prepared');
  if(result.status!=='prepared')return;
  assert.equal(result.draft.candidates.length,1);
  assert.equal(result.draft.candidates[0]?.sourceEntryId,'report');
  assert.equal(result.draft.candidates[0]?.quote,'The feature is currently blocked. No tests have been executed.');
  assert.ok(!result.draft.candidates[0]?.description.includes('완료했습니다'));
});

test('manual < falls back to a grounded quote after invalid classifier output',async()=>{
  const ctx={
    model:{id:'test'},
    sessionManager:{
      getSessionId:()=> 'work-1',
      getLeafId:()=> 'report',
      getBranch:()=> [{id:'report',type:'message',message:{
        role:'assistant',stopReason:'stop',
        content:[{type:'text',text:'The API restriction is still unverified. No tests run.'}],
      }}],
    },
    modelRegistry:{streamSimple:()=>({result:async()=>({
      stopReason:'stop',content:[{type:'text',text:'not-json'}],
    })})},
  } as unknown as ExtensionContext;
  const result=await prepareManualHandoffCandidates(ctx);
  assert.equal(result.status,'prepared');
  if(result.status==='prepared'){
    assert.equal(result.draft.candidates[0]?.sourceEntryId,'report');
    assert.equal(result.draft.candidates[0]?.title,'Work 보고 원문 · 검토 필요');
  }
});

test('explicit test non-execution survives as an exact report quote',()=>{
  const text='Implemented token refresh.\nTests were not run.\nAn optional caching idea.';
  assert.equal(findVerificationReportQuote(text),'Tests were not run.');
  assert.equal(findVerificationReportQuote('No relevant execution statement here.'),undefined);
  assert.equal(findVerificationReportQuote('테스트를 실행하지 않았습니다.'),'테스트를 실행하지 않았습니다.');
  assert.equal(findVerificationReportQuote('test: API_KEY=secret'),undefined);
});

test('selected implementation report includes its original unrun-test evidence automatically',async()=>{
  const report='Implemented filter.\nTests were not run.';
  const branch:any[]=[{id:'report',type:'message',message:{
    role:'assistant',stopReason:'stop',content:[{type:'text',text:report}],
  }}];
  const ctx={
    model:undefined,
    sessionManager:{
      getSessionId:()=> 'work-1',
      getLeafId:()=> 'report',
      getBranch:()=> branch,
    },
  } as unknown as ExtensionContext;
  const draft={
    version:1 as const,sessionId:'work-1',sourceLeafId:'report',
    reportEntryId:'report',createdAt:'2026-11-10T09:00:00Z',
    candidates:[{
      title:'Implemented filter',description:'Work reports implementation.',
      kind:'finding' as const,sourceEntryId:'report',quote:'Implemented filter.',
    }],
  };
  const owner:any={role:'work',sessionId:'work-1',product:'sample',
    forkSourceSessionId:'main-1',forkSourceLeafId:'main-leaf'};
  const pkg=await createSelectedHandoffPackage(ctx,owner,draft,{
    ids:['HC1'],reviewEntryId:'report',
  },'main-1');
  assert.equal(pkg.contextAssessment,'selected');
  const verification=pkg.context.find(c=>c.id==='CX-VERIFICATION');
  assert.equal(verification?.quote,'Tests were not run.');
  assert.deepEqual(verification?.requiredByClaimIds,['HC1']);
  assert.equal(pkg.evidence.find(e=>e.id===verification?.evidenceId)?.entryId,'report');
  assert.ok(pkg.finalMessage.includes('Tests were not run.'));
  const subset=selectContextPackage(pkg,['HC1'],'review');
  assert.ok(subset.finalMessage.includes('Tests were not run.'));
});
