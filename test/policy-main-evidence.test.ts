import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { selectApprovalEvidence, recentMessages, resolveApprovedSource,
  explicitApprovalFallback } from '../extensions/policy-main.ts';
import { couldBeApproval, decisionId, branchDecisions,
  selfContainedApprovedPolicyQuote } from '../src/policy/decisions.ts';
import { makePolicySnapshot } from '../src/policy/store.ts';

test('B-option lookup retrieves the actual proposal outside the recent context window',()=>{
  const earlier=[
    {id:'old-proposal',role:'assistant',text:
      'A안: 현재 인증 흐름 유지. '.repeat(130)+
      'B안: 로그인에서는 패스키를 기본으로 하고 비밀번호 방식을 제거합니다.'},
    ...Array.from({length:35},(_,i)=>({id:'unrelated-'+i,role:'assistant',
      text:'Unrelated discussion about search results and layout '+i})),
  ];
  const selected=selectApprovalEvidence(
    {id:'user-approval',role:'user',text:'B안으로 확정합니다.'},earlier);
  assert.ok(selected.some(x=>x.id==='old-proposal'));
  assert.match(selected.find(x=>x.id==='old-proposal')!.text,
    /B안: 로그인에서는 패스키를 기본/);
  assert.ok(selected.length<=20);
});

test('non-reference approval uses a small recent context rather than replaying everything',()=>{
  const earlier=Array.from({length:65},(_,i)=>({
    id:'entry-'+i,role:i%2?'assistant':'user',
    text:'Discussion '+i,
  }));
  const selection=selectApprovalEvidence(
    {id:'user-approval',role:'user',text:'이 방향으로 진행하겠습니다.'},earlier);
  assert.ok(selection.length<=16);
  assert.equal(selection[selection.length-1]?.id,'entry-64');
});

test('approval extraction considers only Pi-visible unedited Main messages',()=>{
  const original={type:'message',id:'proposal-old',
    message:{role:'assistant',content:'B안: 이전 로그인 방식을 사용합니다.'}};
  const edited={type:'message',id:'proposal-edited',
    message:{role:'assistant',content:'B안: 현재 정책을 유지합니다.'}};
  const approval={type:'message',id:'approved',
    message:{role:'user',content:'B안으로 확정합니다.'}};
  const ctx={sessionManager:{buildSessionProjection:()=>({entries:[
    {sourceEntry:edited,messages:[{role:'assistant',content:'변경된 제안으로 대체'}]},
    {sourceEntry:original,messages:[{role:'assistant',content:original.message.content}]},
    {sourceEntry:approval,messages:[{role:'user',content:approval.message.content}]},
  ]})}} as unknown as ExtensionContext;
  const available=recentMessages(ctx);
  assert.deepEqual(available.map(m=>m.id),['proposal-old','approved']);
  assert.ok(!available.some(m=>m.id==='proposal-edited'));
});

test('a compacted proposal absent from the projection cannot be treated as approval source',()=>{
  const ctx={sessionManager:{buildSessionProjection:()=>({entries:[
    {sourceEntry:{type:'compaction',id:'summary'},
      messages:[{role:'custom',content:'Some older B option existed'}]},
    {sourceEntry:{type:'message',id:'approved',
      message:{role:'user',content:'B안으로 확정합니다.'}},
      messages:[{role:'user',content:'B안으로 확정합니다.'}]},
  ]})}} as unknown as ExtensionContext;
  assert.deepEqual(recentMessages(ctx).map(m=>m.id),['approved']);
});

test('policy extraction skips BashExecutionMessage variants without content',()=>{
  const ctx={sessionManager:{buildSessionProjection:()=>({entries:[
    {
      sourceEntry:{type:'message',id:'bash-entry',
        message:{role:'bashExecution',command:'echo hi',output:'hi'}},
      messages:[{role:'bashExecution',command:'echo hi',output:'hi'}],
    },
    {
      sourceEntry:{type:'message',id:'approved',
        message:{role:'user',content:'B안으로 확정합니다.'}},
      messages:[
        {role:'bashExecution',command:'echo hi',output:'hi'},
        {role:'user',content:'B안으로 확정합니다.'},
      ],
    },
  ]})}} as unknown as ExtensionContext;
  assert.deepEqual(recentMessages(ctx),[
    {id:'approved',role:'user',text:'B안으로 확정합니다.'},
  ]);
});


test('regression: explicit B approval is a policy even if model points at the approving USER',()=>{
  const exact='B안으로 확정합니다. 로그인 정책은 비밀번호 로그인을 제거하고 패스키로만 로그인하는 것으로 결정합니다. 이 정책은 현재 개발 중인 Work에도 즉시 적용합니다.';
  const approval={id:'approve-b',role:'user',text:exact};
  const quote=selfContainedApprovedPolicyQuote(exact);
  assert.equal(quote,'로그인 정책은 비밀번호 로그인을 제거하고 패스키로만 로그인하는 것으로 결정합니다.');
  const selected=resolveApprovedSource(approval,[],approval.id,exact);
  assert.equal(selected?.source.id,approval.id);
  assert.equal(selected?.quote,quote);
  const parsed=explicitApprovalFallback(approval,[]);
  assert.equal(parsed?.status,'approved');
  assert.equal(parsed?.sourceQuote,quote);
  assert.equal(parsed?.subject,'로그인 정책');
  const decision={
    id:decisionId('main-1',approval.id,approval.id,quote!),
    mainSessionId:'main-1',approvalEntryId:approval.id,sourceEntryId:approval.id,
    approvalQuote:exact,sourceQuote:quote!,subject:'로그인 정책',
    decision:quote!,reason:'',scope:'owner-main',targetWorkIds:[],effective:'now',
  };
  const branch=[{id:approval.id,type:'message',message:{role:'user',content:exact}},
    {id:'policy-entry',type:'custom',customType:'compose_policy_decision',data:decision}];
  assert.equal(makePolicySnapshot('main-1','test','policy-entry',branch).decisions.length,1);
  assert.deepEqual(branchDecisions(branch,'main-1').map(d=>d.id),[decision.id]);
});

test('bare B approval must still use concrete earlier assistant evidence',()=>{
  const approval={id:'approve-b',role:'user',text:'B안으로 확정합니다.'};
  assert.equal(selfContainedApprovedPolicyQuote(approval.text),undefined);
  assert.equal(explicitApprovalFallback(approval,[]),undefined);
  assert.equal(resolveApprovedSource(approval,[],approval.id,approval.text),undefined);
  const proposal={id:'proposal-b',role:'assistant',
    text:'B안: 패스키만 허용하고 비밀번호 로그인은 제거합니다.'};
  assert.deepEqual(resolveApprovedSource(approval,[proposal],proposal.id,proposal.text),
    {source:proposal,quote:proposal.text});
});

test('implementation versus documentation is not a second policy approval',()=>{
  for(const choice of ['문서화 진행','문서화로 진행하겠습니다','문서화로 진행해주세요',
    '문서만','구현으로 진행합니다']){
    assert.equal(couldBeApproval(choice),false,choice);
    assert.equal(selfContainedApprovedPolicyQuote(choice),undefined,choice);
  }
  assert.equal(couldBeApproval('B안으로 확정합니다.'),true);
});

test('user text without a concrete rule cannot bypass the old B-option source requirement',()=>{
  const onlyPointer={id:'user',role:'user',text:'B안으로 확정합니다. Work에 즉시 전파해주세요.'};
  assert.equal(explicitApprovalFallback(onlyPointer,[]),undefined);
  assert.equal(resolveApprovedSource(onlyPointer,[],'user',onlyPointer.text),undefined);
});

test('a self-contained user revision takes precedence over an older B-option proposal',()=>{
  const old={id:'assistant-b',role:'assistant',
    text:'B안: 비밀번호 로그인도 계속 허용합니다.'};
  const user={id:'new-user-decision',role:'user',
    text:'B안으로 확정합니다. 로그인 정책은 비밀번호 로그인을 제거하고 패스키 로그인만 허용합니다.'};
  const evidence=resolveApprovedSource(user,[old],old.id,old.text);
  assert.equal(evidence?.source.id,user.id);
  assert.match(evidence?.quote??'',/비밀번호 로그인을 제거/);
  assert.ok(!(evidence?.quote??'').includes('계속 허용'));
});
