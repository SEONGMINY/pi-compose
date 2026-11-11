import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { prepareManualHandoffCandidates } from '../extensions/handoff-candidates.ts';
import { createSelectedHandoffPackage, verifyWorkSource } from '../src/handoff/package.ts';
import { selectContextPackage } from '../src/handoff/context-review.ts';
import { hasImportedIdenticalWorkBrief } from '../extensions/context-receive.ts';

const policy='Customers without replies must not be marked resolved.';
const report='Implemented inquiry status checks. Tests were not run.';
let fixtureCounter=0;
function fixture(mode:'valid'|'invalid-context'|'missing-context'|'legacy-transient'|'empty-context'='valid'){
  const workId='work-unified-'+(++fixtureCounter);
  const owner={
    role:'work' as const,sessionId:workId,product:'demo',
    forkSourceSessionId:'main-unified-1',forkSourceLeafId:'main-leaf',
  };
  let calls=0;
  const branch=[
    {id:'policy',type:'message',message:{role:'user',
      content:[{type:'text',text:policy}]}},
    {id:'report',type:'message',message:{role:'assistant',stopReason:'stop',
      content:[{type:'text',text:report}]}},
  ];
  const ctx={
    model:{id:'model-unified'},
    sessionManager:{
      getBranch:()=>branch,
      getSessionId:()=>workId,
      getLeafId:()=> 'report',
    },
    modelRegistry:{
      streamSimple:(_model:unknown,request:{messages:{content:string}[]})=>{
        calls++;
        const input=JSON.parse(request.messages[0]!.content);
        const response=calls===1?{
          outcome:'reported-complete',
          candidates:[{title:'Inquiry state check',description:'Reported status implementation.',
            kind:'finding',sourceEntryId:'report',
            quote:'Implemented inquiry status checks.'}],
          ...(mode==='missing-context'?{}:{context:mode==='empty-context'?[]:[{
            sourceEntryId:'policy',
            quote:(mode==='invalid-context'||mode==='legacy-transient')?'Fabricated policy.':policy,
            reason:'condition',
            whyNeeded:'No response is not a resolved state',
            relatedCandidateIds:['HC1'],
          }]}),
        }:{
          context:[{
            sourceEntryId:'policy',quote:policy,reason:'condition',
            whyNeeded:'No response is not a resolved state',
            relatedCandidateIds:['HC1'],
          }],
        };
        // A second call is permitted ONLY for the incomplete-context
        // recovery path. Valid unified output must stay at one model call.
        if(calls===1){
          assert.equal(input.reportEntryId,'report');
          assert.ok(input.currentSources.some((s:{id:string})=>s.id==='report'));
          assert.ok(input.historySources.some((s:{id:string})=>s.id==='policy'));
        }
        return {result:async()=>({
          stopReason:'stop',
          content:[{type:'text',text:mode==='legacy-transient'&&calls===2
            ?'not-json'
            :JSON.stringify(response)}],
        })};
      },
    },
  } as unknown as ExtensionContext;
  return {ctx,owner,branch,calls:()=>calls};
}

test('one Work model pass supplies candidates AND source-linked WHY to the Main package',async()=>{
  const env=fixture();
  const prepared=await prepareManualHandoffCandidates(env.ctx);
  assert.equal(prepared.status,'prepared');
  if(prepared.status!=='prepared')return;
  assert.equal(prepared.draft.contextAssessment,'selected');
  assert.equal(prepared.draft.linkedContext?.[0]?.sourceEntryId,'policy');
  const pkg=await createSelectedHandoffPackage(env.ctx,env.owner,prepared.draft,{
    ids:['HC1'],reviewEntryId:'report',
  },'main-unified-1');
  assert.equal(env.calls(),1,'WHY preparation must not trigger a second model call');
  assert.equal(pkg.context.length>=1,true);
  assert.equal(pkg.context[0]?.quote,policy);
  assert.deepEqual(pkg.context[0]?.requiredByClaimIds,['HC1']);
  assert.equal(pkg.evidence.find(e=>e.id===pkg.context[0]?.evidenceId)?.entryId,'policy');
  assert.equal(pkg.contextAssessment,'selected');
  verifyWorkSource(env.ctx,pkg);
  const approved=selectContextPackage(pkg,['HC1'],'review');
  assert.ok(approved.approvedMainBrief?.includes(policy));
});

test('repeat < on same leaf reuses verified result and never repeats the provider call',async()=>{
  const env=fixture();
  const first=await prepareManualHandoffCandidates(env.ctx);
  const second=await prepareManualHandoffCandidates(env.ctx);
  assert.equal(first.status,'prepared');
  assert.equal(second.status,'prepared');
  assert.equal(env.calls(),1);
  if(first.status==='prepared'&&second.status==='prepared')
    assert.deepEqual(first.draft,second.draft);
});

test('unverifiable linked WHY is not attached and can be recovered with the old lookup on the same <',async()=>{
  const env=fixture('invalid-context');
  const prepared=await prepareManualHandoffCandidates(env.ctx);
  assert.equal(prepared.status,'prepared');
  if(prepared.status!=='prepared')return;
  assert.equal(prepared.draft.linkedContext,undefined);
  assert.equal(env.calls(),1);
  const pkg=await createSelectedHandoffPackage(env.ctx,env.owner,prepared.draft,{
    ids:['HC1'],reviewEntryId:'report',
  },'main-unified-1');
  assert.equal(env.calls(),2,'Legacy WHY model fallback is exception-only');
  assert.equal(pkg.context[0]?.quote,policy);
});

test('missing context array invokes guarded legacy lookup, not false none-needed',async()=>{
  const env=fixture('missing-context');
  const prepared=await prepareManualHandoffCandidates(env.ctx);
  assert.equal(prepared.status,'prepared');
  if(prepared.status!=='prepared')return;
  assert.equal(prepared.draft.contextAssessment,undefined);
  const pkg=await createSelectedHandoffPackage(env.ctx,env.owner,prepared.draft,{
    ids:['HC1'],reviewEntryId:'report',
  },'main-unified-1');
  assert.equal(env.calls(),2);
  assert.equal(pkg.contextAssessment,'selected');
});

test('only byte-identical Work imports can bypass Main semantic comparison',()=>{
  const brief='An already approved exact Work Brief';
  const pkg={
    approvedMainBrief:brief,approvedMainBriefHash:'f'.repeat(64),
    source:{workSessionId:'work-123'},
  } as any;
  const record={
    id:'entry-1',type:'custom_message',
    customType:'compose_context_review_import',content:brief,
    details:{sourceWorkSessionId:'work-123',approvedMainBriefHash:'f'.repeat(64)},
  };
  const ctx={
    sessionManager:{getBranch:()=>[record]},
  } as unknown as ExtensionContext;
  assert.equal(hasImportedIdenticalWorkBrief(ctx,pkg),true);
  assert.equal(hasImportedIdenticalWorkBrief(ctx,{...pkg,approvedMainBrief:brief+' edited'}),false);
  assert.equal(hasImportedIdenticalWorkBrief(ctx,{...pkg,source:{workSessionId:'work-other'}}),false);
  assert.equal(hasImportedIdenticalWorkBrief({
    sessionManager:{getBranch:()=>[]},
  } as unknown as ExtensionContext,pkg),false);
});


test('first < retries a transient WHY lookup without requiring a second user action',async()=>{
  const env=fixture('legacy-transient');
  const prepared=await prepareManualHandoffCandidates(env.ctx);
  assert.equal(prepared.status,'prepared');
  if(prepared.status!=='prepared')return;
  assert.equal(prepared.draft.linkedContext,undefined);
  const pkg=await createSelectedHandoffPackage(env.ctx,env.owner,prepared.draft,{
    ids:['HC1'],reviewEntryId:'report',
  },'main-unified-1');
  // 1 unified call + 1 invalid legacy reply + 1 source-verified retry
  assert.equal(env.calls(),3);
  assert.equal(pkg.contextAssessment,'selected');
  assert.equal(pkg.context[0]?.quote,policy);
});


test('empty unified WHY cannot silently discard an explicit historical user restriction',async()=>{
  const env=fixture('empty-context');
  const prepared=await prepareManualHandoffCandidates(env.ctx);
  assert.equal(prepared.status,'prepared');
  if(prepared.status!=='prepared')return;
  assert.equal(prepared.draft.contextAssessment,undefined);
  const pkg=await createSelectedHandoffPackage(env.ctx,env.owner,prepared.draft,{
    ids:['HC1'],reviewEntryId:'report',
  },'main-unified-1');
  assert.equal(env.calls(),2,'the explicit prior policy needs a guarded source check');
  assert.equal(pkg.contextAssessment,'selected');
  assert.equal(pkg.context[0]?.quote,policy);
});
