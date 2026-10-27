const { contextBridge, ipcRenderer } = require('electron');
const listen = (channel, callback) => {
  const fn = (_event, data) => callback(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};
contextBridge.exposeInMainWorld('compose', Object.freeze({
  state: () => ipcRenderer.invoke('compose:state'),
  chooseProject: () => ipcRenderer.invoke('compose:choose-project'),
  switchProject: path => ipcRenderer.invoke('compose:switch-project', path),
  context: id => ipcRenderer.invoke('compose:context', id),
  markContext: (id, entry, kind) => ipcRenderer.invoke('compose:mark-context', id, entry, kind),
  unmarkContext: (id, entry) => ipcRenderer.invoke('compose:unmark-context', id, entry),
  authStatus: () => ipcRenderer.invoke('compose:auth-status'),
  authLogin: method => ipcRenderer.invoke('compose:auth-login', method),
  authCancel: () => ipcRenderer.invoke('compose:auth-cancel'),
  authCode: code => ipcRenderer.invoke('compose:auth-code', code),
  onAuth: fn => listen('compose:auth-event', fn),
  createMain: title => ipcRenderer.invoke('compose:create-main', title),
  createWork: (mainId, task, workspace) =>
    ipcRenderer.invoke('compose:create-work', mainId, task, workspace),
  createSupport: (mainId, task, workspace) =>
    ipcRenderer.invoke('compose:create-support', mainId, task, workspace),
  start: id => ipcRenderer.invoke('compose:agent-start', id),
  attach: id => ipcRenderer.invoke('compose:agent-attach', id),
  stop: id => ipcRenderer.invoke('compose:agent-stop', id),
  review: id => ipcRenderer.invoke('compose:agent-review', id),
  write: (id, data) => ipcRenderer.send('compose:terminal-write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('compose:terminal-resize', id, cols, rows),
  onState: callback => listen('compose:state', callback),
  onTerminal: callback => listen('compose:terminal-event', callback),
}));
