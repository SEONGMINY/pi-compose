import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { hashMessage, type HandoffPackage } from '../src/handoff/package.ts';
import { type MainComparison } from '../src/handoff/compare.ts';
import { previewHandoff } from '../extensions/handoff-inbox.ts';

test('incoming Handoff preview constructs exact import body before opening TUI',async()=>{
  const quote='Do not remove the label field.';
  const summary='Work reported a label compatibility constraint.';
  const finalMessage='Work review: '+summary+'\nOriginal: '+quote;
  const pkg:HandoffPackage={
    version:1,id:'00000000-0000-4000-8000-000000000005',
    createdAt:'2026-11-10T00:00:00Z',product:'demo',
    source:{workSessionId:'work',forkSourceSessionId:'main',forkLeafId:'f',workReportEntryId:'r'},
    targetMainSessionId:'main',selectedCandidateIds:['HC1'],
    claims:[{candidateId:'HC1',title:'Preserve label',summary,statement:quote,
      kind:'work-reported',verification:'reported-only',evidenceIds:['E1']}],
    context:[],evidence:[{id:'E1',sessionId:'work',entryId:'r',role:'assistant',quote}],
    contextAssessment:'none-needed',finalMessage,
    finalMessageHash:hashMessage(finalMessage),
  };
  const comparison:MainComparison={packageId:pkg.id,mainSessionId:'main',comparedLeafId:'leaf',
    inputEntryIds:[],items:[{claimId:'HC1',status:'new',
      explanation:'Not found in the bounded Main context',
      mainEvidenceIds:[],unresolvedQuestions:[]}]};
  let asked=false;
  const ctx={hasUI:true,mode:'tui',
    ui:{custom:async()=>{asked=true;return 'later';}},
  } as unknown as ExtensionContext;
  assert.equal(await previewHandoff(ctx,pkg,'incoming',comparison),'later');
  assert.equal(asked,true);
});
