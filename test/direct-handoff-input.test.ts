import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { registerDirectHandoff } from '../extensions/direct-handoff.ts';

test('bare < is handled immediately even while the Context Review dialog is still open',async()=>{
  const handlers=new Map<string,((event:any,ctx:ExtensionContext)=>any)[]>();
  const api={
    on(name:string,handler:(event:any,ctx:ExtensionContext)=>any){
      const values=handlers.get(name)??[];
      values.push(handler);
      handlers.set(name,values);
      return ()=>undefined;
    },
  } as unknown as ExtensionAPI;

  let completeReview:()=>void=()=>{};
  let started=0;
  const deferred=new Promise<void>(resolve=>{completeReview=resolve});
  registerDirectHandoff(api,async()=>{started++;await deferred;},async()=>new Set<string>());

  const entries=[{
    type:'custom',customType:'compose_agent_identity',
    data:{sessionId:'work-1',role:'work',product:'demo',
      label:'Work test',workspaceCwd:'/tmp/demo',
      forkSourceSessionId:'main-1',forkSourceLeafId:'fork-leaf'},
  }];
  const messages:string[]=[];
  const ctx={
    hasUI:true,mode:'tui',isIdle:()=>true,
    ui:{
      notify:(message:string)=>messages.push(message),
      setEditorText:()=>undefined,
      setWidget:()=>undefined,
      addAutocompleteProvider:()=>undefined,
    },
    sessionManager:{
      getEntries:()=>entries,getSessionId:()=> 'work-1',getLeafId:()=> 'report-leaf',
      getBranch:()=>[],
    },
  } as unknown as ExtensionContext;
  const callback=handlers.get('input')?.[0];
  assert.ok(callback);
  assert.deepEqual(callback({source:'interactive',text:'<',images:undefined},ctx),{action:'handled'});
  assert.equal(started,1);
  assert.deepEqual(callback({source:'interactive',text:'A normal message'},ctx),{action:'continue'});
  assert.ok(!messages.some(value=>value.includes('Nothing was sent')));
  completeReview();
  await deferred;
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.ok(messages.every(value=>!value.includes('오류')));
});
