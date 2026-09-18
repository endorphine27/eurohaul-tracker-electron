const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Reface exact ce facea instalatorul Inno Setup al versiunii Python
// (eurohaul-setup.iss): gaseste Steam din registry, citeste
// steamapps/libraryfolders.vdf ca sa prinda si bibliotecile de pe alte
// discuri, apoi cauta ETS2/ATS in fiecare biblioteca si copiaza
// scs-telemetry.dll in bin/win_x64/plugins/. Facuta in JS (nu NSIS) ca sa
// ruleze la FIECARE pornire a aplicatiei, nu doar o data la instalare --
// se auto-repara si daca jocul e instalat DUPA tracker sau mutat mai tarziu.

const GAME_FOLDERS = {
  ets2: 'Euro Truck Simulator 2',
  ats: 'American Truck Simulator',
};

function regQueryValue(hive, key, valueName) {
  try {
    const out = execFileSync('reg', ['query', `${hive}\\${key}`, '/v', valueName], {
      encoding: 'utf8', windowsHide: true,
    });
    // Linie de forma: "    SteamPath    REG_SZ    C:\Program Files (x86)\Steam"
    const line = out.split(/\r?\n/).find((l) => l.trim().startsWith(valueName));
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    // valueName, tip (REG_SZ), apoi restul e valoarea (poate contine spatii)
    const value = line.trim().slice(parts[0].length).trim().replace(/^REG_\S+\s+/, '');
    return value || null;
  } catch {
    return null;
  }
}

function getSteamPath() {
  return (
    regQueryValue('HKCU', 'Software\\Valve\\Steam', 'SteamPath')
    || regQueryValue('HKLM', 'SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath')
    || regQueryValue('HKLM', 'SOFTWARE\\Valve\\Steam', 'InstallPath')
    || null
  );
}

// Extrage caile din "libraryfolders.vdf" (format Valve KeyValue simplu) --
// nu avem nevoie de un parser VDF complet, doar de liniile '"path"  "..."'.
function parseLibraryFolders(vdfPath) {
  const libs = [];
  try {
    const text = fs.readFileSync(vdfPath, 'utf8');
    const re = /"path"\s+"([^"]+)"/g;
    let m;
    while ((m = re.exec(text))) {
      const p = m[1].replace(/\\\\/g, '\\');
      if (fs.existsSync(p)) libs.push(p);
    }
  } catch {
    // fisierul nu exista sau nu poate fi citit -- ignoram, ramanem doar cu Steam insusi
  }
  return libs;
}

function getSteamLibraries() {
  const steam = getSteamPath();
  if (!steam) return [];
  const libs = [steam];
  const vdf = path.join(steam, 'steamapps', 'libraryfolders.vdf');
  libs.push(...parseLibraryFolders(vdf));
  return libs;
}

// Cauta folderul bin/win_x64 pentru un joc anume in oricare din bibliotecile
// Steam gasite; null daca jocul nu e instalat.
function findGameBinDir(libraries, gameFolderName) {
  for (const lib of libraries) {
    const bin = path.join(lib, 'steamapps', 'common', gameFolderName, 'bin', 'win_x64');
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

function pluginDllSourcePath(appIsPackaged, appDir, resourcesPath) {
  return appIsPackaged
    ? path.join(resourcesPath, 'plugin', 'scs-telemetry.dll')
    : path.join(appDir, 'plugin', 'scs-telemetry.dll');
}

function copyPluginTo(binDir, dllSrc) {
  const pluginsDir = path.join(binDir, 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.copyFileSync(dllSrc, path.join(pluginsDir, 'scs-telemetry.dll'));
  return pluginsDir;
}

// Detecteaza automat ETS2/ATS prin Steam si copiaza pluginul in fiecare joc
// gasit. Best-effort: orice esec (drept de scriere, Steam neinstalat etc.)
// e prins si raportat, nu blocheaza pornirea aplicatiei.
function autoInstall({ appIsPackaged, appDir, resourcesPath }) {
  const result = { platform: process.platform, ets2: null, ats: null, errors: [] };
  if (process.platform !== 'win32') {
    result.errors.push('Detectarea automata functioneaza doar pe Windows.');
    return result;
  }
  const dllSrc = pluginDllSourcePath(appIsPackaged, appDir, resourcesPath);
  if (!fs.existsSync(dllSrc)) {
    result.errors.push('scs-telemetry.dll nu e inclus in aceasta versiune.');
    return result;
  }
  const libraries = getSteamLibraries();
  if (!libraries.length) {
    result.errors.push('Nu am gasit Steam instalat (registry).');
    return result;
  }
  for (const [key, folderName] of Object.entries(GAME_FOLDERS)) {
    const bin = findGameBinDir(libraries, folderName);
    if (!bin) continue;
    const pluginsDir = path.join(bin, 'plugins');
    const dest = path.join(pluginsDir, 'scs-telemetry.dll');
    try {
      result[key] = copyPluginTo(bin, dllSrc);
    } catch (err) {
      // EBUSY/EPERM aici inseamna aproape sigur ca jocul RULEAZA si are deja
      // DLL-ul incarcat in memorie (Windows blocheaza suprascrierea unui
      // fisier incarcat) -- nu e o eroare reala, e dovada ca pluginul e deja
      // activ. Raportam ca succes doar daca fisierul chiar exista acolo.
      if (fs.existsSync(dest)) {
        result[key] = pluginsDir;
      } else {
        result.errors.push(`${folderName}: ${err.message}`);
      }
    }
  }
  return result;
}

// Fallback manual -- userul alege direct folderul jocului (ex. daca nu e pe
// Steam sau detectarea automata a esuat). Acceptam fie chiar folderul
// "bin\win_x64", fie folderul jocului (radacina), fie folderul Steam
// "common\<Joc>" -- cautam "bin\win_x64" oriunde e mai la indemana.
function installToChosenFolder(chosenDir, { appIsPackaged, appDir, resourcesPath }) {
  const dllSrc = pluginDllSourcePath(appIsPackaged, appDir, resourcesPath);
  if (!fs.existsSync(dllSrc)) {
    return { ok: false, error: 'scs-telemetry.dll nu e inclus in aceasta versiune.' };
  }
  // ATENTIE: chosenDir insusi exista mereu (userul tocmai l-a ales), asa ca
  // NU poate fi un candidat generic -- altfel am accepta gresit radacina
  // jocului drept "bin\win_x64" doar pentru ca folderul exista. Il acceptam
  // direct DOAR daca chiar arata a fi win_x64 (sau parintele lui "plugins").
  const base = path.basename(chosenDir).toLowerCase();
  const candidates = [
    base === 'win_x64' ? chosenDir : null,
    base === 'plugins' ? path.dirname(chosenDir) : null,
    path.join(chosenDir, 'bin', 'win_x64'),
  ].filter(Boolean);
  const binDir = candidates.find((c) => fs.existsSync(c));
  if (!binDir) {
    return { ok: false, error: 'Nu am gasit "bin\\win_x64" in folderul ales.' };
  }
  try {
    const pluginsDir = copyPluginTo(binDir, dllSrc);
    return { ok: true, pluginsDir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  autoInstall,
  installToChosenFolder,
  getSteamPath,
  getSteamLibraries,
  findGameBinDir,
  parseLibraryFolders,
  GAME_FOLDERS,
};
