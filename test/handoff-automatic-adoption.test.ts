import test from 'node:test';
import assert from 'node:assert/strict';
import type { HandoffPackage } from '../src/handoff/package.ts';
import type { MainComparison } from '../src/handoff/compare.ts';
import { decideAutomaticAdoption } from '../src/handoff/automatic-adoption.ts';

function payload():HandoffPackage {
  return {
    id:'pkg-1',targetMainSessionId:'main-1',
    source:{workSessionId:'work-1',forkSourceSessionId:'main-1',
      forkLeafId:'fork-1',workReportEntryId:'work-report'},
    approvedMainBrief:'User-approved source-attributed Work report',
    approvedMainBriefHash:'a'.repeat(64),
    contextAssessment:'selected',
    claims:[{candidateId:'HC1'}],
  } as unknown as HandoffPackage;
}
function comparison(status:MainComparison['items'][number]['status']):MainComparison {
  return {packageId:'pkg-1',mainSessionId:'main-1',comparedLeafId:'main-current',
    inputEntryIds:[],items:[{claimId:'HC1',status,explanation:'Mock comparison',
      mainEvidenceIds:[],unresolvedQuestions:[]}]};
}
const active=new Set(['fork-1','main-current']);

test('one Work approval can import the exact brief only on an active, safe Main branch',()=>{
  assert.deepEqual(decideAutomaticAdoption(payload(),comparison('new'),'main-1',active),
    {action:'adopt',reason:'new-work-report'});
});

test('duplicates add no extra Main context',()=>{
  assert.deepEqual(decideAutomaticAdoption(payload(),comparison('duplicate'),'main-1',active),
    {action:'duplicate',reason:'already-covered'});
});

test('conflicts and insufficient checks always hold outside Main context',()=>{
  for(const status of ['conflict','insufficient'] as const)
    assert.deepEqual(decideAutomaticAdoption(payload(),comparison(status),'main-1',active),
      {action:'hold',reason:'conflict-or-uncertainty'});
  assert.equal(decideAutomaticAdoption(payload(),{
    ...comparison('new'),items:[],
  },'main-1',active).action,'hold');
});

test('reject unapproved Brief, unknown historical WHY or source Main mismatch',()=>{
  const noBrief={...payload(),approvedMainBrief:undefined};
  assert.equal(decideAutomaticAdoption(noBrief,comparison('new'),'main-1',active).action,'hold');
  const unresolved={...payload(),contextAssessment:'unavailable'} as HandoffPackage;
  assert.equal(decideAutomaticAdoption(unresolved,comparison('new'),'main-1',active).action,'hold');
  const wrongOrigin={...payload(),source:{...payload().source,forkSourceSessionId:'other-main'}};
  assert.equal(decideAutomaticAdoption(wrongOrigin,comparison('new'),'main-1',active).action,'hold');
});

test('Main switch away from the exact Fork branch prevents implicit adoption',()=>{
  assert.deepEqual(decideAutomaticAdoption(payload(),comparison('new'),'main-1',new Set(['other-leaf'])),
    {action:'hold',reason:'source-branch-not-active'});
});

test('apparently new claim with unresolved Main questions stays outside model context',()=>{
  const uncertain=comparison('new');
  uncertain.items[0]!.unresolvedQuestions=['Could supersede a later approved policy'];
  assert.deepEqual(decideAutomaticAdoption(payload(),uncertain,'main-1',active),
    {action:'hold',reason:'conflict-or-uncertainty'});
});
