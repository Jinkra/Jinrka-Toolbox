const { contextBridge, ipcRenderer } = require('electron');

const invoke = (command) => (...args) => ipcRenderer.invoke(`toolbox:${command}`, ...args);
contextBridge.exposeInMainWorld('desktop', {
  activationState: invoke('activation:state'),
  activate: invoke('activation:submit'),
  openCreator: invoke('creator:open'),
  aiSkills: invoke('ai:skills'),
  aiInspectSkills: invoke('ai:skills:inspect'),
  aiSkillDetails: invoke('ai:skills:details'),
  aiInstalledSkills: invoke('ai:skills:installed'),
  aiInstallSkill: invoke('ai:skills:install'),
  aiUninstallSkill: invoke('ai:skills:uninstall'),
  aiRepo: invoke('ai:repo'),
  aiToolDocs: invoke('ai:tool-docs'),
  aiInstall: invoke('ai:install'),
  systemInfo: invoke('system:info'),
  systemTrimMemory: invoke('system:trim-memory'),
  systemScanCleanup: invoke('system:scan-cleanup'),
  systemCleanScan: invoke('system:clean-scan'),
  systemStorageSettings: invoke('system:storage-settings'),
  scheduleList: invoke('schedule:list'),
  scheduleSave: invoke('schedule:save'),
  scheduleRemove: invoke('schedule:remove'),
  scheduleTest: invoke('schedule:test'),
  onScheduleChange: (callback) => { ipcRenderer.on('toolbox:schedule:changed', () => callback()); },
  onOpenSchedule: (callback) => { ipcRenderer.on('toolbox:schedule:open', () => callback()); },
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
  windowLoginStatus: invoke('window:login-status'),
  windowSetLogin: invoke('window:set-login'),
});
