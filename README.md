# EuroHaul Tracker (Electron)

Rescrierea completă a EuroHaul Tracker, integral în Electron (fără Python).
Citește telemetria ETS2/ATS direct din Node.js prin
[`trucksim-telemetry`](https://github.com/kniffen/TruckSim-Telemetry) (necesită
[scs-sdk-plugin](https://github.com/RenCloud/scs-sdk-plugin) instalat în joc).

## Dezvoltare

```bash
npm install
npm start
```

## Sunete de alertă

Ca la Trucky, aplicația alege dintr-un set de sunete existente în
folderul `sounds/` (vezi `sounds/README.txt`) -- selecția se face din
Setări → Alerte sonore de viteză. După instalare, folderul rămâne
accesibil lângă executabil, nu e împachetat.

## Build (instalator Windows)

Necesită Node.js 22+ și Visual Studio Build Tools ("Desktop development with
C++") pentru compilarea modulului nativ de telemetrie.

```bash
npm install
npm run dist
```

Instalatorul rezultă în `dist/`. Pe GitHub, workflow-ul din
`.github/workflows/build-windows.yml` face asta automat la fiecare push pe
`main` și publică instalatorul ca GitHub Release.

## Structură

- `main.js` + `main/` — procesul principal (fereastră, bară, telemetrie, API
  server, Discord, alerte sonore, taste rapide)
- `renderer/` — interfața (fereastra principală + bara flotantă)
- `assets/` — iconița aplicației
- `sounds/` — sunetul de alertă de viteză (pus manual de utilizator)
