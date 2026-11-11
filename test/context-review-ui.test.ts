import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { TUI, OverlayHandle } from '@earendil-works/pi-tui';
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
  let hidden=false;
  let overlay=false;
  let zoomCalls=0;
  const tui={
    terminal:{rows:36,columns},
    requestRender:()=>{},
  };
  const ui={
    notify:()=>undefined,
    onTerminalInput:(handler:typeof listener)=>{
      listener=handler;
      return ()=>{removed++;listener=undefined};
    },
    custom:(factory:(
      tui:TUI,
      theme:{fg:(color:string,text:string)=>string;bold:(text:string)=>string},
      keys:unknown,done:(result:unknown)=>void
    )=>typeof component,
    options?:{overlay?:boolean;onHandle?:(handle:OverlayHandle)=>void})=>{
      const answer=new Promise<unknown>(resolve=>{resolveAction=resolve});
      component=factory(tui as unknown as TUI,{fg:(_color,text)=>text,bold:(text)=>text},null,(action)=>{
        component?.dispose?.();
        resolveAction(action);
      });
      overlay=Boolean(options?.overlay);
      options?.onHandle?.({
        isHidden:()=>hidden,
        setHidden:(value:boolean)=>{hidden=value;},
      } as unknown as OverlayHandle);
      return answer;
    },
  };
  const ctx={ui,hasUI:true,mode:'tui'} as unknown as ExtensionContext;
  return {
    ctx,
    run:()=>showContextReview(ctx,fixture(),{selected:[],focus:0,note:''},{
      onToggleZoom:async()=>{zoomCalls++;return 'Split 전환 완료';},
    }),
    key:(raw:string)=>{
      assert.ok(component);
      const handled=listener?.(raw);
      if(!handled?.consume&&focusOnDialog)component!.handleInput(raw);
    },
    raw:(raw:string)=>listener?.(raw),
    text:()=>{assert.ok(component);return component!.render(columns).join('\n')},
    events:()=>({removed,listener:!!listener,overlay,hidden,zoomCalls}),
  };
}


/**
 * Keep only interaction contracts, not exact wording or terminal wrapping.
 * The same selection action must work in narrow and wide Ghostty surfaces.
 */
test('arrow navigation, selection and explicit approval send the chosen claim',async()=>{
  for(const width of [72,130]){
    const ui=reviewHarness(true,width);
    const result=ui.run();
    ui.key('\x1b[B'); // move to the second claim
    ui.key(' ');      // select
    ui.key('\r');     // review exact Main payload
    ui.key('\t');     // inspect archived evidence
    ui.key('\r');     // explicitly approve the selection
    assert.deepEqual(await result,{type:'send',selected:['HC2'],note:''});
    assert.equal(ui.events().removed,1);
    assert.equal(ui.events().listener,false);
  }
});

test('Enter with no selection does not send; Esc cancels cleanly',async()=>{
  const ui=reviewHarness(true,78);
  let finished=false;
  const result=ui.run().then(action=>{finished=true;return action});
  ui.key('\r'); // cannot approve an empty selection
  await Promise.resolve();
  assert.equal(finished,false);
  ui.key('\x1b');
  assert.deepEqual(await result,{type:'cancel'});
  assert.equal(ui.events().removed,1);
});

test('terminal listener works without dialog focus and ignores unrelated input',async()=>{
  const ui=reviewHarness(false);
  const result=ui.run();
  assert.equal(ui.raw('ordinary unhandled input'),undefined);
  assert.equal(ui.raw('\x1b[B')?.consume,true);
  assert.equal(ui.raw(' ')?.consume,true);
  assert.equal(ui.raw('\x1b')?.consume,true);
  assert.deepEqual(await result,{type:'cancel'});
  assert.equal(ui.events().listener,false);
  assert.equal(ui.events().removed,1);
});

test('search and evidence navigation preserve the actual selected claim',async()=>{
  const ui=reviewHarness(true,82);
  const result=ui.run();
  ui.key(' '); // choose HC1
  ui.key('/');
  for(const key of 'Optional')ui.key(key);
  ui.key('\x1b'); // clear the search query
  ui.key('\x1b'); // close search
  ui.key('\x05'); // expand WHY
  ui.key('e');    // open source evidence
  ui.key('\x1b'); // back to the choices
  ui.key('\r');   // preview
  ui.key('\r');   // send
  assert.deepEqual(await result,{type:'send',selected:['HC1'],note:''});
});

test('hide/reopen and Split zoom do not alter the approved selection',async()=>{
  const ui=reviewHarness(true,120);
  const result=ui.run();
  assert.equal(ui.events().overlay,true);
  ui.key(' ');    // choose HC1
  ui.key('\x1bo'); // temporarily hide the review overlay
  assert.equal(ui.events().hidden,true);
  ui.key('\x1bo'); // reopen it
  assert.equal(ui.events().hidden,false);
  ui.key('\x1bz'); // explicit Ghostty zoom request (mock only)
  assert.equal(ui.events().zoomCalls,1);
  ui.key('\r');
  ui.key('\r');
  assert.deepEqual(await result,{type:'send',selected:['HC1'],note:''});
  assert.equal(ui.events().removed,1);
});

test('review progress clears after completion and remains idempotent',()=>{
  const changes:{key:string;content:string[]|undefined}[]=[];
  const progress=createContextReviewProgress((key,content)=>changes.push({key,content}));
  progress.update('1/3 Main 확인');
  progress.update('2/3 후보 구성');
  progress.update('3/3 WHY 확인');
  progress.clear();
  progress.clear();
  assert.equal(changes.length,4);
  assert.ok(changes.slice(0,3).every(item=>item.content?.length));
  assert.equal(changes[3]?.content,undefined);
});
