import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectChildSession, expectedDelivery } from '../src/session-observation.ts';

test('exact original parent and full task prompt are distinct observable facts',async t=>{
  const root=await mkdtemp(join(tmpdir(),'compose-delivery-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'child.jsonl'), source=join(root,'main.jsonl');
  const instruction='Add displayName; NEVER delete name because legacy clients rely on it';
  const user=expectedDelivery(instruction,'fork');
  await writeFile(file,JSON.stringify({type:'session',id:'child',cwd:root,parentSession:source})+'\n'
    +JSON.stringify({type:'message',message:{role:'user',content:'inherited message'}})+'\n');
  let observation=await inspectChildSession(file,user);
  assert.equal(observation.parentSession,source);
  assert.equal(observation.promptObserved,false);
  assert.equal(observation.assistantObserved,false);
  await appendFile(file,JSON.stringify({type:'message',message:{role:'user',content:[{type:'text',text:user}]}})+'\n');
  observation=await inspectChildSession(file,user);
  assert.equal(observation.promptObserved,true);
  assert.equal(observation.assistantObserved,false);
  await appendFile(file,JSON.stringify({type:'message',message:{role:'assistant',content:[{type:'text',text:'working'}]}})+'\n');
  observation=await inspectChildSession(file,user);
  assert.equal(observation.promptObserved,true);
  assert.equal(observation.assistantObserved,true);
  assert.equal(observation.sessionId,'child');
});
test('an inherited similar instruction must not count as exact new delivery',async t=>{
  const root=await mkdtemp(join(tmpdir(),'compose-delivery-negative-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'child.jsonl');
  await writeFile(file,JSON.stringify({type:'session',id:'child',cwd:root})+'\n'
    +JSON.stringify({type:'message',message:{role:'user',content:'Add displayName'}})+'\n');
  const obs=await inspectChildSession(file,expectedDelivery('Add displayName','fork'));
  assert.equal(obs.promptObserved,false);
});
