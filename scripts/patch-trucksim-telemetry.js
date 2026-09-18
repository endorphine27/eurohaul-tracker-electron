// Compileaza fork-ul local din native-fix/ (vezi comentariul din
// scsSDKTelemetry.cc pentru motiv) si inlocuieste binarul .node instalat de
// trucksim-telemetry cu versiunea reparata -- acelasi nume de fisier, deci
// restul pachetului (partea JS/TS) il foloseste transparent, fara nicio
// modificare acolo.
//
// Nu critic: daca ceva esueaza aici (ex. lipsesc build tools intr-un mediu
// de dezvoltare), doar avertizam si continuam -- `npm install` nu trebuie
// sa pice din cauza asta.
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const nativeFixDir = path.join(root, 'native-fix');
const targetNodeFile = path.join(root, 'node_modules', 'trucksim-telemetry', 'build', 'Release', 'scsSDKTelemetry.node');

try {
  if (!fs.existsSync(targetNodeFile)) {
    console.log('[patch-trucksim-telemetry] trucksim-telemetry nu pare instalat inca -- sar peste.');
    process.exit(0);
  }

  console.log('[patch-trucksim-telemetry] compilez fork-ul local (diagnosticare + fix marime memorie mapata)...');
  execSync('npx node-gyp rebuild', { cwd: nativeFixDir, stdio: 'inherit' });

  const builtFile = path.join(nativeFixDir, 'build', 'Release', 'scsSDKTelemetry.node');
  if (!fs.existsSync(builtFile)) {
    throw new Error(`fisierul compilat nu exista la ${builtFile}`);
  }

  fs.copyFileSync(builtFile, targetNodeFile);
  console.log('[patch-trucksim-telemetry] scsSDKTelemetry.node inlocuit cu versiunea reparata.');
} catch (err) {
  console.warn('[patch-trucksim-telemetry] nu am putut aplica fix-ul local (ne-critic, se foloseste versiunea originala):', err.message);
}
