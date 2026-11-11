import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { selectApprovalEvidence, recentMessages } from '../extensions/policy-main.ts';

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
