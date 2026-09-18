const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eurohaul', {
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  getTelemetrySnapshot: () => ipcRenderer.invoke('telemetry:getSnapshot'),
  onTelemetryUpdate: (callback) => {
    ipcRenderer.on('telemetry:update', (_event, snapshot) => callback(snapshot));
  },
  onNavigate: (callback) => {
    ipcRenderer.on('navigate', (_event, page) => callback(page));
  },
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  setSetting: (key, value) => ipcRenderer.send('settings:set', key, value),

  getAuthStatus: () => ipcRenderer.invoke('auth:getStatus'),
  login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
  logout: () => ipcRenderer.send('auth:logout'),
  onLoggedOut: (callback) => {
    ipcRenderer.on('auth:loggedOut', () => callback());
  },

  getProfileSnapshot: () => ipcRenderer.invoke('profile:getSnapshot'),
  onProfileUpdate: (callback) => {
    ipcRenderer.on('profile:update', (_event, snapshot) => callback(snapshot));
  },
  refreshProfile: () => ipcRenderer.send('profile:refresh'),
  contractAction: (contractId, actionName) => ipcRenderer.invoke('contract:action', contractId, actionName),

  onPlayOverspeedSound: (callback) => {
    ipcRenderer.on('sound:play-overspeed', () => callback());
  },
  getOverspeedSoundPath: () => ipcRenderer.invoke('sound:getOverspeedPath'),
});
