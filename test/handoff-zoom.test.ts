import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandoffZoomController } from '../extensions/handoff-zoom.ts';

const workId='12345678-aaaa-bbbb-cccc-123456789abc';

test('Handoff never toggles Ghostty zoom implicitly on entry',async()=>{
  const events:string[]=[];
  const zoom=createHandoffZoomController(workId,async id=>{
    events.push(id);return 'toggled';
  });
  assert.deepEqual(events,[]);
  await zoom.close();
  assert.deepEqual(events,[]);
});

test('explicit focus toggle is paired with exact-terminal restoration on close',async()=>{
  const events:string[]=[];
  const zoom=createHandoffZoomController(workId,async id=>{
    events.push(id);return 'toggled';
  });
  assert.match(await zoom.toggle(),/전환 완료/);
  assert.equal(events.length,1);
  assert.equal(await zoom.close(),undefined);
  assert.deepEqual(events,[workId,workId]);
  await zoom.close(); // idempotent
  assert.equal(events.length,2);
  assert.match(await zoom.toggle(),/종료하는 중/);
  assert.equal(events.length,2);
});

test('no background zoom is attempted without an exact session-bound Terminal ID',async()=>{
  let actions=0;
  const zoom=createHandoffZoomController(undefined,async()=>{
    actions++;return 'toggled';
  });
  assert.match(await zoom.toggle(),/사용 불가/);
  assert.equal(await zoom.close(),undefined);
  assert.equal(actions,0);
});

test('failed focus check never pretends zoom happened and never auto-restores',async()=>{
  let count=0;
  const zoom=createHandoffZoomController(workId,async()=>{
    count++;return 'not-focused';
  });
  assert.match(await zoom.toggle(),/포커스/);
  assert.equal(await zoom.close(),undefined);
  assert.equal(count,1);
});

test('lost focus on exit never toggles another split, and warns the user',async()=>{
  let count=0;
  const zoom=createHandoffZoomController(workId,async()=>{
    count++;return count===1?'toggled':'not-focused';
  });
  await zoom.toggle();
  assert.match(await zoom.close()??'',/복원 필요/);
  assert.equal(count,2);
});

test('concurrent Alt+Z is de-duplicated and closing waits for in-flight toggle',async()=>{
  let resume:()=>void=()=>undefined;
  let calls=0;
  const barrier=new Promise<void>(resolve=>{resume=resolve});
  const zoom=createHandoffZoomController(workId,async()=>{
    calls++;
    if(calls===1)await barrier;
    return 'toggled';
  });
  const first=zoom.toggle();
  const second=zoom.toggle();
  const closing=zoom.close();
  resume();
  assert.equal(await first,await second);
  assert.equal(await closing,undefined);
  assert.equal(calls,2);
});
