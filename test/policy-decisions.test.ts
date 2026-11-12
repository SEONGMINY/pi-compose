import test from 'node:test';
import assert from 'node:assert/strict';
import { DECISION_ENTRY, POLICY_MESSAGE, branchDecisions,
  couldBeApproval, decisionId, policyDelta, renderPolicyDelta,
  workKnownDecisionIds, containsSensitivePolicyText } from '../src/policy/decisions.ts';
import { makePolicySnapshot } from '../src/policy/store.ts';

const user=(id:string,text:string)=>({id,type:'message',message:{role:'user',content:text}});
const assistant=(id:string,text:string)=>({id,type:'message',message:{role:'assistant',content:text}});
function fixture(){
  const policy='B안: 기존 인증 방식은 제거하고 패스키를 우선합니다.';
  const decision={
    id:decisionId('main-1','u1','a1',policy),
    mainSessionId:'main-1',approvalEntryId:'u1',sourceEntryId:'a1',
    approvalQuote:'B안으로 확정합니다',sourceQuote:policy,
    subject:'로그인 정책',decision:policy,reason:'사용자 경험 개선',
    scope:'owner-main' as const,targetWorkIds:[],effective:'now' as const,
  };
  const branch=[assistant('a1',policy),user('u1','B안으로 확정합니다'),
    {id:'policy-entry',type:'custom',customType:DECISION_ENTRY,data:decision}];
  return {decision,branch};
}

test('lexical gate is only a cheap hint, not an approval verdict',()=>{
  assert.equal(couldBeApproval('B안으로 확정합니다'),true);
  assert.equal(couldBeApproval('B안은 어떤가요?'),false);
  assert.equal(couldBeApproval('기존 API 동작을 설명해 주세요.'),false);
});

test('approved policy must be traceable to a user and a verbatim source',()=>{
  const {decision,branch}=fixture();
  assert.deepEqual(branchDecisions(branch,'main-1'),[decision]);
  assert.deepEqual(branchDecisions(branch,'other-main'),[]);
  assert.deepEqual(branchDecisions(branch.slice(0,2),'main-1'),[]);
  const forged=branch.map(e=>e.id==='policy-entry'
    ? {...e,data:{...decision,sourceQuote:'invented policy'}}:e);
  assert.deepEqual(branchDecisions(forged,'main-1'),[]);
  const noApproval=[branch[0],{id:'u1',type:'message',
    message:{role:'assistant',content:'B안으로 확정합니다'}},branch[2]];
  assert.deepEqual(branchDecisions(noApproval,'main-1'),[]);
});

test('only current Main branch policies belong to snapshot; a rewind withdraws them',()=>{
  const {decision,branch}=fixture();
  const current=makePolicySnapshot('main-1','sample','leaf-policy',branch);
  assert.equal(current.decisions[0]?.id,decision.id);
  const rewound=makePolicySnapshot('main-1','sample','a1',branch.slice(0,1));
  assert.deepEqual(rewound.decisions,[]);
  assert.notEqual(current.revision,rewound.revision);
  assert.deepEqual(policyDelta(current.decisions,[],'work-1').added.map(d=>d.id),[decision.id]);
  assert.deepEqual(policyDelta(rewound.decisions,[decision.id],'work-1').withdrawn,[decision.id]);
});

test('durable Work delivery is a checkpoint; observing does not mean implementation success',()=>{
  const {decision,branch}=fixture();
  const inherited=branch as any[];
  assert.deepEqual(workKnownDecisionIds(inherited,'main-1'),[decision.id]);
  const receipt={id:'receipt',type:'custom_message',customType:POLICY_MESSAGE,
    details:{mainSessionId:'main-1',activeDecisionIds:[]}};
  assert.deepEqual(workKnownDecisionIds([...inherited,receipt],'main-1'),[]);
  const summary=renderPolicyDelta('main-1',[decision],[]);
  assert.ok(summary.includes('사용자 승인: B안으로 확정합니다'));
  assert.ok(summary.includes('수신은 적용 완료나 테스트 성공을 의미하지 않습니다.'));
});

test('work-specific decisions are not delivered to unrelated Work sessions',()=>{
  const {decision}=fixture();
  const special={...decision,scope:'specific-work' as const,targetWorkIds:['work-2']};
  assert.equal(policyDelta([special],[],'work-1').added.length,0);
  assert.equal(policyDelta([special],[],'work-2').added.length,1);
});

test('explicit supersession on the same active branch retires the older policy',()=>{
  const {decision,branch}=fixture();
  const newSource='로그인 정책: 패스키만 사용하고 다른 로그인은 제거';
  const replacement={...decision,id:decisionId('main-1','u2','a2',newSource),
    approvalEntryId:'u2',sourceEntryId:'a2',approvalQuote:'이 정책으로 확정',
    sourceQuote:newSource,decision:newSource,supersedesId:decision.id};
  const next=[...branch,assistant('a2',newSource),user('u2','이 정책으로 확정'),
    {id:'policy-entry-2',type:'custom',customType:DECISION_ENTRY,data:replacement}];
  assert.deepEqual(branchDecisions(next,'main-1').map(d=>d.id),[replacement.id]);
});

test('policy content and secrets are grounded, never transported as invented policy',()=>{
  const {decision,branch}=fixture();
  assert.equal(containsSensitivePolicyText('api_key: abc123'),true);
  assert.equal(containsSensitivePolicyText('password = topsecret'),true);
  assert.equal(containsSensitivePolicyText('Passwordless login'),false);
  const forged=branch.map(entry=>entry.id==='policy-entry'
    ? {...entry,data:{...decision,decision:'Unapproved contradictory decision'}}:entry);
  assert.deepEqual(branchDecisions(forged,'main-1'),[]);
});

test('unrelated Main chat does not make a new policy revision',()=>{
  const {branch}=fixture();
  const before=makePolicySnapshot('main-1','sample','leaf-policy',branch);
  const after=makePolicySnapshot('main-1','sample','later-chat',
    [...branch,user('u2','How does the system work?'),
      assistant('a2','We can discuss it before deciding.')]);
  assert.equal(before.revision,after.revision);
  assert.notEqual(before.activeLeafId,after.activeLeafId);
});

test('a new decision superseding an earlier decision changes Work in both directions',()=>{
  const {decision,branch}=fixture();
  const source='비밀번호 로그인을 제거하고 패스키 인증을 사용합니다.';
  const replaced={...decision,id:decisionId('main-1','u2','a2',source),
    approvalEntryId:'u2',sourceEntryId:'a2',approvalQuote:'이 방식으로 확정합니다.',
    sourceQuote:source,decision:source,supersedesId:decision.id};
  const newer=branchDecisions([...branch,assistant('a2',source),
    user('u2','이 방식으로 확정합니다.'),
    {id:'new-policy',type:'custom',customType:DECISION_ENTRY,data:replaced}], 'main-1');
  const changes=policyDelta(newer,[decision.id],'work-1');
  assert.deepEqual(changes.withdrawn,[decision.id]);
  assert.deepEqual(changes.added.map(d=>d.id),[replaced.id]);
});

test('ContextEdit revokes evidence authority; compaction alone does not revoke approved decisions',()=>{
  const {decision,branch}=fixture();
  assert.deepEqual(branchDecisions([...branch,{
    type:'compaction',id:'compact',summary:'Policy is still active',
  }],'main-1').map(d=>d.id),[decision.id]);
  assert.deepEqual(branchDecisions([...branch,{
    type:'context_edit',id:'edit-approval',targetId:'u1',replacement:null,
  }],'main-1'),[]);
  assert.deepEqual(branchDecisions([...branch,{
    type:'context_edit',id:'edit-source',targetId:'a1',replacement:'Rewritten',
  }],'main-1'),[]);
  assert.deepEqual(branchDecisions([...branch,{
    type:'context_edit',id:'edit-source',targetId:'a1',
    replacement:'B안: 기존 인증 방식은 제거하고 패스키를 우선합니다.',
  }],'main-1').map(d=>d.id),[decision.id]);
  assert.deepEqual(branchDecisions([...branch,{
    type:'context_edit',id:'edit-source-1',targetId:'a1',replacement:null,
  },{
    type:'context_edit',id:'edit-source-2',targetId:'a1',
    replacement:'B안: 기존 인증 방식은 제거하고 패스키를 우선합니다.',
  }],'main-1').map(d=>d.id),[decision.id]);
});

test('unreviewed approval candidates affect freshness even before decision publication',()=>{
  const {branch}=fixture();
  const checked=makePolicySnapshot('main-1','sample','leaf-policy',branch);
  const pending=makePolicySnapshot('main-1','sample','leaf-policy',branch,['u-pending']);
  assert.notEqual(pending.revision,checked.revision);
  assert.deepEqual(pending.unreviewedApprovalEntryIds,['u-pending']);
});
