import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { policyNotice, policyNoticeLine, type PolicyIndicatorState } from '../src/policy/status-widget.ts';

const state=(status:PolicyIndicatorState['status'],
  rest:Partial<PolicyIndicatorState>={}):PolicyIndicatorState=>
  ({status,pendingCount:0,...rest});

test('normal checked state has no widget; no permanent duplicate footer message',()=>{
  assert.equal(policyNotice(state('checked')),undefined);
});

test('one new policy shows the subject only when space permits',()=>{
  const notice=policyNotice(state('pending',{pendingCount:1,subject:'로그인 정책'}));
  assert.ok(notice);
  assert.equal(notice.tone,'warning');
  assert.match(policyNoticeLine(notice,100),/로그인 정책/);
  assert.match(policyNoticeLine(notice,100),/다음 응답에 전달/);
  assert.match(policyNoticeLine(notice,37),/Main 정책 1건/);
  assert.ok(!policyNoticeLine(notice,37).includes('로그인 정책'));
});

test('a few policy changes should not imply only one decision',()=>{
  const notice=policyNotice(state('pending',{pendingCount:3,subject:'로그인 정책'}));
  assert.ok(notice);
  assert.match(policyNoticeLine(notice,100),/3건/);
  assert.ok(!policyNoticeLine(notice,100).includes('로그인 정책'));
});

test('delivered is not falsely described as applied or tested',()=>{
  const notice=policyNotice(state('delivered'));
  assert.ok(notice);
  assert.match(policyNoticeLine(notice,100),/전달 기록됨/);
  assert.ok(!policyNoticeLine(notice,100).includes('반영 완료'));
});

test('unavailable, unresolved approvals, and stop are persistent and distinct',()=>{
  const unavailable=policyNotice(state('unavailable'));
  const unresolved=policyNotice(state('unavailable',{unreviewedApprovalCount:2}));
  const wrongOwner=policyNotice(state('unavailable',{unavailableReason:'owner'}));
  const readError=policyNotice(state('unavailable',{unavailableReason:'read'}));
  const stop=policyNotice(state('checked',{stop:true}));
  assert.match(unavailable!.detailed,/최신성 확인 불가/);
  assert.match(unresolved!.detailed,/승인 후보 2건/);
  assert.match(unresolved!.detailed,/Main에서 >p/);
  assert.match(unresolved!.compact,/Main >p/);
  assert.match(wrongOwner!.detailed,/소유 Main 불명확/);
  assert.match(readError!.detailed,/조회 실패/);
  assert.equal(stop!.tone,'error');
  assert.match(stop!.detailed,/수정 실행 제한/);
});

test('every rendered notice is exactly one terminal row even in narrow Ghostty Split',()=>{
  const cases=[
    state('pending',{pendingCount:1,subject:'로그인 정책'}),
    state('pending',{pendingCount:23,subject:'매우 긴'.repeat(150)}),
    state('delivered'),
    state('unavailable',{unreviewedApprovalCount:12}),
    state('checked',{stop:true}),
  ];
  for(const c of cases){
    const notice=policyNotice(c);
    assert.ok(notice);
    for(const width of [1,2,6,12,20,30,38,48,80]){
      const line=policyNoticeLine(notice,width);
      assert.equal(line.split('\n').length,1);
      assert.ok(visibleWidth(line)<=width,
        'status '+c.status+' width '+width+' got '+visibleWidth(line));
    }
  }
});

test('subjects cannot inject a new line or terminal control code into the widget',()=>{
  const notice=policyNotice(state('pending',{
    pendingCount:1,subject:'로그인\u001b[31m\n\t정책\x00    내용',
  }));
  assert.ok(notice);
  const line=policyNoticeLine(notice,150);
  assert.equal(line.split('\n').length,1);
  assert.ok(!line.includes('\u001b'));
  assert.ok(!line.includes('\x00'));
});
