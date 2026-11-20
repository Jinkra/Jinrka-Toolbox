const { contextBridge, ipcRenderer } = require('electron');

const invoke = (command) => (...args) => ipcRenderer.invoke(`toolbox:${command}`, ...args);
contextBridge.exposeInMainWorld('desktop', {
  activationState: invoke('activation:state'),
  activate: invoke('activation:submit'),
  pickFiles: invoke('files'),
  zipCreate: invoke('zip:create'),
  zipExtract: invoke('zip:extract'),
  fileHash: invoke('hash'),
  fileInfo: invoke('files:info'),
  saveFile: invoke('save'),
  renamePlan: invoke('rename:plan'),
  renameApply: invoke('rename:apply'),
  video: invoke('video'),
  inspectMedia: invoke('video:inspect'),
  cancelVideo: invoke('video:cancel'),
  onVideoProgress: (callback) => {
    const handler = (_event, ratio) => callback(ratio);
    ipcRenderer.on('toolbox:video:progress', handler);
    return () => ipcRenderer.removeListener('toolbox:video:progress', handler);
  },
  clipboardRead: invoke('clipboard:read'),
  clipboardWrite: invoke('clipboard:write'),
  windowState: invoke('window:state'),
  windowPin: invoke('window:pin'),
  windowHide: invoke('window:hide'),
});
