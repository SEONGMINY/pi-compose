import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { hashMessage, type HandoffPackage } from '../src/handoff/package.ts';
import { compareHandoffWithMain } from '../src/handoff/compare.ts';
import { assessHandoffQuality } from '../src/handoff/quality.ts';

function pkg():HandoffPackage {
  const quote='Do not remove the label field.';
  const body='Work claim: Preserve old clients. '+quote;
  return {version:1,id:'00000000-0000-4000-8000-000000000002',
    createdAt:'2026-11-10T00:00:00Z',product:'demo',
    source:{workSessionId:'work-1',forkSourceSessionId:'main-1',
      forkLeafId:'fork-1',workReportEntryId:'report-1'},
    targetMainSessionId:'main-1',selectedCandidateIds:['HC1'],
    claims:[{candidateId:'HC1',title:'Preserve label',
      summary:'Preserve old clients.',statement:quote,kind:'work-reported',verification:'reported-only',
      evidenceIds:['E1']}],
    context:[],evidence:[{id:'E1',sessionId:'work-1',entryId:'report-1',
      role:'assistant',quote}],contextAssessment:'none-needed',
    finalMessage:body,finalMessageHash:hashMessage(body)};
}

function context(kind:'main'|'work',answer:unknown) {
  let leaf='leaf-1';
  let providerCalls=0;
  const activeSession=kind==='main'?'main-1':'work-1';
  const ctx={
    isIdle:()=>true,model:{id:'test-model'},
    sessionManager:{
      getSessionId:()=>activeSession,getLeafId:()=>leaf,
      getBranch:()=>[{id:'work-history',type:'message',message:{
        role:'user',content:[{type:'text',text:'Keep label for compatibility.'}],
      }}],
      buildSessionProjection:()=>({entries:[{
        sourceEntry:{type:'message',id:'main-user-1'},
        messages:[{role:'user',content:[{type:'text',
          text:'The label field must not be removed. Preserve compatibility.'}]}],
      }]}),
    },
    modelRegistry:{streamSimple:()=>{providerCalls++;
      return {result:async()=>({stopReason:'stop',
        content:[{type:'text',text:JSON.stringify(answer)}]})};}},
  } as unknown as ExtensionContext;
  return {ctx,setLeaf:(id:string)=>{leaf=id;},calls:()=>providerCalls};
}

test('Main compares Work against current active Pi projection without sending user messages',async()=>{
  const x=context('main',{items:[{claimId:'HC1',status:'duplicate',
    explanation:'Current Main already prohibits removing label.',
    mainEvidenceIds:['main-user-1'],unresolvedQuestions:[]}]});
  const result=await compareHandoffWithMain(x.ctx,pkg());
  assert.equal(result.comparedLeafId,'leaf-1');
  assert.equal(result.items[0]?.status,'duplicate');
  assert.deepEqual(result.items[0]?.mainEvidenceIds,['main-user-1']);
  assert.equal(x.calls(),1);
});

test('Main comparison rejects invented Main source IDs',async()=>{
  const x=context('main',{items:[{claimId:'HC1',status:'conflict',
    explanation:'Different Main policy.',mainEvidenceIds:['made-up-entry'],
    unresolvedQuestions:[]}]});
  const result=await compareHandoffWithMain(x.ctx,pkg());
  assert.equal(result.items[0]?.status,'insufficient');
});

test('Main cannot apply comparison after active branch switch',async()=>{
  const x=context('main',{items:[]});
  const original=x.ctx.modelRegistry.streamSimple;
  (x.ctx.modelRegistry as any).streamSimple=(...args:unknown[])=>{
    const pending=(original as any)(...args);
    return {result:async()=>{const result=await pending.result();
      x.setLeaf('new-leaf');return result;}};
  };
  await assert.rejects(compareHandoffWithMain(x.ctx,pkg()),/main-branch-changed/);
});

test('independent semantic quality inspection identifies false test approval',async()=>{
  const x=context('work',{verdict:'needs-revision',issues:[{
    kind:'test-status',candidateId:'HC1',
    explanation:'The source does not prove the tests passed.',
  }]});
  const result=await assessHandoffQuality(x.ctx,pkg());
  assert.equal(result.verdict,'needs-revision');
  assert.equal(result.issues[0]?.kind,'test-status');
});

test('quality inspection rejects inconsistent accept verdict with issues',async()=>{
  const x=context('work',{verdict:'acceptable',issues:[{
    kind:'negation',candidateId:'HC1',explanation:'Removed the not keyword',
  }]});
  await assert.rejects(assessHandoffQuality(x.ctx,pkg()),/quality-inconsistent-verdict/);
});
