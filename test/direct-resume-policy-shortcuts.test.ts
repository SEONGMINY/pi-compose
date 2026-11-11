import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkResumeShortcut } from '../extensions/direct-resume.ts';
import { searchProductWorkResumeSessions } from '../src/product-sessions.ts';
import { isWorkPolicyShortcut } from '../extensions/direct-work-policy-check.ts';

const candidates=[
  {id:'old-work-123',file:'/tmp/work1.jsonl',name:'로그인 정책 변경',
    recentTask:'패스키 정책 검증',cwd:'/tmp/demo-repo',modified:new Date('2026-11-11T11:00:00Z')},
  {id:'other-work-456',file:'/tmp/work2.jsonl',name:'검색 필터',
    recentTask:'쿼리 필터 테스트',cwd:'/tmp/demo-repo',modified:new Date('2026-11-11T10:00:00Z')},
];

test('>r and >r @Work parse only exact resume syntax, never a new Work prompt',()=>{
  assert.deepEqual(parseWorkResumeShortcut('>r'),{query:''});
  assert.deepEqual(parseWorkResumeShortcut('>r  '),{query:''});
  assert.deepEqual(parseWorkResumeShortcut('>r @'),{query:''});
  assert.deepEqual(parseWorkResumeShortcut('>r @old-work-123'),{query:'old-work-123'});
  assert.deepEqual(parseWorkResumeShortcut('>r @"로그인 정책 변경"'),{query:'로그인 정책 변경'});
  for(const input of ['>w 작업','>>w @Work 작업','>p','>r 구현을 시작하세요','>r @old-work-123 새 작업']){
    assert.equal(parseWorkResumeShortcut(input),undefined,input);
  }
});

test('resume selection matches role-restricted saved Work by ID, label, or task',()=>{
  assert.deepEqual(searchProductWorkResumeSessions(candidates,'Work'),candidates);
  assert.deepEqual(searchProductWorkResumeSessions(candidates,'old-work-123'),[candidates[0]]);
  assert.deepEqual(searchProductWorkResumeSessions(candidates,'패스키'),[candidates[0]]);
  assert.deepEqual(searchProductWorkResumeSessions(candidates,'필터'),[candidates[1]]);
  assert.deepEqual(searchProductWorkResumeSessions(candidates,'nonexistent'),[]);
});

test('?p is a Work-local policy review, not a directional delegation',()=>{
  assert.equal(isWorkPolicyShortcut('?p'),true);
  assert.equal(isWorkPolicyShortcut(' ?p '),true);
  assert.equal(isWorkPolicyShortcut('?p @work'),false);
  assert.equal(isWorkPolicyShortcut('?p 코드 수정'),false);
  assert.equal(isWorkPolicyShortcut('>p'),false);
  assert.equal(isWorkPolicyShortcut('>w 작업'),false);
  assert.equal(isWorkPolicyShortcut('<'),false);
});
