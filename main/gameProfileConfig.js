const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

// Detectie DIRECTA a setarii "Amenzi" din joc (ca la Trucky), in loc sa
// ghicim statistic pe server daca jucatorul are amenzile oprite (vezi
// tripReporter.js OVERSPEED_MARGIN_KMH / config.php get_fines_off_*).
//
// ETS2/ATS scriu dificultatea aleasa in config.cfg-ul PROFILULUI activ, ca
// linii text simple: `uset g_police "1"` (1=pornite, 0=oprite). Fisierul e
// rescris de joc la fiecare pornire/iesire, deci ce citim noi cat jocul
// ruleaza reflecta exact ce a ales jucatorul la ultima pornire a profilului.

// Citita o singura data la refresh (nu la fiecare tick de telemetrie) --
// setarea asta se schimba extrem de rar.
const REFRESH_INTERVAL_MS = 30000;

const WATCHED_KEYS = ['g_police'];

function documentsDir() {
  try {
    // Foloseste rezolvarea nativa a Electron (respecta redirectarea OneDrive
    // a folderului Documents pe Windows), nu doar os.homedir() + 'Documents'.
    return app.getPath('documents');
  } catch {
    return path.join(os.homedir(), 'Documents');
  }
}

function gameDirs() {
  const docs = documentsDir();
  return [
    { game: 'ets2', dir: path.join(docs, 'Euro Truck Simulator 2') },
    { game: 'ats', dir: path.join(docs, 'American Truck Simulator') },
  ];
}

// Fiecare folder din profiles/ e o salvare separata; SDK-ul de telemetrie nu
// ne spune care e "activa" acum, asa ca alegem config.cfg-ul cel mai recent
// MODIFICAT (jocul il rescrie la fiecare pornire/autosave/iesire a profilului
// folosit).
function findActiveProfileConfig(gameDir) {
  const profilesDir = path.join(gameDir, 'profiles');
  let entries;
  try {
    entries = fs.readdirSync(profilesDir, { withFileTypes: true });
  } catch {
    return null;
  }
  let best = null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const cfgPath = path.join(profilesDir, entry.name, 'config.cfg');
    try {
      const stat = fs.statSync(cfgPath);
      if (!best || stat.mtimeMs > best.mtimeMs) best = { cfgPath, mtimeMs: stat.mtimeMs };
    } catch {
      // acest folder de profil nu are (inca) un config.cfg -- il sarim
    }
  }
  return best ? best.cfgPath : null;
}

// Linii de forma: `uset g_police "1"` sau `g_police 1` (prefixul uset e
// optional, ghilimelele la fel) -- extragem doar cheile care ne intereseaza.
function parseConfig(text) {
  const out = {};
  const re = /^\s*(?:uset\s+)?(\w+)\s+"?(-?[\w.]+)"?/gm;
  let m;
  while ((m = re.exec(text))) {
    if (WATCHED_KEYS.includes(m[1])) out[m[1]] = m[2];
  }
  return out;
}

function toBool(v) {
  return v === undefined ? null : v !== '0';
}

function readOnce() {
  const result = { ets2: null, ats: null };
  for (const { game, dir } of gameDirs()) {
    const cfgPath = findActiveProfileConfig(dir);
    if (!cfgPath) continue;
    try {
      const values = parseConfig(fs.readFileSync(cfgPath, 'utf-8'));
      result[game] = { finesEnabled: toBool(values.g_police) };
    } catch {
      // fisier ilizibil/disparut intre timp -- ramane null pentru acest joc
    }
  }
  return result;
}

let cached = { ets2: null, ats: null };
let started = false;

function startWatching() {
  if (started) return;
  started = true;
  cached = readOnce();
  setInterval(() => { cached = readOnce(); }, REFRESH_INTERVAL_MS);
}

// null = nu am putut citi/detecta (Linux, instalare neobisnuita etc.) --
// apelantul trebuie sa trateze null ca "necunoscut", nu ca "false".
function getFinesEnabled(isAts) {
  const entry = isAts ? cached.ats : cached.ets2;
  return entry ? entry.finesEnabled : null;
}

module.exports = { startWatching, getFinesEnabled };
