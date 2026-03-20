const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tickerApi', {
  onTodoPayload: (callback) => ipcRenderer.on('todo-payload', (_event, payload) => callback(payload)),
  onSettingsPayload: (callback) => ipcRenderer.on('settings-payload', (_event, payload) => callback(payload)),
  onContextLabels: (callback) => ipcRenderer.on('replace-context-labels', (_event, payload) => callback(payload)),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  chooseJson: () => ipcRenderer.invoke('request-json-select'),
  showContextMenu: () => ipcRenderer.send('show-context-menu')
});
