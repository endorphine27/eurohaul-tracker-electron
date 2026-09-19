const crypto = require('crypto');
const api = require('./api');
const tripState = require('./tripState');

// Reface exact ce facea versiunea Python (log_trip/log_sample/push_live_status/
// log_fine), care lipsea complet din rescrierea Electron -- fara asta, contul
// nu mai acumuleaza curse/km/castig/amenzi si harta Live + panoul mobil raman
// goale pentru orice sofer care foloseste tracker-ul nou.
//
// Logica GREA (venit, uzura, contracte, rating) ramane pe server -- aici doar
// trimitem la momentele potrivite exact datele pe care log_trip.php/etc. le
// asteapta deja (vezi vtc/api/*.php).

const SAMPLE_INTERVAL_MS = 20000;
const LIVE_STATUS_INTERVAL_MS = 2000;
// Marja peste limita de drum ca sa numaram o secunda ca "overspeed" -- doar un
// indiciu trimis catre server (watchdog pentru amenzi posibil dezactivate in
// joc), nu afecteaza direct plata. Aliniat cu valoarea implicita a setarii
// server "fines_off_overspeed_kmh" (vezi config.php) -- daca un admin schimba
// pragul din site, watchdog-ul foloseste tot valoarea serverului la decizie,
// dar acumularea locala trebuie sa ramana rezonabil de aproape de ea.
const OVERSPEED_MARGIN_KMH = 10;
// Rezerva scurta pt un eventual sughit real de telemetrie CAT ESTI DEJA in
// camion (vezi TRUCK_BRAND-gate mai jos, care e apararea principala) -- nu
// pentru ecranul de incarcare, care poate dura mult mai mult de atat.
const TRIP_END_GRACE_MS = 5000;

function pct(v) {
  return typeof v === 'number' ? v * 100 : null;
}

function randomEventId() {
  return crypto.randomBytes(16).toString('hex');
}

// "Amprenta" cursei -- campuri stabile care nu se schimba in timpul aceleiasi
// curse, folosite DOAR ca sa recunoastem daca o cursa reluata dupa un restart
// de tracker e chiar cea persistata sau alta noua (vezi checkResume).
function buildTripFingerprint(s) {
  return JSON.stringify([
    s.routeFrom, s.companyFrom, s.routeTo, s.companyTo,
    s.cargo, s.cargoMassKg, s.plannedDistanceKm, s.truckBrand, s.truckModel,
  ]);
}

// `getToken` e o functie (nu un token fix) fiindca userul se poate loga/delo-
// ga in timp ce aplicatia ruleaza -- vrem mereu valoarea CURENTA.
function createTripReporter({ getToken, telemetry, onTripStart, onTripDelivered }) {
  let running = false;
  let tripId = null;
  let wasOnTrip = false;
  let lastTickAtMs = null;
  let drivingSeconds = 0;
  let overspeedSeconds = 0;
  let fuelRefueled = 0;
  let lastFuelLevel = null;
  let pendingDelivery = null; // {revenue, distanceKm, cargoDamage} din tick-ul cu jobDelivered=true
  let lastFineSig = null;
  let fineBaselinePrimed = false;
  let sampleTimer = null;
  let liveStatusTimer = null;
  // Cursa persistata pe disc la ultima pornire a aplicatiei (vezi tripState.js)
  // -- verificata O SINGURA DATA, la primul tick conectat de dupa start().
  let resumeCandidate = null;
  let resumeChecked = true;
  let pendingEndAt = null;

  function resetTripAccumulators() {
    drivingSeconds = 0;
    overspeedSeconds = 0;
    fuelRefueled = 0;
    lastFuelLevel = null;
    lastTickAtMs = null;
    pendingDelivery = null;
  }

  async function handleTripStart(s) {
    const token = getToken();
    if (!token || tripId) return;
    resetTripAccumulators();
    const fields = {
      source_city: s.routeFrom,
      source_company: s.companyFrom,
      destination_city: s.routeTo,
      destination_company: s.companyTo,
      cargo: s.cargo,
      cargo_mass_kg: s.cargoMassKg,
      planned_distance_km: s.plannedDistanceKm,
      truck_name: [s.truckBrand, s.truckModel].filter(Boolean).join(' ') || null,
      truck_brand: s.truckBrand,
      truck_model: s.truckModel,
      job_market: s.jobMarket || 'unknown',
    };
    try {
      const res = await api.startTrip(token, fields, s.odometerKm, s.fuelLiters);
      if (res && res.ok && res.trip_id) {
        tripId = res.trip_id;
        tripState.save({ tripId, fingerprint: buildTripFingerprint(s) });
      }
    } catch (err) {
      console.error('[tripReporter] startTrip esuat', err);
    }
  }

  async function handleTripEnd(s) {
    const token = getToken();
    const activeTripId = tripId;
    tripId = null; // eliberam imediat, ca o cursa noua sa nu se amestece cu asta
    tripState.clear();
    if (!token || !activeTripId) {
      resetTripAccumulators();
      return;
    }

    const delivered = pendingDelivery;
    // Confirmarea sonora de livrare, la fel ca la pornirea cursei -- instant,
    // fara sa astepte raspunsul serverului. Doar la livrare reala (nu si la
    // anulare, cand `delivered` ramane null pentru ca jobDelivered n-a aparut).
    if (delivered && typeof onTripDelivered === 'function') {
      try { onTripDelivered(s); } catch { /* ignoram */ }
    }
    // "la timp" e deja calculat mai sus, chiar in tick-ul livrarii (vezi
    // comentariul de la pendingDelivery) -- nu il recalculam aici cu date
    // posibil invechite. Fara livrare reala (anulare), consideram "la timp"
    // implicit, ca sa nu penalizam fara sa stim sigur.
    const onTime = delivered ? delivered.onTime : true;

    const payload = {
      odometer_km: s.odometerKm,
      fuel_liters: s.fuelLiters,
      cargo_damage_percent: delivered ? pct(delivered.cargoDamage) : null,
      wear_engine_percent: pct(s.wearEngine),
      wear_transmission_percent: pct(s.wearTransmission),
      wear_cabin_percent: pct(s.wearCabin),
      wear_chassis_percent: pct(s.wearChassis),
      wear_wheels_percent: pct(s.wearWheels),
      trailer_damage_percent: s.trailerDamagePct,
      fuel_refueled_liters: Math.round(fuelRefueled * 10) / 10,
      final_revenue: delivered ? delivered.revenue : null,
      final_delivered_distance: delivered ? delivered.distanceKm : null,
      delivery_status: onTime ? 'on_time' : 'late',
      overspeed_seconds: Math.round(overspeedSeconds),
      driving_seconds: Math.round(drivingSeconds),
      fuel_avg_consumption: s.fuelAvgConsumption,
      // Detectie DIRECTA a setarii "Amenzi" din joc (config.cfg, g_police) --
      // are prioritate pe server fata de watchdog-ul statistic vechi, vezi
      // api/log_trip.php. null cand tracker-ul n-a putut citi fisierul.
      fines_enabled_detected: s.finesEnabledDetected,
    };
    resetTripAccumulators();
    try {
      await api.endTrip(token, activeTripId, payload);
    } catch (err) {
      console.error('[tripReporter] endTrip esuat', err);
    }
  }

  // Bug cunoscut al SDK-ului: sloturile fineOffence/fineAmount raman "agatate"
  // cu ultima amenda si sunt reemise la nesfarsit, inclusiv pe curse noi. Nu
  // tratam o valoare nenula ca eveniment nou decat daca s-a SCHIMBAT fata de
  // ultima citire, si "amorsam" (fara sa trimitem) orice se afla deja in slot
  // la prima citire de dupa pornirea raportarii.
  async function handleFineCheck(s) {
    const hasFine = !!s.fineOffenceRaw && typeof s.fineAmountRaw === 'number' && s.fineAmountRaw > 0;

    if (!fineBaselinePrimed) {
      lastFineSig = hasFine ? `${s.fineOffenceRaw}:${s.fineAmountRaw}` : null;
      fineBaselinePrimed = true;
      return;
    }
    if (!hasFine) {
      lastFineSig = null;
      return;
    }
    const sig = `${s.fineOffenceRaw}:${s.fineAmountRaw}`;
    if (sig === lastFineSig) return;
    lastFineSig = sig;

    if (!tripId) return; // fara cursa activa nu avem la ce trip_id sa o atasam
    const token = getToken();
    if (!token) return;
    try {
      await api.logFine(token, tripId, s.fineAmountRaw, s.fineOffenceRaw, randomEventId());
    } catch (err) {
      console.error('[tripReporter] logFine esuat', err);
    }
  }

  // Daca tracker-ul a fost inchis complet (nu doar jocul) cat o cursa era in
  // desfasurare, la repornire nu mai stim in memorie ca era deja pornita --
  // fara asta am trimite un al doilea "start" la server pentru ACEEASI cursa
  // (log_trip.php nu verifica daca mai exista deja una activa -> rand
  // duplicat, orfan). Comparam "amprenta" jobului curent din joc cu cea
  // salvata: daca se potriveste, reluam acelasi trip_id fara sa mai pornim
  // nimic; daca nu (livrata/anulata/alt job cat timp am fost inchisi),
  // inchidem best-effort cursa orfana pe server ca sa nu ramana agatata la
  // nesfarsit in "in_progress".
  function checkResume(s) {
    if (!resumeCandidate) { resumeChecked = true; return; }
    // `sdkActive` (s.connected) e adevarat din momentul in care JOCUL
    // PORNESTE -- ramane asa tot meniul principal si tot ecranul de
    // incarcare a salvarii (poate dura peste un minut), cu mult inainte sa
    // ajungi efectiv in cabina. Pana atunci `s.truckBrand` e gol, iar
    // `s.onTrip` nu inseamna nimic real -- asteptam sa vedem un camion.
    if (!s.truckBrand) return;
    resumeChecked = true;
    const rc = resumeCandidate;
    resumeCandidate = null;
    if (s.onTrip && buildTripFingerprint(s) === rc.fingerprint) {
      tripId = rc.tripId;
      wasOnTrip = true;
      console.log('[tripReporter] cursa reluata dupa restart tracker, trip_id=', tripId);
    } else {
      const token = getToken();
      if (token) api.endTrip(token, rc.tripId, { delivery_status: 'cancelled' }).catch(() => {});
    }
  }

  function onTick(s) {
    if (!running || !s.connected) return;
    const now = Date.now();
    if (!resumeChecked) checkResume(s);

    handleFineCheck(s).catch(() => {});

    if (tripId && lastTickAtMs != null) {
      // clamp la 5s: daca jocul a fost in pauza/minimizat, nu vrem sa adunam
      // ore intregi dintr-un singur salt de timestamp.
      const dtSec = Math.min(5, Math.max(0, (now - lastTickAtMs) / 1000));
      if ((s.speedKmh ?? 0) > 1) drivingSeconds += dtSec;
      if (s.speedLimitKmh != null && s.speedKmh != null && s.speedKmh > s.speedLimitKmh + OVERSPEED_MARGIN_KMH) {
        overspeedSeconds += dtSec;
      }
      if (lastFuelLevel != null && typeof s.fuelLiters === 'number' && s.fuelLiters > lastFuelLevel) {
        fuelRefueled += s.fuelLiters - lastFuelLevel;
      }
    }
    lastFuelLevel = typeof s.fuelLiters === 'number' ? s.fuelLiters : lastFuelLevel;
    lastTickAtMs = now;

    // SDK-ul tine cifrele finale doar 1 tick -- le prindem imediat si le
    // folosim putin mai tarziu, cand onTrip chiar devine false. La fel si
    // pentru "la timp": timeAbsDelivery/gameTimeMinutes trebuie citite chiar
    // ACUM, nu in handleTripEnd -- pana acolo ajunge sa treaca perioada de
    // gratie (+ posibil ecranul de incarcare), timp in care jocul poate
    // reseta/schimba aceste campuri, ducand la un "intarziata" gresit pentru
    // o cursa livrata de fapt la timp.
    if (s.jobDelivered) {
      pendingDelivery = {
        revenue: s.jobDeliveredRevenue,
        distanceKm: s.jobDeliveredDistanceKm,
        cargoDamage: s.jobDeliveredCargoDamage,
        onTime: (typeof s.timeAbsDelivery === 'number' && typeof s.gameTimeMinutes === 'number')
          ? s.gameTimeMinutes <= s.timeAbsDelivery
          : true,
      };
    }

    // La fel ca in checkResume -- fara camion incarcat (meniu/incarcare, care
    // poate dura mult) "fara job" nu inseamna nimic. Nu atingem nimic pana nu
    // vedem un camion real, indiferent cat dureaza asta.
    if (!s.truckBrand) return;

    if (s.onTrip) {
      pendingEndAt = null; // orice "sfarsit" suspectat anterior nu se mai confirma
      if (!wasOnTrip) {
        wasOnTrip = true;
        // Confirmarea sonora locala nu trebuie sa astepte raspunsul serverului
        // (ar putea sa nici nu vina, de ex. fara internet) -- pornim cursa
        // "vizual/audio" instant, raportarea catre server e separata.
        if (typeof onTripStart === 'function') {
          try { onTripStart(s); } catch { /* ignoram */ }
        }
        handleTripStart(s).catch(() => {});
      }
    } else if (wasOnTrip) {
      // Nu inchidem imediat -- vezi TRIP_END_GRACE_MS mai sus. Daca jobul
      // "revine" (s.onTrip redevine true) inainte sa expire, ramanem pe
      // aceeasi cursa, fara sa fi trimis nimic la server intre timp.
      if (pendingEndAt === null) {
        pendingEndAt = now;
      } else if (now - pendingEndAt >= TRIP_END_GRACE_MS) {
        wasOnTrip = false;
        pendingEndAt = null;
        handleTripEnd(s).catch(() => {});
      }
    }
  }

  function flushSample() {
    if (!running || !tripId) return;
    const token = getToken();
    if (!token) return;
    const s = telemetry.getSnapshot();
    if (!s.connected) return;
    const sample = {
      coord_x: s.coordX, coord_z: s.coordZ,
      speed_kmh: s.speedKmh, odometer_km: s.odometerKm,
      sampled_at: new Date().toISOString(),
    };
    api.logSample(token, tripId, [sample]).catch((err) => console.error('[tripReporter] logSample esuat', err));
  }

  function flushLiveStatus() {
    if (!running) return;
    const token = getToken();
    if (!token) return;
    const s = telemetry.getSnapshot();
    const payload = {
      connected: s.connected,
      on_trip: s.onTrip,
      route_from: s.routeFrom, route_to: s.routeTo,
      company_from: s.companyFrom, company_to: s.companyTo,
      cargo: s.cargo, cargo_mass_kg: s.cargoMassKg,
      km_remaining: s.kmRemaining, eta_minutes: s.etaMinutes,
      speed_kmh: s.speedKmh, speed_limit_kmh: s.speedLimitKmh,
      fuel_pct: s.fuelPct, odometer_km: s.odometerKm,
      fuel_capacity_liters: s.fuelCapacity,
      rest_minutes: s.restMinutes,
      wear_engine_pct: pct(s.wearEngine),
      wear_transmission_pct: pct(s.wearTransmission),
      wear_cabin_pct: pct(s.wearCabin),
      wear_chassis_pct: pct(s.wearChassis),
      wear_wheels_pct: pct(s.wearWheels),
      trailer_damage_pct: s.trailerDamagePct,
    };
    api.pushLiveStatus(token, payload).catch((err) => console.error('[tripReporter] pushLiveStatus esuat', err));
  }

  // Un singur abonament, pe toata durata vietii aplicatiei -- start()/stop()
  // doar comuta flag-ul `running` (verificat la inceputul lui onTick) in loc
  // sa (dez)aboneze de fiecare data, ca sa nu se acumuleze listeneri
  // duplicati la fiecare ciclu login/logout.
  telemetry.onChange(onTick);

  function start() {
    if (running) return;
    running = true;
    wasOnTrip = false;
    tripId = null;
    // Incarcam ce-am persistat ultima data (vezi checkResume) -- rulam
    // verificarea la primul tick conectat, nu aici, fiindca abia atunci stim
    // daca jobul din joc chiar se potriveste cu cel salvat.
    resumeCandidate = tripState.load();
    resumeChecked = !resumeCandidate;
    pendingEndAt = null;
    resetTripAccumulators();
    lastFineSig = null;
    fineBaselinePrimed = false;
    sampleTimer = setInterval(flushSample, SAMPLE_INTERVAL_MS);
    liveStatusTimer = setInterval(flushLiveStatus, LIVE_STATUS_INTERVAL_MS);
  }

  function stop() {
    running = false;
    if (sampleTimer) clearInterval(sampleTimer);
    if (liveStatusTimer) clearInterval(liveStatusTimer);
    sampleTimer = null;
    liveStatusTimer = null;
    tripId = null;
  }

  return { start, stop };
}

module.exports = { createTripReporter };
