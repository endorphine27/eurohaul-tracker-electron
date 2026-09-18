const { getData } = require('trucksim-telemetry');

// Spre deosebire de Python (unde citeam un id brut si il mapam noi la un
// nume "frumos"), trucksim-telemetry ne da deja numele de afisat direct
// (truckBrand/truckName), asa ca nu mai e nevoie de un tabel de mapare aici.

function metersPerSecondToKmh(v) {
  return typeof v === 'number' ? v * 3.6 : null;
}

function secondsToMinutes(v) {
  return typeof v === 'number' ? v / 60 : null;
}

function metersToKm(v) {
  return typeof v === 'number' ? v / 1000 : null;
}

// SDK-ul intoarce 0 pentru "fara limita afisata aici" (parcari, curtea
// firmei, drum privat etc.), NU o limita reala de 0 km/h -- altfel orice
// viteza > 0 acolo declanseaza gresit alerta de depasire si semnul arata
// "0" in loc de "necunoscut".
function speedLimitKmh(speedLimitMps) {
  if (typeof speedLimitMps !== 'number' || speedLimitMps <= 0) return null;
  return speedLimitMps * 3.6;
}

// Normalizeaza campurile brute din SDK (nume/unitati specifice SCS) in forma
// pe care o foloseste interfata noastra -- acelasi rol pe care il avea
// pick()/CANDIDATE_KEYS in versiunea Python.
function normalize(d) {
  if (!d) return { connected: false };
  return {
    connected: !!d.sdkActive,
    isAts: d.game === 2, // 0=necunoscut, 1=ETS2, 2=ATS
    onTrip: !!(d.cityDst || d.cargo),
    truckBrand: d.truckBrand || null,
    truckModel: d.truckName || null,
    truckPlate: d.truckLicensePlate || null,
    speedKmh: metersPerSecondToKmh(d.speed),
    speedLimitKmh: speedLimitKmh(d.speedLimit),
    cruiseControl: !!d.cruiseControl,
    fuelLiters: d.fuel ?? null,
    fuelCapacity: d.fuelCapacity ?? null,
    fuelPct: (typeof d.fuel === 'number' && typeof d.fuelCapacity === 'number' && d.fuelCapacity > 0)
      ? Math.round((d.fuel / d.fuelCapacity) * 100) : null,
    fuelAvgConsumption: d.fuelAvgConsumption ?? null,
    fuelRangeKm: d.fuelRange ?? null,
    odometerKm: d.truckOdometer ?? null,
    routeFrom: d.citySrc || null,
    routeTo: d.cityDst || null,
    companyFrom: d.compSrc || null,
    companyTo: d.compDst || null,
    cargo: d.cargo || null,
    cargoMassKg: d.cargoMass ?? null,
    kmRemaining: metersToKm(d.routeDistance),
    plannedDistanceKm: d.plannedDistanceKm ?? null,
    progress: (typeof d.routeDistance === 'number' && typeof d.plannedDistanceKm === 'number' && d.plannedDistanceKm > 0)
      ? Math.max(0, Math.min(1, 1 - (metersToKm(d.routeDistance) / d.plannedDistanceKm)))
      : null,
    etaMinutes: secondsToMinutes(d.routeTime),
    wearEngine: d.wearEngine ?? null,
    wearTransmission: d.wearTransmission ?? null,
    wearCabin: d.wearCabin ?? null,
    wearChassis: d.wearChassis ?? null,
    wearWheels: d.wearWheels ?? null,
    restMinutes: d.restStop ?? null,
    gameTimeMinutes: typeof d.timeAbs === 'number' ? d.timeAbs : null,
    truckDamagePct: averageWear([d.wearEngine, d.wearTransmission, d.wearCabin, d.wearChassis, d.wearWheels]),
    trailerDamagePct: trailerDamagePct(d.trailers),
    jobMarket: d.jobMarket || null,
    // Folosite DOAR de tripReporter (raportarea curselor catre server), nu de
    // interfata -- vezi main/tripReporter.js. Nu redenumim/rotunjim aici ca
    // sa ramana usor de comparat 1:1 cu documentatia SDK-ului.
    coordX: typeof d.coordinateX === 'number' ? d.coordinateX : null,
    coordZ: typeof d.coordinateZ === 'number' ? d.coordinateZ : null,
    timeAbsDelivery: typeof d.timeAbsDelivery === 'number' ? d.timeAbsDelivery : null,
    jobDelivered: !!d.jobDelivered,
    jobDeliveredRevenue: typeof d.jobDeliveredRevenue === 'bigint' ? Number(d.jobDeliveredRevenue) : null,
    jobDeliveredDistanceKm: typeof d.jobDeliveredDistanceKm === 'number' ? d.jobDeliveredDistanceKm : null,
    jobDeliveredCargoDamage: typeof d.jobDeliveredCargoDamage === 'number' ? d.jobDeliveredCargoDamage : null,
    jobCancelled: !!d.jobCancelled,
    jobCancelledPenalty: typeof d.jobCancelledPenalty === 'bigint' ? Number(d.jobCancelledPenalty) : null,
    // Sloturile astea raman "agatate" in SDK dupa prima amenda (bug cunoscut,
    // vezi memoria vtc-fines-sdk-replay) -- tripReporter le trateaza ca
    // schimbari de SEMNATURA (offence+suma), nu ca evenimente noi de fiecare
    // data cand sunt !=0.
    fineOffenceRaw: d.fineOffence || null,
    fineAmountRaw: typeof d.fineAmount === 'bigint' ? Number(d.fineAmount) : null,
  };
}

// Media daunelor camionului (0..1 fiecare) -> procent intreg. La fel ca la
// Trucky, care afiseaza un singur procent agregat pentru camion.
function averageWear(values) {
  const nums = values.filter((v) => typeof v === 'number');
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100);
}

// Prima remorca atasata (majoritatea curselor au una singura); wearBody
// acopera si dauna incarcaturii vizual pe caroserie, la fel ca wear-urile
// camionului mai sus.
function trailerDamagePct(trailers) {
  if (!Array.isArray(trailers) || !trailers.length) return null;
  const t = trailers.find((tr) => tr && tr.attached) || trailers[0];
  if (!t || !t.attached) return null;
  return averageWear([t.wearChassis, t.wearWheels, t.wearBody]);
}

// Porneste ascultarea telemetriei si intoarce { getSnapshot, onChange }.
// `onChange(cb)` cheama cb(snapshot) la fiecare actualizare.
//
// NU folosim `truckSimTelemetry()` (bucla interna a pachetului, la ~60Hz) --
// depanare reala la un utilizator a aratat ca deschiderea/inchiderea
// memoriei partajate de 60 ori/secunda esueaza intermitent pe unele masini
// (sdkActive ramane permanent false), in timp ce un apel IZOLAT, facut mai
// rar, prin `getData()`, citeste corect datele (sdkActive:true confirmat).
// Facem propriul interval, mult mai relaxat -- suficient de des pentru o
// bara de informatii, fara sa suprasolicite deschiderea fisierului mapat.
function startTelemetry() {
  const listeners = [];
  let latest = normalize(null);
  let lastLogAt = 0;
  let loggedFirst = false;

  function poll() {
    let data = null;
    try {
      data = getData();
    } catch (err) {
      console.error('[telemetry] getData() a aruncat o eroare', err);
    }
    latest = normalize(data);

    const now = Date.now();
    if (!loggedFirst && data) {
      loggedFirst = true;
      console.log('[telemetry] primul update brut:', JSON.stringify({
        sdkActive: data.sdkActive, game: data.game, paused: data.paused,
        speed: data.speed, truckOdometer: data.truckOdometer,
      }));
    }
    if (now - lastLogAt > 3000) {
      lastLogAt = now;
      console.log('[telemetry] stare curenta:', JSON.stringify({
        sdkActive: data ? data.sdkActive : null,
        game: data ? data.game : null,
        speed: data ? data.speed : null,
      }));
    }

    for (const cb of listeners) {
      try { cb(latest); } catch (err) { console.error('[telemetry] listener error', err); }
    }
  }

  setInterval(poll, 200);
  poll();

  return {
    getSnapshot: () => latest,
    onChange: (cb) => listeners.push(cb),
  };
}

module.exports = { startTelemetry, normalize };
