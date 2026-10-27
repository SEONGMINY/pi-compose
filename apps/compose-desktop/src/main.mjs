import { app, BrowserWindow, dialog, ipcMain, Notification } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComposeCore } from '@pi-compose/core';

const here = dirname(fileURLToPath(import.meta.url));
const core = new ComposeCore({ dataDir: join(app.getPath('userData'), 'compose') });
let window = null;
let quitting = false;
let previous = new Map();

const send = (channel, payload) => {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
};
const notify = (title, body, id) => {
  if (!Notification.isSupported()) return;
  const item = new Notification({ title, body, silent: true });
  item.on('click', () => {
    if (!window || window.isDestroyed()) createWindow();
    window.show();
    window.focus();
    if (id) send('compose:focus', id);
  });
  item.show();
};

core.on('change', (state) => {
  for (const item of state.sessions) {
    const before = previous.get(item.id);
    if (item.role === 'child' && before === 'running' && item.status === 'reviewable') {
      notify('검토 가능한 Child', item.title, item.id);
    }
  }
  previous = new Map(state.sessions.map((s) => [s.id, s.status]));
  send('compose:state', state);
});
core.on('notice', (item) => {
  send('compose:notice', item);
  if (item.type === 'agent-error') notify('Agent 실행 실패', item.message, item.id);
});

function createWindow() {
  window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 860,
    minHeight: 580,
    title: 'Pi Compose',
    backgroundColor: '#101317',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
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

app.whenReady().then(async () => {
  await core.restore();
  ipcMain.handle('compose:state', () => core.snapshot());
  ipcMain.handle('compose:choose-project', async () => {
    const options = { properties: ['openDirectory'], title: 'Git 프로젝트 선택' };
    const result = window && !window.isDestroyed()
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    return core.openProject(result.filePaths[0]);
  });
  ipcMain.handle('compose:create-main', (_event, title) => core.createMain(title));
  ipcMain.handle('compose:create-child', (_event, id, task) => core.createChild(id, task));
  ipcMain.handle('compose:send', (_event, id, prompt) => core.send(id, prompt));
  ipcMain.handle('compose:stop', (_event, id) => core.stop(id));
  ipcMain.handle('compose:review', (_event, id) => core.review(id));
  createWindow();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  // Cmd+Q halts active Pi sessions but preserves all session/worktree files.
  void core.shutdown().finally(() => app.quit());
});
