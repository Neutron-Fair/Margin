const { contextBridge, ipcRenderer } = require('electron');

// 前端是纯本地计算，只暴露必要的原生能力：
// 密钥安全存储、更新检查/下载/安装。
contextBridge.exposeInMainWorld('coilbook', {
  platform: process.platform,
  isDesktop: true,
  secrets: {
    access: (action, id, value) => ipcRenderer.invoke('secrets:access', action, id, value),
  },
  updater: {
    current: () => ipcRenderer.invoke('updater:current'),
    check: (opts) => ipcRenderer.invoke('updater:check', opts),
    download: (opts) => ipcRenderer.invoke('updater:download', opts),
    install: (filePath) => ipcRenderer.invoke('updater:install', filePath),
    onProgress: (cb) => {
      const handler = (_event, payload) => cb(payload);
      ipcRenderer.on('updater:progress', handler);
      return () => ipcRenderer.removeListener('updater:progress', handler);
    },
  },
});
