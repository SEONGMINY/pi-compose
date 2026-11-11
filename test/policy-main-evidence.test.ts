import test from 'node:test';
import assert from 'node:assert/strict';
import { selectApprovalEvidence } from '../extensions/policy-main.ts';

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
