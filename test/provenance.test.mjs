import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, realpathSync } from 'node:path';
import { installedProvenance, versionReport, activeExtensionReport } from '../src/provenance.mjs';

test('direct install without attestation must not manufacture a Git SHA',t=>{
  const root=mkdtempSync(join(tmpdir(),'compose-revision-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'package.json'),JSON.stringify({version:'0.0.1'}));
  let got=installedProvenance(root);
  assert.equal(got.revision,null);
  assert.equal(got.origin,'unverified');
  const commit='a'.repeat(40);
  writeFileSync(join(root,'.compose-install.json'),JSON.stringify({
    schema:1,packageRoot:realpathSync(root),commit,ref:'feat/revision'
  }));
  got=installedProvenance(root);
  assert.equal(got.revision,commit);
  assert.match(versionReport(activeExtensionReport(join(root,'package.json'),{root})),/실행 중인 Pi Compose Extension/);
});
