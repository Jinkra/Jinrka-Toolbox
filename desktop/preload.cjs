const { contextBridge, ipcRenderer } = require('electron');

const invoke = (command) => (...args) => ipcRenderer.invoke(`toolbox:${command}`, ...args);
contextBridge.exposeInMainWorld('desktop', {
  activationState: invoke('activation:state'),
  activate: invoke('activation:submit'),
  openCreator: invoke('creator:open'),
  checkUpdate: invoke('update:check'),
  updateError: invoke('update:error'),
  installUpdate: invoke('update:install'),
  onUpdateProgress: (callback) => {
    const handler = (_event, percent) => callback(percent);
    ipcRenderer.on('toolbox:update:progress', handler);
    return () => ipcRenderer.removeListener('toolbox:update:progress', handler);
  },
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
  windowCloseBehavior: invoke('window:close-behavior'),
  windowPin: invoke('window:pin'),
  windowHide: invoke('window:hide'),
});
