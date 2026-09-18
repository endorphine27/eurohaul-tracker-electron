const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Retine PE DISC (nu doar in memorie) cursa activa curenta -- daca inchizi
// complet tracker-ul (nu doar jocul) cat ai o cursa in desfasurare, la
// urmatoarea pornire tripReporter.js foloseste asta ca sa recunoasca aceeasi
// cursa in loc s-o porneasca a doua oara pe server (ar crea un rand duplicat
// in `trips`, vezi api/log_trip.php -- "start" nu verifica daca mai exista
// deja una activa).

function filePath() {
  return path.join(app.getPath('userData'), 'trip_state.json');
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(filePath(), 'utf-8'));
    if (data && typeof data.tripId === 'number' && typeof data.fingerprint === 'string') return data;
  } catch {
    // fisier lipsa/corupt -- nu avem ce relua
  }
  return null;
}

function save(state) {
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(state), 'utf-8');
  } catch (err) {
    console.error('[tripState] nu am putut salva', err);
  }
}

function clear() {
  try { fs.unlinkSync(filePath()); } catch { /* deja lipseste */ }
}

module.exports = { load, save, clear };
