import test from 'node:test';
import assert from 'node:assert/strict';
import { selectForkHistory, type HistorySource } from '../src/handoff/retrieve.ts';

test('long Fork does not lose relevant early policy WHY after many Work messages',()=>{
  const important='Never remove legacyLabel because backward compatibility is mandatory.';
  const middle='ordinary context. '.repeat(100)+important+' ordinary context. '.repeat(100);
  const sources:HistorySource[]=[
    {id:'intro',role:'user',text:'Initial user requirements'},
    {id:'early-policy',role:'user',text:middle},
    ...Array.from({length:95},(_,i)=>({
      id:'work-'+i,role:'assistant' as const,text:'Unrelated build notes for component '+i,
    })),
    {id:'finish',role:'assistant',text:'The implementation is complete.'},
  ];
  const chosen=selectForkHistory(sources,'legacyLabel backward compatibility',20,700);
  assert.ok(chosen.some(v=>v.id==='early-policy'));
  const found=chosen.find(v=>v.id==='early-policy')!;
  assert.ok(found.text.includes(important));
  assert.ok(middle.includes(found.text),'excerpt must be contiguous exact evidence');
  assert.ok(chosen.length<=20);
  assert.deepEqual(chosen.map(v=>v.order),[...chosen.map(v=>v.order)].sort((a,b)=>a-b));
  assert.equal(chosen.at(-1)?.id,'finish');
});

test('focus-specific context survives a long history outside first/last windows',()=>{
  const sources:HistorySource[]=Array.from({length:120},(_,i)=>({
    id:'entry-'+i,role:'assistant',
    text:i===41
      ? 'Only payment gateway orange supports conditional partialCancel with idempotency.'
      :'Working through unrelated UI changes for modal '+i,
  }));
  const chosen=selectForkHistory(sources,'conditional partialCancel gateway orange',16,500);
  assert.ok(chosen.some(v=>v.id==='entry-41'));
  assert.ok(!chosen.some(v=>v.id==='entry-40'));
});

test('invalid budgets are rejected rather than silently dropping all evidence',()=>{
  assert.throws(()=>selectForkHistory([], 'query',0),/invalid-history-budget/);
});
