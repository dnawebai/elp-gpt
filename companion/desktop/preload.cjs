const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('elpCompanion', {
  status: () => ipcRenderer.invoke('companion:status'),
  enroll: (token, label) => ipcRenderer.invoke('companion:enroll', { token, label }),
  signOut: () => ipcRenderer.invoke('companion:signout'),
  open: (url) => ipcRenderer.invoke('companion:open', url),
});
