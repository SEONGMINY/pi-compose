import test from 'node:test';
import assert from 'node:assert/strict';
import type { HandoffPackage } from '../src/handoff/package.ts';
import { decideDirectReferenceImport } from '../src/handoff/direct-adoption.ts';

const pkg=()=>({
  targetMainSessionId:'main-1',approvedMainBrief:'Work-originated unverified report',
  approvedMainBriefHash:'a'.repeat(64),contextAssessment:'unavailable',
  source:{workSessionId:'work-1',forkSourceSessionId:'main-1',forkLeafId:'fork-1'},
} as unknown as HandoffPackage);

test('user-approved limited Work report imports with no Main semantic judgment',()=>{
  assert.deepEqual(decideDirectReferenceImport(pkg(),'main-1',true),
    {action:'import',reason:'work-approved-reference'});
});

test('transport contract still guards wrong target, missing approval and wrong branch',()=>{
  assert.equal(decideDirectReferenceImport(pkg(),'main-2',true).action,'hold');
  assert.equal(decideDirectReferenceImport({...pkg(),approvedMainBrief:undefined},
    'main-1',true).action,'hold');
  assert.equal(decideDirectReferenceImport(pkg(),'main-1',false).action,'hold');
});

test('unverified policy freshness is reported, not reclassified or silently discarded',()=>{
  const report={...pkg(),policySync:{status:'unavailable' as const,
    pendingDecisionIds:[],withdrawnDecisionIds:[]}};
  assert.equal(decideDirectReferenceImport(report,'main-1',true).action,'import');
});
