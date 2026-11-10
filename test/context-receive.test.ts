import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { hasImportReceipt } from '../extensions/context-receive.ts';

function context(entries:unknown[]):ExtensionContext {
  return {sessionManager:{getBranch:()=>entries}} as unknown as ExtensionContext;
}

test('Main import is recorded only by an exact receipt on the active branch',()=>{
  const receipt={id:'main-import',type:'custom_message',customType:'compose_context_review_import',
    details:{packageId:'package-1',mainSessionId:'main-1'},
    content:'Work report',display:true};
  assert.equal(hasImportReceipt(context([]),'package-1'),false);
  assert.equal(hasImportReceipt(context([receipt]),'package-1'),true);
  assert.equal(hasImportReceipt(context([receipt]),'different-package'),false);
  assert.equal(hasImportReceipt(context([{
    ...receipt,customType:'compose_handoff_other',
  }]),'package-1'),false);
  assert.equal(hasImportReceipt(context([{
    ...receipt,details:{packageId:'package-1-elsewhere'},
  }]),'package-1'),false);
  // A sibling branch which does not contain this custom message must not
  // be marked imported merely because the global local-store status says so.
  assert.equal(hasImportReceipt(context([]),'package-1'),false);
});
