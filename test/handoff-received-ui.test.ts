import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { TUI } from '@earendil-works/pi-tui';
import type { HandoffPackage } from '../src/handoff/package.ts';
import { showReferenceReceived } from '../extensions/handoff-received-ui.ts';

function fixture():HandoffPackage {
  return {
    source:{workSessionId:'work-1',forkSourceSessionId:'main-1',
      forkLeafId:'original',workReportEntryId:'report'},
    claims:[
      {candidateId:'HC1',title:'Work reported a fix',
        summary:'Fixed the reported issue.',statement:'Reported implementation.',
        kind:'work-reported',verification:'reported-only',evidenceIds:['E1']},
      {candidateId:'HC2',title:'Work noted a risk',
        summary:'Manual review required.',statement:'Reported risk.',
        kind:'proposal',verification:'reported-only',evidenceIds:['E2']},
      {candidateId:'HC3',title:'Additional finding',
        summary:'Additional optional note.',statement:'Further note.',
        kind:'proposal',verification:'reported-only',evidenceIds:['E2']},
    ],
    evidence:[{
      id:'E1',entryId:'report',role:'assistant',quote:'Exact original Work quote.',
      sessionId:'work-1',
    }],
    contextAssessment:'selected',
    approvedMainBrief:'THIS IS THE EXACT USER-APPROVED WORK BRIEF',
    finalMessage:'FULL DURABLE EVIDENCE RECORD',
  } as unknown as HandoffPackage;
}

function harness(conflict=false){
  let component:{
    render:(width:number)=>string[];
    handleInput:(key:string)=>void;
    dispose?:()=>void;
  }|undefined;
  let listener:((key:string)=>{consume?:boolean}|undefined)|undefined;
  let removed=0;
  let zoomCalls=0;
  let decide:(value:boolean)=>void=()=>{};
  const tui={
    terminal:{rows:28,columns:76},
    requestRender:()=>{},
  };
  const ctx={
    ui:{
      onTerminalInput:(cb:typeof listener)=>{
        listener=cb;
        return ()=>{removed++;listener=undefined};
      },
      custom:(factory:(
        tui:TUI,theme:{fg:(name:string,text:string)=>string;bold:(text:string)=>string},
        keys:unknown,done:(value:boolean)=>void,
      )=>typeof component)=>{
        const answer=new Promise<boolean>(resolve=>{decide=resolve});
        component=factory(tui as unknown as TUI,
          {fg:(_name,text)=>text,bold:text=>text},null,value=>{
            component?.dispose?.();
            decide(value);
          });
        return answer;
      },
    },
  } as unknown as ExtensionContext;
  return {
    run:()=>showReferenceReceived(ctx,fixture(),{
      packageId:'pkg-1',mainSessionId:'main-1',comparedLeafId:'main-leaf',
      inputEntryIds:[],
      items:conflict?[{
        claimId:'HC2',status:'conflict',explanation:'Existing Main policy rejects this idea.',
        mainEvidenceIds:['main-rule'],unresolvedQuestions:['Preserve the current policy?'],
      }]:[],
    },undefined,'MAIN IMPORT EXACT BRIEF',{
      mainEvidence:[{id:'main-rule',role:'Main 사용자 기록',
        text:'Keep the original JSON-only policy in effect.'}],
      onToggleZoom:async()=>{zoomCalls++;return 'Split 전환 완료';},
    }),
    text:()=>{assert.ok(component);return component!.render(76).join('\n')},
    key:(key:string)=>{const result=listener?.(key);if(!result?.consume)component?.handleInput(key)},
    removed:()=>removed,
    active:()=>Boolean(listener),
    zoomCalls:()=>zoomCalls,
    ignored:(key:string)=>listener?.(key),
  };
}

test('Main exception review starts collapsed like pi-intercom received messages',async()=>{
  const ui=harness();
  const result=ui.run();
  assert.match(ui.text(),/Work Handoff · 예외 검토/);
  assert.match(ui.text(),/Work reported a fix/);
  assert.doesNotMatch(ui.text(),/THIS IS THE EXACT USER-APPROVED WORK BRIEF/);
  ui.key('\x0f'); // Ctrl+O, pi-intercom's expand/collapse
  assert.match(ui.text(),/THIS IS THE EXACT USER-APPROVED WORK BRIEF/);
  ui.key('\t'); // Tab -> original evidence
  assert.match(ui.text(),/Exact original Work quote/);
  ui.key('\t'); // Tab -> precise Main import
  assert.match(ui.text(),/MAIN IMPORT EXACT BRIEF/);
  ui.key('\r'); // select action (not automatic Main import)
  assert.equal(await result,true);
  assert.equal(ui.removed(),1);
  assert.equal(ui.active(),false);
});

test('Main Esc returns from detail to summary and dismisses without modifying import',async()=>{
  const ui=harness();
  const result=ui.run();
  ui.key('\t'); // source
  ui.key('\x1b'); // back to summary
  assert.match(ui.text(),/Ctrl\+O/);
  ui.key('\x1b'); // cancel
  assert.equal(await result,false);
  assert.equal(ui.removed(),1);
});

test('Main exception review passes other terminal input through',async()=>{
  const ui=harness();
  const result=ui.run();
  assert.equal(ui.ignored('some random terminal text'),undefined);
  ui.key('\x1b');
  assert.equal(await result,false);
});


test('Main exception first compares Work report, current Main source and reason, not the entire Brief',async()=>{
  const ui=harness(true);
  const result=ui.run();
  assert.match(ui.text(),/검토할 차이 1건/);
  assert.match(ui.text(),/Existing Main policy rejects this idea/);
  assert.match(ui.text(),/Work 보고: Manual review required/);
  assert.match(ui.text(),/Keep the original JSON-only policy/);
  assert.doesNotMatch(ui.text(),/THIS IS THE EXACT USER-APPROVED WORK BRIEF/);
  ui.key('\x1b');
  assert.equal(await result,false);
});

test('Main exception Alt+Z requests focus without accepting held Work data',async()=>{
  const ui=harness(true);
  const result=ui.run();
  ui.key('\x1bz');
  assert.equal(ui.zoomCalls(),1);
  ui.key('\x1b');
  assert.equal(await result,false);
});
