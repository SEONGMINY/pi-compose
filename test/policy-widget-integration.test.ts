import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { clearPolicyIndicator, renderPolicyIndicator } from '../extensions/policy-work.ts';

function fakeUi(){
  const statuses:Array<{key:string;value:string|undefined}>=[];
  const widgets:Array<{key:string;content:unknown;options?:{placement?:string}}>=[];

  const ctx={
    hasUI:true,
    ui:{
      setStatus(key:string,value:string|undefined){statuses.push({key,value});},
      setWidget(key:string,content:unknown,options?:{placement?:string}){
        widgets.push({key,content,options});
      },
    },
  } as unknown as ExtensionContext;
  return {ctx,statuses,widgets};
}

test('pending uses one editor-adjacent widget; original Pi footer slot is cleared',()=>{
  const {ctx,statuses,widgets}=fakeUi();
  renderPolicyIndicator(ctx,{status:'pending',pendingCount:1,subject:'로그인 정책'});
  assert.deepEqual(statuses,[{key:'pi-compose/policy-sync',value:undefined}]);
  const last=widgets.at(-1)!;
  assert.equal(last.key,'pi-compose/policy-sync');
  assert.deepEqual(last.options,{placement:'aboveEditor'});
  assert.equal(typeof last.content,'function');
  const make=last.content as (tui:unknown,theme:{fg:(tone:string,text:string)=>string})=>
    {render:(width:number)=>string[];invalidate:()=>void};
  const component=make(null,{fg:(_tone,text)=>text});
  for(const width of [24,36,48,80]){
    const lines=component.render(width);
    assert.equal(lines.length,1);
    assert.ok(visibleWidth(lines[0]!)<=width);
  }
  component.invalidate();
});

test('once Work has checked the policy, indicator is removed from editor',()=>{
  const {ctx,widgets}=fakeUi();
  renderPolicyIndicator(ctx,{status:'pending',pendingCount:1});
  renderPolicyIndicator(ctx,{status:'checked',pendingCount:0});
  assert.equal(widgets.at(-1)?.content,undefined);
  clearPolicyIndicator(ctx);
  assert.equal(widgets.at(-1)?.content,undefined);
});

test('unavailable and stop cases use the same editor widget, not a second footer',()=>{
  const {ctx,statuses,widgets}=fakeUi();
  renderPolicyIndicator(ctx,{status:'unavailable',pendingCount:0,unavailableReason:'read'});
  renderPolicyIndicator(ctx,{status:'pending',pendingCount:1,stop:true});
  assert.equal(widgets.filter(x=>x.content!==undefined).length,2);
  assert.ok(statuses.every(x=>x.value===undefined));
  assert.ok(widgets.every(x=>x.options?.placement==='aboveEditor'));
});
