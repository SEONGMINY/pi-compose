import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { applyOrcaOverlay } from '../scripts/orca-native-overlay.mjs';

test('native overlay is deterministic and refuses to overwrite upstream edits',()=>{
  const temp=mkdtempSync(join(tmpdir(),'orca-overlay-'));
  const root=join(temp,'pi-compose');
  const orca=join(temp,'orca');
  const snippets={
    'src/main/startup/main-process-ipc-bootstrap.ts':
      "import { ipcMain } from 'electron'\nexport function registerMainProcessIpcHandlers(): void {\n}\n",
    'src/preload/index.ts':
      "import { contextBridge, ipcRenderer } from 'electron'\nconst api = {\n  plugins: pluginsApi,\n}\n",
    'src/preload/api-types.ts':
      "import type { PluginsApi } from './api/plugin-host-api'\nexport type PreloadApi = {\n  plugins: PluginsApi\n}\n",
    'src/renderer/src/components/sidebar/sidebar-header-actions.tsx':
      "import React, { useCallback } from 'react'\nfunction Actions(){return <>\n      <NewWorkspaceButton preserveWorkspaceBoardOpen />\n</>}\n",
  };
  try {
    mkdirSync(join(orca,'.git'),{recursive:true});
    writeFileSync(join(orca,'LICENSE'),'MIT');
    for(const [p,data] of Object.entries(snippets)){
      const path=join(orca,p);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,data);
    }
    const overlayFiles=[
      'src/main/pi-compose-ipc.ts',
      'src/preload/api/pi-compose-bridge.ts',
      'src/renderer/src/components/pi-compose/PiComposeMenu.tsx',
    ];
    for(const name of overlayFiles){
      const path=join(root,'orca-overlay',name);
      mkdirSync(dirname(path),{recursive:true});
      writeFileSync(path,'// sample generated '+name+'\n');
    }
    applyOrcaOverlay(orca,root);
    const once=readFileSync(join(orca,'src/preload/index.ts'),'utf8');
    assert.match(once,/piCompose: piComposeApi/);
    assert.match(readFileSync(join(orca,'src/main/startup/main-process-ipc-bootstrap.ts'),'utf8'),/registerPiComposeIpc/);
    applyOrcaOverlay(orca,root);
    assert.equal(readFileSync(join(orca,'src/preload/index.ts'),'utf8'),once);
    const patched=join(orca,'src/preload/api/pi-compose-bridge.ts');
    writeFileSync(patched,'// local Orca modification\n');
    assert.throws(()=>applyOrcaOverlay(orca,root),/덮어쓸 수 없습니다/);
    assert.equal(readFileSync(patched,'utf8'),'// local Orca modification\n');
  }finally{rmSync(temp,{recursive:true,force:true});}
});
