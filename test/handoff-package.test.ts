import test from 'node:test';
import assert from 'node:assert/strict';
import { hashMessage, parseCandidateChoice, stablePackageId, validateHandoffPackage, type HandoffPackage } from '../src/handoff/package.ts';
import type { PreparedHandoff } from '../extensions/handoff-candidates.ts';

export function samplePackage(): HandoffPackage {
  const quote='The label field must not be removed.';
  const finalMessage='Main review only. Candidate summary: Keep legacy clients compatible. Original quote: '+quote;
  return {
    version:1,id:'00000000-0000-4000-8000-000000000001',
    createdAt:'2026-11-10T00:00:00.000Z',product:'project-test',
    source:{workSessionId:'work-test',forkSourceSessionId:'main-test',
      forkLeafId:'main-leaf',workReportEntryId:'report-1'},
    targetMainSessionId:'main-test',selectedCandidateIds:['HC1'],
    claims:[{candidateId:'HC1',title:'Preserve label',summary:'Keep legacy clients compatible.',
      statement:quote,kind:'work-reported',verification:'reported-only',
      evidenceIds:['E-HC1']}],
    context:[],evidence:[{id:'E-HC1',sessionId:'work-test',entryId:'report-1',
      role:'assistant',quote}],
    contextAssessment:'none-needed',
    finalMessage,finalMessageHash:hashMessage(finalMessage),
  };
}
function draft():PreparedHandoff {
  return {version:1,sessionId:'work-test',reportEntryId:'report-1',
    sourceLeafId:'report-1',createdAt:'2026-11-10T00:00:00.000Z',
    candidates:[
      {title:'Preserve label',description:'Keep the field',
        kind:'constraint',sourceEntryId:'report-1',quote:'The label field must not be removed.'},
      {title:'No tests run',description:'Reported only',
        kind:'finding',sourceEntryId:'report-1',quote:'Tests were not run.'},
    ]};
}
test('ask_user selection maps only exact visible candidate options to stable IDs',()=>{
  const value=parseCandidateChoice({cancelled:false,response:{
    kind:'selection',selections:['[HC2] No tests run'],
    comment:'Retain uncertainty',
  }},draft());
  assert.deepEqual(value,{ids:['HC2'],note:'Retain uncertainty'});
  assert.equal(parseCandidateChoice({response:{kind:'selection',selections:['Other']}},
    draft()),undefined);
  assert.equal(parseCandidateChoice({cancelled:true,response:null},draft()),undefined);
  assert.equal(parseCandidateChoice({response:{kind:'freeform',text:'Approve all'}} as any,
    draft()),undefined);
});
test('selected package validates exact body, provenance and scope',()=>{
  assert.equal(validateHandoffPackage(samplePackage()).claims[0]?.candidateId,'HC1');
});
test('tampered final message fails closed',()=>{
  const pkg=samplePackage();pkg.finalMessage+=' Tests passed.';
  assert.throws(()=>validateHandoffPackage(pkg),/handoff-body-hash-mismatch/);
});
test('selected but unsupported claim fails closed',()=>{
  const pkg=samplePackage();pkg.claims[0]!.statement='Tests passed.';
  pkg.finalMessage+=' Tests passed.';
  pkg.finalMessageHash=hashMessage(pkg.finalMessage);
  assert.throws(()=>validateHandoffPackage(pkg),/handoff-evidence-or-context-invalid/);
});
test('unselected claim cannot enter the package',()=>{
  const pkg=samplePackage();
  pkg.claims.push({...pkg.claims[0]!,candidateId:'HC2'});
  assert.throws(()=>validateHandoffPackage(pkg),/handoff-selected-scope-mismatch/);
});
test('context quote must match its own evidence, not only another source',()=>{
  const pkg=samplePackage();
  pkg.context=[{id:'ctx1',reason:'why',whyNeeded:'Compatibility',
    quote:'Tests passed',evidenceId:'E-HC1',requiredByClaimIds:['HC1']}];
  pkg.finalMessage+=' Tests passed';
  pkg.finalMessageHash=hashMessage(pkg.finalMessage);
  assert.throws(()=>validateHandoffPackage(pkg),/handoff-evidence-or-context-invalid/);
});

test('package ID is replay-stable for one approved review, changes when selected scope changes',()=>{
  const first=stablePackageId('work','report','review','main',['HC2','HC1'],'Add WHY');
  const same=stablePackageId('work','report','review','main',['HC1','HC2'],'Add WHY');
  const changed=stablePackageId('work','report','review','main',['HC1'],'Add WHY');
  assert.equal(first,same);
  assert.notEqual(first,changed);
  assert.match(first,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('semantic review receipt proves only which exact body was inspected, not factual truth',()=>{
  const pkg=samplePackage();
  pkg.qualityReview={
    verdict:'acceptable',
    method:'model-semantic-review',
    modelId:'test-evaluator',
    reviewedAt:'2026-11-10T00:00:00Z',
    checkedBodyHash:pkg.finalMessageHash,
  };
  assert.equal(validateHandoffPackage(pkg).qualityReview?.modelId,'test-evaluator');
  pkg.qualityReview.checkedBodyHash='0'.repeat(64);
  assert.throws(()=>validateHandoffPackage(pkg),/handoff-quality-receipt-body-mismatch/);
});
