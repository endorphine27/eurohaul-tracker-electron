const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { startTelemetry } = require('./main/telemetry');
const { createBarWindow } = require('./main/barWindow');
const settingsStore = require('./main/settingsStore');
const { ACCENT_PRESETS, POSITIONS } = require('./main/accentPresets');
const api = require('./main/api');
const { startProfilePoller } = require('./main/profilePoller');
const { createSpeedAlertWatcher } = require('./main/soundAlerts');
const { startDiscordRpc } = require('./main/discordRpc');
const { registerHotkeys, SHORTCUTS } = require('./main/hotkeys');

// In dezvoltare, folderul "sounds" e langa main.js; odata impachetat (vezi
// "extraResources" din package.json), ajunge langa app.asar, in resources/
// -- exact ca la Trucky, usor de gasit si de inlocuit de catre utilizator,
// fara sa fie nevoie sa desfaca vreo arhiva.
const soundsDir = app.isPackaged ? path.join(process.resourcesPath, 'sounds') : path.join(__dirname, 'sounds');
const overspeedSoundPath = path.join(soundsDir, 'overspeed.mp3');

let mainWindow = null;
let telemetryHandle = null;
let barHandle = null;
let profilePoller = null;
let hotkeysHandle = null;
let allHidden = false;
let barHiddenByHotkey = false;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    frame: false,
    backgroundColor: '#0a0e17',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('telemetry:getSnapshot', () => {
  return telemetryHandle ? telemetryHandle.getSnapshot() : { connected: false };
});

ipcMain.handle('sound:getOverspeedPath', () => `file://${overspeedSoundPath.replace(/\\/g, '/')}`);

ipcMain.on('bar:open-settings', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('navigate', 'setari');
});

function applyBarStyleFromSettings() {
  if (!barHandle) return;
  const colorKey = settingsStore.get('bar_accent_color');
  const preset = ACCENT_PRESETS[colorKey] || ACCENT_PRESETS.gold;
  const fontSize = settingsStore.get('bar_font_size');
  barHandle.setStyle({ accentColor: preset.base, accentBright: preset.bright, fontSize });
}

ipcMain.handle('settings:getAll', () => ({
  values: settingsStore.getAll(),
  accentPresets: ACCENT_PRESETS,
  positions: POSITIONS,
  shortcuts: SHORTCUTS,
}));

ipcMain.on('settings:set', (_event, key, value) => {
  settingsStore.set(key, value);
  if (key === 'bar_position' && barHandle) {
    barHandle.setPosition(value);
  }
  if (key === 'bar_accent_color' || key === 'bar_font_size') {
    applyBarStyleFromSettings();
  }
  if (key === 'hotkeys_enabled' && hotkeysHandle) {
    if (value) hotkeysHandle.register();
    else hotkeysHandle.unregister();
  }
});

function toggleAllVisibility() {
  allHidden = !allHidden;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (allHidden) mainWindow.hide(); else mainWindow.show();
  }
  if (barHandle && !barHandle.window.isDestroyed()) {
    if (allHidden) barHandle.window.hide(); else barHandle.window.show();
  }
}

function toggleBarVisibility() {
  if (!barHandle || barHandle.window.isDestroyed()) return;
  barHiddenByHotkey = !barHiddenByHotkey;
  if (barHiddenByHotkey) barHandle.window.hide(); else barHandle.window.show();
}

// ---------- Autentificare + profil (inlocuieste API-ul de login/profil.php
// din versiunea Python -- acelasi server, acelasi contract). ----------
ipcMain.handle('auth:getStatus', () => {
  const token = settingsStore.get('auth_token');
  return { loggedIn: !!token, displayName: settingsStore.get('auth_display_name') };
});

ipcMain.handle('auth:login', async (_event, username, password) => {
  const result = await api.login(username, password);
  if (result.ok) {
    settingsStore.set('auth_token', result.token);
    settingsStore.set('auth_display_name', result.displayName || '');
    profilePoller.start();
  }
  return result;
});

ipcMain.on('auth:logout', () => {
  settingsStore.set('auth_token', '');
  settingsStore.set('auth_display_name', '');
  profilePoller.stop();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth:loggedOut');
  }
});

ipcMain.handle('profile:getSnapshot', () => profilePoller.getSnapshot());
ipcMain.on('profile:refresh', () => profilePoller.refreshNow());

ipcMain.handle('contract:action', async (_event, contractId, actionName) => {
  const token = settingsStore.get('auth_token');
  const result = await api.contractAction(token, contractId, actionName);
  profilePoller.refreshNow();
  return result;
});

const speedAlertWatcher = createSpeedAlertWatcher(
  () => settingsStore.getAll(),
  () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sound:play-overspeed');
    }
  },
);

app.whenReady().then(() => {
  createMainWindow();
  barHandle = createBarWindow(settingsStore.get('bar_position'));
  applyBarStyleFromSettings();

  telemetryHandle = startTelemetry();
  telemetryHandle.onChange((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('telemetry:update', snapshot);
    }
    if (barHandle && !barHandle.window.isDestroyed()) {
      barHandle.window.webContents.send('telemetry:update', snapshot);
    }
    speedAlertWatcher.handleTelemetry(snapshot);
  });

  startDiscordRpc(() => telemetryHandle.getSnapshot());

  profilePoller = startProfilePoller(() => settingsStore.get('auth_token'));
  profilePoller.onChange((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('profile:update', snapshot);
    }
  });
  if (settingsStore.get('auth_token')) {
    profilePoller.start();
  }

  hotkeysHandle = registerHotkeys({
    onToggleAll: toggleAllVisibility,
    onToggleBar: toggleBarVisibility,
  });
  if (settingsStore.get('hotkeys_enabled')) {
    hotkeysHandle.register();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (hotkeysHandle) hotkeysHandle.unregister();
});
