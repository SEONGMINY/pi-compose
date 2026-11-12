import test from 'node:test';import assert from 'node:assert/strict';
import {choosePlan,shouldUsePlanner} from '../src/planner.mjs';
test('Small fix never triggers extra AI planning cost',async()=>{
 const r=await choosePlan('Fix a bug',process.cwd(),{mode:'bounded-pi',generate:async()=>{throw Error('Should not call')}});
 assert.equal(r.modelAttempted,false);assert.equal(r.steps.length,1);
});
test('Complex request can be split by bounded read-only model result',async()=>{
 const prompt='여러 모듈의 아키텍처를 조사하고 구현 및 검증을 수행해주세요. 기존 API 계약과 사용자의 요구사항을 이해하고 안전하게 마이그레이션해야 합니다.';
 assert.equal(shouldUsePlanner(prompt),true);
 const r=await choosePlan(prompt,process.cwd(),{mode:'bounded-pi',generate:async()=>JSON.stringify({steps:[
   {id:'research',goal:'Inspect contracts',ac:['Contracts documented'],dependencies:[]},
   {id:'implement',goal:'Minimal migration',ac:['Regression tests pass'],dependencies:['research']}
 ]})});
 assert.equal(r.provenance,'bounded-model-proposal');assert.equal(r.steps.length,2);
});
test('Invalid model plan fails closed to a single safe step',async()=>{
 const prompt='여러 모듈을 수정하고 전체 아키텍처의 통합 설계 및 테스트를 수행하고 기능을 만들어 주세요. 작업 범위가 넓으므로 확인이 필요합니다.';
 const r=await choosePlan(prompt,process.cwd(),{mode:'bounded-pi',generate:async()=>'{"steps":[{"id":"bad","goal":"x","ac":[],"dependencies":[]}]}'});
 assert.equal(r.provenance,'deterministic-fallback');assert.equal(r.steps.length,1);
});
