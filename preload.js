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
  onBarVisibilityChanged: (callback) => {
    ipcRenderer.on('bar:visibilityChanged', (_event, visible) => callback(visible));
  },

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
  onPlayTripStartSound: (callback) => {
    ipcRenderer.on('sound:play-tripstart', () => callback());
  },
  getTripStartSoundPath: () => ipcRenderer.invoke('sound:getTripStartPath'),
  onPlayTripDeliveredSound: (callback) => {
    ipcRenderer.on('sound:play-tripdelivered', () => callback());
  },
  getTripDeliveredSoundPath: () => ipcRenderer.invoke('sound:getTripDeliveredPath'),
  listSoundFiles: () => ipcRenderer.invoke('sound:listFiles'),

  autoInstallPlugin: () => ipcRenderer.invoke('plugin:autoInstall'),
  chooseFolderAndInstallPlugin: () => ipcRenderer.invoke('plugin:chooseFolderAndInstall'),
});
