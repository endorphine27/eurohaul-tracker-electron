const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Diagnosticare TEMPORARA pt bug-ul "cursa livrata la timp apare intarziata" --
// salvam pe disc, la fiecare livrare, toate valorile brute relevante din SDK,
// ca sa putem vedea exact ce citim (fara sa depindem de console.log, care nu
// se vede intr-o aplicatie Electron impachetata, fara consola atasata).
function filePath() {
  return path.join(app.getPath('userData'), 'delivery_debug.json');
}

function save(data) {
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[deliveryDebugLog] nu am putut salva', err);
  }
}

module.exports = { save, filePath };
