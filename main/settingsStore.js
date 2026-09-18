const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  bar_position: 'bottom_h',
  bar_accent_color: 'gold',
  bar_font_size: 13,
  auth_token: '',
  auth_display_name: '',
  // Alerte sonore de viteza -- locale, 2 tipuri x 2 jocuri, ca la Trucky.
  alert_roadlimit_ets2_on: false,
  alert_roadlimit_ets2_tol: 0,
  alert_roadlimit_ats_on: false,
  alert_roadlimit_ats_tol: 0,
  alert_maxspeed_ets2_on: false,
  alert_maxspeed_ets2_val: 90,
  alert_maxspeed_ats_on: false,
  alert_maxspeed_ats_val: 120,
  hotkeys_enabled: true,
};

let cache = null;

function filePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(filePath(), 'utf-8');
    cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.error('[settings] nu am putut salva', err);
  }
}

function get(key) {
  return load()[key];
}

function getAll() {
  return { ...load() };
}

function set(key, value) {
  load();
  cache[key] = value;
  save();
}

module.exports = { get, getAll, set, DEFAULTS };
