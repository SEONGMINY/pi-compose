const { contextBridge, ipcRenderer } = require('electron');
const listen = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('compose', Object.freeze({
  state: () => ipcRenderer.invoke('compose:state'),
  chooseProject: () => ipcRenderer.invoke('compose:choose-project'),
  createMain: (title) => ipcRenderer.invoke('compose:create-main', title),
  createChild: (id, task) => ipcRenderer.invoke('compose:create-child', id, task),
  send: (id, message) => ipcRenderer.invoke('compose:send', id, message),
  stop: (id) => ipcRenderer.invoke('compose:stop', id),
  review: (id) => ipcRenderer.invoke('compose:review', id),
  onState: (callback) => listen('compose:state', callback),
  onNotice: (callback) => listen('compose:notice', callback),
  onFocus: (callback) => listen('compose:focus', callback),
}));
