import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { TUI } from '@earendil-works/pi-tui';
import { hashMessage, renderPackage, validateHandoffPackage, type HandoffPackage } from '../src/handoff/package.ts';
import { createContextReviewProgress, showContextReview } from '../extensions/context-review.ts';

function fixture():HandoffPackage {
  const payload={
    version:1 as const,id:'00000000-0000-4000-8000-000000000022',
    createdAt:'2026-11-10T09:00:00Z',product:'test-product',
    source:{workSessionId:'work',forkSourceSessionId:'main',
      forkLeafId:'parent',workReportEntryId:'report'},
    targetMainSessionId:'main',selectedCandidateIds:['HC1','HC2'],
    claims:[
      {candidateId:'HC1',title:'Fix report',summary:'Implementation reported.',
        statement:'Implemented fix.',kind:'work-reported' as const,
        verification:'reported-only' as const,evidenceIds:['E1']},
      {candidateId:'HC2',title:'Optional suggestion',summary:'Extra suggestion.',
        statement:'Suggest a cache.',kind:'proposal' as const,
        verification:'reported-only' as const,evidenceIds:['E2']},
    ],
    context:[{id:'CX1',reason:'why' as const,
      whyNeeded:'Preserve original policy.',quote:'Do not change original files.',
      requiredByClaimIds:['HC1'],evidenceId:'E3'}],
    evidence:[
      {id:'E1',sessionId:'work',entryId:'report',role:'assistant' as const,quote:'Implemented fix.'},
      {id:'E2',sessionId:'work',entryId:'report',role:'assistant' as const,quote:'Suggest a cache.'},
      {id:'E3',sessionId:'work',entryId:'original',role:'user' as const,quote:'Do not change original files.'},
    ],
    contextAssessment:'selected' as const,
  };
  const finalMessage=renderPackage(payload);
  return validateHandoffPackage({...payload,finalMessage,finalMessageHash:hashMessage(finalMessage)});
}

function reviewHarness(focusOnDialog:boolean, columns=110) {
  let component: {
    render:(width:number)=>string[];
    handleInput:(key:string)=>void;
    dispose?:()=>void;
  }|undefined;
  let listener: ((key:string)=>{consume?:boolean}|undefined)|undefined;
  let resolveAction:(result:unknown)=>void=()=>{};
  let removed=0;
  let rendered=0;
  const tui={
    terminal:{rows:36,columns},
    requestRender:()=>{rendered++},
  };
  const ui={
    onTerminalInput:(handler:typeof listener)=>{
      listener=handler;
      return ()=>{removed++;listener=undefined};
    },
    custom:(factory:(
      tui:TUI,
      theme:{fg:(color:string,text:string)=>string;bold:(text:string)=>string},
      keys:unknown,done:(result:unknown)=>void
    )=>typeof component)=>{
      const answer=new Promise<unknown>(resolve=>{resolveAction=resolve});
      component=factory(tui as unknown as TUI,{fg:(_color,text)=>text,bold:(text)=>text},null,(action)=>{
        component?.dispose?.();
        resolveAction(action);
      });
      return answer;
    },
  };
  const ctx={ui,hasUI:true,mode:'tui'} as unknown as ExtensionContext;
  return {
    ctx,
    run:()=>showContextReview(ctx,fixture(),{selected:[],focus:0,note:''}),
    key:(raw:string)=>{
      assert.ok(component);
      const handled=listener?.(raw);
      if(!handled?.consume&&focusOnDialog)component!.handleInput(raw);
    },
    raw:(raw:string)=>listener?.(raw),
    text:()=>{assert.ok(component);return component!.render(columns).join('\n')},
    events:()=>({removed,rendered,listener:!!listener}),
  };
}

test('Context Review keyboard arrows and Space work immediately without a hidden Tab mode',async()=>{
  const h=reviewHarness(true);
  const result=h.run();
  assert.match(h.text(),/선택 0 \/ 2/);
  h.key('\x1b[B'); // Down (Ghostty/Pi legacy sequence)
  assert.match(h.text(),/현재 후보 2 \/ 2/);
  h.key(' '); // Space
  assert.match(h.text(),/선택 1 \/ 2/);
  h.key('\r'); // Enter -> preview
  assert.match(h.text(),/전송 전 최종 확인/);
  h.key('\t'); // Tab -> exact payload
  assert.match(h.text(),/감사용 원문 기록/);
  assert.match(h.text(),/Suggest a cache/);
  h.key('\r'); // Explicit approval
  const action=await result;
  assert.deepEqual(action,{type:'send',selected:['HC2'],note:''});
  assert.equal(h.events().removed,1);
  assert.equal(h.events().listener,false);
});

test('Enter with no selection visibly explains the problem; Esc always cancels',async()=>{
  const h=reviewHarness(true,78);
  const result=h.run();
  h.key('\r');
  assert.match(h.text(),/Space로 최소 1개 선택/);
  h.key('\x1b'); // Esc
  assert.deepEqual(await result,{type:'cancel'});
  assert.equal(h.events().removed,1);
});

test('modal-scoped terminal input handles known keys even if native dialog focus is lost',async()=>{
  const h=reviewHarness(false);
  const result=h.run();
  assert.equal(h.raw('ordinary text'),undefined);
  assert.equal(h.raw('\x1b[B')?.consume,true); // recover Down
  assert.equal(h.raw(' ')?.consume,true); // recover Space
  assert.match(h.text(),/키보드 입력 연결됨/);
  assert.match(h.text(),/선택 1 \/ 2/);
  assert.equal(h.raw('\x1b')?.consume,true); // recover Esc
  assert.deepEqual(await result,{type:'cancel'});
  assert.equal(h.events().removed,1);
});

test('terminal listener consumes review shortcuts before native focus path, without double handling',async()=>{
  const h=reviewHarness(true);
  const result=h.run();
  h.key(' '); // single terminal event, input listener consumes before focused component
  assert.match(h.text(),/선택 1 \/ 2/);
  h.key(' '); // second physical press toggles it back, not two toggles per press
  assert.match(h.text(),/선택 0 \/ 2/);
  assert.equal(h.raw('ordinary text'),undefined); // unrelated input is not intercepted
  h.key('\x1b');
  assert.deepEqual(await result,{type:'cancel'});
});

test('progress widget is visible immediately, advances, then clears on exit',()=>{
  const changes:{key:string;content:string[]|undefined}[]=[];
  const progress=createContextReviewProgress((key,content)=>changes.push({key,content}));
  progress.update('1/3 수신 Main 확인 중');
  progress.update('2/3 공유 후보 구성 중');
  progress.update('3/3 WHY·근거 확인 중');
  assert.equal(changes.length,3);
  assert.ok(changes.every(change=>change.content?.[0]?.includes('아직 전송하지 않았습니다')));
  assert.match(changes[2]!.content![0]!,/3\/3/);
  progress.clear();
  progress.clear(); // cleanup is idempotent
  assert.equal(changes.length,4);
  assert.equal(changes[3]?.content,undefined);
});
test('narrow Ghostty split always exposes selection count and lets arrows select without Tab',async()=>{
  const h=reviewHarness(true,72);
  const result=h.run();
  assert.match(h.text(),/선택 0 \/ 2 · 현재 후보 1 \/ 2/);
  assert.match(h.text(),/Space 선택/);
  h.key(' ');
  assert.match(h.text(),/선택 1 \/ 2/);
  h.key('\x1b[B');
  assert.match(h.text(),/현재 후보 2 \/ 2/);
  h.key(' ');
  assert.match(h.text(),/선택 2 \/ 2/);
  h.key('\x1b');
  assert.deepEqual(await result,{type:'cancel'});
});


test('pi-ask-user-style search filters options without dropping selection or intercepting spaces',async()=>{
  const h=reviewHarness(true,82);
  const result=h.run();
  h.key('/');
  for(const key of 'Optional')h.key(key);
  assert.match(h.text(),/검색: Optional/);
  assert.match(h.text(),/Optional suggestion/);
  assert.doesNotMatch(h.text(),/› \[ \] Fix report/);
  h.key(' '); // Spaces belong to search while filtering, not selection toggles.
  assert.match(h.text(),/선택 0 \/ 2/);
  h.key('\x1b'); // clear query
  assert.match(h.text(),/검색: 입력 중/);
  h.key('\x1b'); // exit search
  h.key(' '); // default focus first claim
  assert.match(h.text(),/선택 1 \/ 2/);
  h.key('\x1b'); // cancel whole review
  assert.deepEqual(await result,{type:'cancel'});
});

test('reference selector keeps context collapsed until Ctrl+E and supports evidence drilldown',async()=>{
  const h=reviewHarness(true,80);
  const result=h.run();
  assert.match(h.text(),/관련 제약·WHY 1건/);
  assert.doesNotMatch(h.text(),/Do not change original files/);
  h.key('\x05'); // Ctrl+E
  assert.match(h.text(),/Do not change original files/);
  h.key('e'); // Evidence view
  assert.match(h.text(),/Pi Entry original/);
  h.key('\x1b'); // Back
  assert.match(h.text(),/Handoff Brief/);
  h.key('\x1b'); // Cancel
  assert.deepEqual(await result,{type:'cancel'});
});
