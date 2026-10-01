// Pont sécurisé entre l'interface et le processus principal
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('odonavig', {
  platform: process.platform,
  getStore: () => ipcRenderer.invoke('store:get'),
  setStore: (key, value) => ipcRenderer.send('store:set', key, value),
  ready: () => ipcRenderer.invoke('ui:ready'),
  toggleFullscreen: () => ipcRenderer.send('window:toggle-fullscreen'),
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  filesToUrls: (files) => ipcRenderer.invoke('file:to-url', files.map((f) => webUtils.getPathForFile(f))),
  pathsToUrls: (paths) => ipcRenderer.invoke('file:to-url', paths),
  openPath: (p) => ipcRenderer.send('shell:open-path', p),
  appInfo: () => ipcRenderer.invoke('app:info'),
  chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),
  clearData: (what) => ipcRenderer.invoke('data:clear', what),
  setDefaultBrowser: () => ipcRenderer.invoke('browser:set-default'),
  showItemInFolder: (p) => ipcRenderer.send('shell:show-item', p),
  on: (channel, callback) => {
    const allowed = ['shortcut', 'open-urls', 'fullscreen-changed', 'download-done'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
});
