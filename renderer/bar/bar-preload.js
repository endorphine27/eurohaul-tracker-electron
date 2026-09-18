const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eurohaulBar', {
  onTelemetryUpdate: (callback) => {
    ipcRenderer.on('telemetry:update', (_event, snapshot) => callback(snapshot));
  },
  onOrientation: (callback) => {
    ipcRenderer.on('bar:orientation', (_event, orientation) => callback(orientation));
  },
  onStyle: (callback) => {
    ipcRenderer.on('bar:style', (_event, style) => callback(style));
  },
  getTelemetrySnapshot: () => ipcRenderer.invoke('telemetry:getSnapshot'),
  openSettings: () => ipcRenderer.send('bar:open-settings'),
});
