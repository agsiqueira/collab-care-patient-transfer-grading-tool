const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('graderAPI', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  clearApiKey: () => ipcRenderer.invoke('settings:clearApiKey'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickOutputFolder: () => ipcRenderer.invoke('dialog:pickOutputFolder'),
  loadFolder: folderPath => ipcRenderer.invoke('transcripts:loadFolder', folderPath),
  gradeOne: payload => ipcRenderer.invoke('grading:gradeOne', payload),
  exportResults: payload => ipcRenderer.invoke('export:save', payload),
  openFolder: folderPath => ipcRenderer.invoke('folder:open', folderPath)
});
