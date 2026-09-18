const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
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
const SOUND_EXTENSIONS = ['.mp3', '.wav', '.ogg'];

// Ca la Trucky -- nu un singur fisier fix, ci un set de sunete din care
// utilizatorul alege in Setari pe care il vrea pentru alerta de viteza.
function listSoundFiles() {
  try {
    return fs.readdirSync(soundsDir)
      .filter((f) => SOUND_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .sort();
  } catch {
    return [];
  }
}

function overspeedSoundPath() {
  const available = listSoundFiles();
  const chosen = settingsStore.get('alert_sound_file');
  const file = available.includes(chosen) ? chosen : available[0];
  return file ? path.join(soundsDir, file) : null;
}

let mainWindow = null;
let telemetryHandle = null;
let barHandle = null;
let profilePoller = null;
let hotkeysHandle = null;
let allHidden = false;

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
    // Bara ramane o fereastra separata, deschisa -- fara asta,
    // "window-all-closed" nu ar declansa niciodata pentru ca Electron
    // vede bara ca fereastra inca deschisa, iar programul ar ramane
    // pornit "invizibil" in Task Manager dupa ce utilizatorul apasa X.
    app.quit();
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

ipcMain.handle('sound:getOverspeedPath', () => {
  const p = overspeedSoundPath();
  return p ? `file://${p.replace(/\\/g, '/')}` : null;
});
ipcMain.handle('sound:listFiles', () => listSoundFiles());

ipcMain.on('bar:open-settings', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('navigate', 'setari');
});

function fieldsFromSettings() {
  const fields = {};
  for (const f of settingsStore.BAR_FIELDS) {
    fields[f.key] = settingsStore.get(`bar_field_${f.key}`);
  }
  return fields;
}

// "#rrggbb" -> "r,g,b", ca sa poata fi bagat direct intr-un rgba() din CSS
// (asa se aplica opacitatea DOAR pe fundal, fara sa se vada prin text).
function hexToRgbList(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '13,17,25';
  return [1, 2, 3].map((i) => parseInt(m[i], 16)).join(',');
}

function applyBarStyleFromSettings() {
  if (!barHandle) return;
  const colorKey = settingsStore.get('bar_accent_color');
  const preset = ACCENT_PRESETS[colorKey] || ACCENT_PRESETS.gold;
  const fontSize = settingsStore.get('bar_font_size');
  const opacity = settingsStore.get('bar_opacity') / 100;
  barHandle.setStyle({
    accentColor: preset.base,
    accentBright: preset.bright,
    accentRgb: hexToRgbList(preset.base),
    opacity,
    fontSize,
    fields: fieldsFromSettings(),
  });
}

ipcMain.handle('settings:getAll', () => ({
  values: settingsStore.getAll(),
  accentPresets: ACCENT_PRESETS,
  positions: POSITIONS,
  shortcuts: SHORTCUTS,
  barFields: settingsStore.BAR_FIELDS,
  soundFiles: listSoundFiles(),
}));

// Vizibilitatea barei depinde de 2 lucruri independente: comutatorul
// "Bară info" din Acasă / tasta Ctrl+Alt+B (setare persistenta,
// bar_visible) si Ctrl+Alt+H care ascunde TOT temporar (allHidden, nu se
// salveaza). Bara e vizibila doar daca ambele conditii sunt indeplinite.
function applyBarVisibility() {
  if (!barHandle || barHandle.window.isDestroyed()) return;
  const shouldShow = settingsStore.get('bar_visible') && !allHidden;
  if (shouldShow) barHandle.window.show();
  else barHandle.window.hide();
}

ipcMain.on('settings:set', (_event, key, value) => {
  settingsStore.set(key, value);
  if (key === 'bar_position' && barHandle) {
    barHandle.setPosition(value);
  }
  if (key === 'bar_accent_color' || key === 'bar_font_size' || key === 'bar_opacity' || key.startsWith('bar_field_')) {
    applyBarStyleFromSettings();
  }
  if (key === 'bar_visible') {
    applyBarVisibility();
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
  applyBarVisibility();
}

// Apasata din tasta rapida Ctrl+Alt+B -- trebuie sa se comporte identic cu
// comutatorul "Bară info" din Acasă (aceeasi setare persistenta), ca cele
// doua sa ramana mereu in sincron, indiferent care a fost apasat ultimul.
function toggleBarVisibility() {
  const next = !settingsStore.get('bar_visible');
  settingsStore.set('bar_visible', next);
  applyBarVisibility();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bar:visibilityChanged', next);
  }
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
  applyBarVisibility();

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
