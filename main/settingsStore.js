const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  bar_visible: true,
  bar_position: 'bottom_h',
  bar_accent_color: 'gold',
  bar_font_size: 13,
  // Procent (30-100) -- doar fundalul benzii devine translucid, textul si
  // iconitele raman intotdeauna complet vizibile.
  bar_opacity: 100,
  // Semnul rotund de limitare de viteza (bara + Acasa) -- ca la Python,
  // are propriul comutator, separat de restul campurilor.
  speed_limit_sign_on: true,
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
  // Ca la Trucky -- alege dintr-un set de sunete predefinite, nu un singur
  // fisier fix; se completeaza real la prima citire (vezi listSoundFiles
  // in main.js), asta e doar preferinta implicita.
  alert_sound_file: 'beep3.mp3',
  // Confirmare sonora cand porneste o cursa noua (job preluat) -- separata de
  // alerta de viteza, cu propriul sunet ales din acelasi folder "sounds".
  alert_tripstart_on: true,
  alert_tripstart_sound_file: 'success.mp3',
  // La fel, dar pentru livrarea cu succes a cursei (nu si la anulare).
  alert_tripdelivered_on: true,
  alert_tripdelivered_sound_file: 'notification.mp3',
  hotkeys_enabled: true,
  // Ce informatii apar pe bara flotanta -- ca la Trucky, fiecare se poate
  // ascunde individual din Setari. Toate pornite implicit.
  bar_field_time: true,
  bar_field_route: true,
  bar_field_km_remaining: true,
  bar_field_eta: true,
  bar_field_cargo: true,
  bar_field_speed: true,
  bar_field_fuel: true,
  bar_field_truck_damage: true,
  bar_field_trailer_damage: true,
  bar_field_odometer: true,
  bar_field_rest: true,
  bar_field_fuel_range: true,
  bar_field_cruise_control: true,
  bar_field_gear_rpm: true,
  bar_field_brakes: true,
  bar_field_lights: true,
  bar_field_arrival_clock: true,
  bar_field_cargo_damage: true,
  bar_field_trailer_name: true,
  bar_field_job_income: true,
  bar_field_fuel_consumption: true,
  bar_field_real_clock: true,
  bar_field_wheel_lift: true,
  bar_field_real_eta: true,
};

const BAR_FIELDS = [
  { key: 'time', label: 'Ora din joc' },
  { key: 'route', label: 'Rută (oraș → oraș)' },
  { key: 'km_remaining', label: 'Km rămași' },
  { key: 'eta', label: 'Timp estimat sosire (timp de joc, din GPS)' },
  { key: 'cargo', label: 'Marfă' },
  { key: 'speed', label: 'Viteză' },
  { key: 'fuel', label: 'Combustibil' },
  { key: 'truck_damage', label: 'Daună camion' },
  { key: 'trailer_damage', label: 'Daună remorcă' },
  { key: 'odometer', label: 'Km parcurși (odometru)' },
  { key: 'rest', label: 'Timp până la odihnă obligatorie' },
  { key: 'fuel_range', label: 'Autonomie combustibil (km)' },
  { key: 'cruise_control', label: 'Cruise control (doar când e activ)' },
  { key: 'gear_rpm', label: 'Treaptă de viteză + turație motor' },
  { key: 'brakes', label: 'Frâne (presiune aer, frână de mână, retarder)' },
  { key: 'lights', label: 'Lumini active (faruri, avarii, girofar, semnalizare)' },
  { key: 'arrival_clock', label: 'Ora exactă de sosire' },
  { key: 'cargo_damage', label: 'Daună marfă (live)' },
  { key: 'trailer_name', label: 'Numele remorcii' },
  { key: 'job_income', label: 'Venitul cursei curente' },
  { key: 'fuel_consumption', label: 'Consum mediu combustibil (l/100km)' },
  { key: 'real_clock', label: 'Ceas din realitate' },
  { key: 'wheel_lift', label: 'Indicator roți ridicate (osie liftabilă, camion + remorcă)' },
  { key: 'real_eta', label: 'Timp real până la destinație (minute reale, din viteza medie)' },
];

// Ordinea in care apar campurile pe bara -- incepe ca ordinea "de fabrica" de
// mai sus, dar se schimba pe masura ce activezi campuri (vezi set() mai jos):
// fiecare camp pe care-l ACTIVEZI (comutat pe pornit) trece la finalul listei,
// ca sa apara ultimul din cele "proaspat" activate, in ordinea in care le-ai
// pornit tu.
DEFAULTS.bar_fields_order = BAR_FIELDS.map((f) => f.key);

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
  // Doar o ACTIVARE reala (era oprit, acum il pornesti) muta campul la
  // finalul ordinii -- daca era deja pornit sau il opresti, ordinea ramane.
  if (value === true && key.startsWith('bar_field_') && !cache[key]) {
    const fieldKey = key.slice('bar_field_'.length);
    const order = Array.isArray(cache.bar_fields_order) ? cache.bar_fields_order.filter((k) => k !== fieldKey) : [];
    order.push(fieldKey);
    cache.bar_fields_order = order;
  }
  cache[key] = value;
  save();
}

module.exports = { get, getAll, set, DEFAULTS, BAR_FIELDS };
