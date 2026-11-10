import test from 'node:test';
import assert from 'node:assert/strict';
import {hashMessage, type HandoffPackage} from '../src/handoff/package.ts';
import {renderMainImport} from '../src/handoff/import.ts';
import type {MainComparison} from '../src/handoff/compare.ts';

function fixtures() {
  const quote='Keep label for compatibility.';
  const tests='The test execution status is not confirmed.';
  const body=quote+'\n'+tests;
  const pkg:HandoffPackage={
    version:1,id:'00000000-0000-4000-8000-000000000003',
    createdAt:'2026-11-10T00:00:00Z',product:'demo',
    source:{workSessionId:'work-a',forkSourceSessionId:'main-a',
      forkLeafId:'fork-a',workReportEntryId:'report-a'},
    targetMainSessionId:'main-a',selectedCandidateIds:['HC1','HC2'],
    claims:[
      {candidateId:'HC1',title:'Maintain compatibility',statement:quote,
        kind:'work-reported',verification:'reported-only',evidenceIds:['E1']},
      {candidateId:'HC2',title:'Test status not confirmed',statement:tests,
        kind:'work-reported',verification:'reported-only',evidenceIds:['E2']},
    ],
    context:[{id:'CX1',reason:'why',whyNeeded:'Compatibility constraint',quote:'Old clients require label.',
      requiredByClaimIds:['HC1'],evidenceId:'EC1'}],
    evidence:[
      {id:'E1',entryId:'report-a',sessionId:'work-a',role:'assistant',quote},
      {id:'E2',entryId:'report-a',sessionId:'work-a',role:'assistant',quote:tests},
      {id:'EC1',entryId:'user-old',sessionId:'work-a',role:'user',quote:'Old clients require label.'},
    ],
    contextAssessment:'selected',finalMessage:body,finalMessageHash:hashMessage(body),
  };
  const comparison:MainComparison={
    packageId:pkg.id,mainSessionId:pkg.targetMainSessionId,comparedLeafId:'main-leaf',
    inputEntryIds:['main-user'],items:[
      {claimId:'HC1',status:'new',explanation:'Not seen in current Main',
        mainEvidenceIds:[],unresolvedQuestions:[]},
      {claimId:'HC2',status:'conflict',explanation:'Status differs',
        mainEvidenceIds:['main-user'],unresolvedQuestions:[]},
    ],
  };
  return {pkg,comparison};
}
test('Main import includes only provisionally new selected Work claims and necessary context',()=>{
  const {pkg,comparison}=fixtures();
  const text=renderMainImport(pkg,comparison);
  assert.ok(text?.includes('HC1'));
  assert.ok(text?.includes('Old clients require label.'));
  assert.ok(text?.includes('reported-only'));
  assert.ok(!text?.includes('test execution status'));
  assert.ok(!text?.includes('HC2'));
  assert.ok(text?.includes('NOT policy approval'));
});
test('no import if all claims are conflicting or insufficient',()=>{
  const {pkg,comparison}=fixtures();
  for(const item of comparison.items)item.status='insufficient';
  assert.equal(renderMainImport(pkg,comparison),undefined);
});
test('reject a comparison from an incorrect recipient or package ID',()=>{
  const {pkg,comparison}=fixtures();
  comparison.mainSessionId='other-main';
  assert.throws(()=>renderMainImport(pkg,comparison),/mismatched-comparison-source/);
});
