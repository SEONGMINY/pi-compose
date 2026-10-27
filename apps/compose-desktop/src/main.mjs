import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { ModelRuntime, readStoredCredential } from '@earendil-works/pi-coding-agent';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRegistry } from '@pi-compose/core/agent-registry';
import { TerminalProcesses } from './terminal-processes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let window = null;
let registry;
let terminals;
let quitAuthorized = false;
let stopping = false;
let authRuntime;
let authLoginPending = false;
let codeResolve = null;

const send = (channel, payload) => {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send(channel, payload);
  }
};
const change = () => send('compose:state', terminals.snapshot());

function createWindow() {
  window = new BrowserWindow({
    width: 1460, height: 900, minWidth: 800, minHeight: 550,
    title: 'Pi Compose ADE', backgroundColor: '#0f1218',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  if (process.env.COMPOSE_DEV_URL) {
    void window.loadURL(process.env.COMPOSE_DEV_URL);
  } else {
    void window.loadFile(join(here, '../../../packages/compose-workbench/dist/index.html'));
  }
  window.on('closed', () => { window = null; });
}

app.whenReady().then(() => {
  registry = new AgentRegistry(join(app.getPath('userData'), 'compose'));
  terminals = new TerminalProcesses(registry, change, (event) => send('compose:terminal-event', event));
  ipcMain.handle('compose:state', () => terminals.snapshot());
  ipcMain.handle('compose:choose-project', async () => {
    const options = { properties: ['openDirectory'], title: 'Git 프로젝트 선택' };
    const picked = window && !window.isDestroyed()
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || !picked.filePaths[0]) return null;
    const state = registry.selectProject(picked.filePaths[0]);
    change();
    return state;
  });
  ipcMain.handle('compose:switch-project', (_event, path) => {
    const state = registry.switchProject(path);
    change();
    return state;
  });
  ipcMain.handle('compose:context', (_event, id) => registry.context(id));
  ipcMain.handle('compose:auth-status', () => ({
    connected: Boolean(readStoredCredential('openai-codex')),
    provider: 'openai-codex',
  }));
  ipcMain.handle('compose:auth-login', async () => {
    if (authLoginPending) throw new Error('이미 로그인이 진행 중입니다.');
    authLoginPending = true;
    try {
      authRuntime ??= await ModelRuntime.create({ refreshOnCreate: false });
      await authRuntime.login('openai-codex', 'oauth', {
        prompt: prompt => {
          if (prompt.type === 'select') return Promise.resolve('browser');
          // For callbacks blocked by local port ownership, request the redirect URL in our own UI.
          return new Promise((resolve, reject) => {
            codeResolve = { resolve, reject };
            send('compose:auth-event', { type: 'prompt', message: prompt.message });
            if (prompt.signal) {
              prompt.signal.addEventListener('abort', () => {
                if (codeResolve?.resolve === resolve) codeResolve = null;
                reject(new Error('인증 입력이 취소됐습니다.'));
              }, { once: true });
            }
          });
        },
        notify: event => {
          if (event.type === 'auth_url') void shell.openExternal(event.url);
          send('compose:auth-event', event);
        },
      }, { agentName: 'Pi Compose' });
      send('compose:auth-event', { type: 'success', message: 'OpenAI 로그인이 완료됐습니다.' });
      return { connected: true };
    } catch (error) {
      send('compose:auth-event', { type: 'error', message: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally { authLoginPending = false; codeResolve = null; }
  });
  ipcMain.handle('compose:auth-code', (_event, code) => {
    if (!codeResolve) throw new Error('인증 코드를 요청하지 않았습니다.');
    const pending = codeResolve;
    codeResolve = null;
    pending.resolve(code);
  });
  ipcMain.handle('compose:create-main', (_event, title) => {
    const result = registry.createMain(title);
    change();
    return result.id;
  });
  ipcMain.handle('compose:create-work', (_event, mainId, task, workspace) => {
    const result = registry.createWork(mainId, task, workspace);
    change();
    return result.id;
  });
  ipcMain.handle('compose:create-support', (_event, mainId, task, workspace) => {
    const result = registry.createSupport(mainId, task, workspace);
    change();
    return result.id;
  });
  ipcMain.handle('compose:agent-start', (_event, id) => terminals.start(id));
  ipcMain.handle('compose:agent-attach', (_event, id) => terminals.attach(id));
  ipcMain.handle('compose:agent-stop', (_event, id) => { terminals.stop(id); change(); });
  ipcMain.handle('compose:agent-review', (_event, id) => registry.review(id));
  ipcMain.on('compose:terminal-write', (_event, id, data) => terminals.write(id, data));
  ipcMain.on('compose:terminal-resize', (_event, id, cols, rows) =>
    terminals.resize(id, cols, rows));
  createWindow();
});
app.on('activate', () => {
  if (registry && BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', (event) => {
  if (quitAuthorized || !terminals) return;
  event.preventDefault();
  if (stopping) return;
  stopping = true;
  terminals.stopAll();
  setTimeout(() => {
    if (terminals.runningCount() > 0) {
      const response = dialog.showMessageBoxSync({
        type: 'warning', title: 'Agent 종료 확인',
        message: '종료되지 않은 Pi 프로세스가 남아 있습니다.',
        detail: '세션 파일과 Git 작업 폴더는 보존됩니다. 앱을 종료할까요?',
        buttons: ['취소', '앱 종료'], defaultId: 0, cancelId: 0,
      });
      if (response === 0) { stopping = false; return; }
    }
    quitAuthorized = true;
    app.quit();
  }, 1200);
});
