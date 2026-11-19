const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getCfg: () => ipcRenderer.invoke('cfg:get'),
  setCfg: (patch) => ipcRenderer.invoke('cfg:set', patch),
  register: (data) => ipcRenderer.invoke('register', data),
  personalSetup: (data) => ipcRenderer.invoke('personal:setup', data),
  personalSetPassword: (data) => ipcRenderer.invoke('personal:setPassword', data),
  netInfo: () => ipcRenderer.invoke('net:info'),
  tunnelStart: () => ipcRenderer.invoke('tunnel:start'),
  tunnelStop: () => ipcRenderer.invoke('tunnel:stop'),
  onTunnelClosed: (cb) => ipcRenderer.on('tunnel:closed', cb),
  reset: () => ipcRenderer.invoke('reset'),
  confirm: (user) => ipcRenderer.invoke('confirm', user),
  notify: (title, body) => ipcRenderer.send('notify', title, body),
  input: (ev) => ipcRenderer.send('input', ev),
});
