const bar = document.getElementById('bar');
const dotEl = document.getElementById('dot');
const textEl = document.getElementById('main-text');
const gearEl = document.getElementById('gear');
const signEl = document.getElementById('speed-sign');

gearEl.addEventListener('click', () => window.eurohaulBar.openSettings());

let vertical = false;
let maxFont = 13;
let lastSnapshot = { connected: false };
const MIN_FONT = 9;
// Implicit toate pornite -- pana vine primul "bar:style" din Setari.
let fields = {
  time: true, route: true, km_remaining: true, eta: true, cargo: true,
  speed: true, fuel: true, truck_damage: true, trailer_damage: true, odometer: true,
  rest: true, fuel_range: true, cruise_control: true,
  gear_rpm: true, brakes: true, lights: true, arrival_clock: true,
  cargo_damage: true, trailer_name: true, job_income: true,
  fuel_consumption: true, real_clock: true, wheel_lift: true, real_eta: true,
};
let showSpeedSign = true;

window.eurohaulBar.onOrientation((orientation) => {
  vertical = orientation === 'vertical';
  document.body.classList.toggle('vertical', vertical);
  render(lastSnapshot);
});

window.eurohaulBar.onStyle((style) => {
  if (style.accentColor) document.documentElement.style.setProperty('--accent', style.accentColor);
  if (style.accentBright) document.documentElement.style.setProperty('--accent-bright', style.accentBright);
  if (style.accentRgb) document.documentElement.style.setProperty('--accent-rgb', style.accentRgb);
  if (typeof style.opacity === 'number') document.documentElement.style.setProperty('--bar-alpha', style.opacity);
  if (style.fontSize) maxFont = style.fontSize;
  if (style.fields) fields = style.fields;
  if (typeof style.showSpeedLimitSign === 'boolean') showSpeedSign = style.showSpeedLimitSign;
  // Culoarea/mărimea fontului trebuie să se vadă IMEDIAT, nu doar la
  // următorul tick de telemetrie (care poate să nu vină deloc dacă jocul nu
  // rulează) -- reaplicăm pe ultima stare cunoscută.
  render(lastSnapshot);
});

function fmt(v, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toFixed(digits);
}

function fmtEta(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

// timeAbs vine ca minute absolute din SDK -- ne intereseaza doar ora din zi.
function fmtGameTime(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const total = Math.floor(minutes) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Semnul rotund de limitare de viteza, ca la Python: cerc alb, contur rosu
// (rosu-aprins daca depasesti limita cu peste 3 km/h), numarul limitei in
// centru. "--" cand nu stim limita.
function speedSignSvg(limitKmh, over) {
  const ring = over ? '#ff4d3d' : '#c62828';
  const hasLimit = typeof limitKmh === 'number';
  const text = hasLimit ? String(Math.round(limitKmh)) : '--';
  const fontSize = hasLimit ? 13 : 10;
  return `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#fff" stroke="${ring}" stroke-width="4"/><text x="16" y="17" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#111">${text}</text></svg>`;
}

function updateSpeedSign(s) {
  if (!showSpeedSign || !fields.speed || !s.connected || s.speedKmh === null) {
    signEl.style.display = 'none';
    return;
  }
  const over = typeof s.speedLimitKmh === 'number' && s.speedKmh - s.speedLimitKmh > 3;
  signEl.innerHTML = speedSignSvg(s.speedLimitKmh, over);
  signEl.style.display = '';
}

// Treapta de mers: negativ = marsarier ("R1"), 0 = punct mort ("N").
function fmtGear(g) {
  if (typeof g !== 'number') return '—';
  if (g === 0) return 'N';
  return g < 0 ? `R${-g}` : String(g);
}

// Frana de mana + retarder apar DOAR cat timp sunt active (ca la
// cruise control) -- presiunea aerului e mereu informativa.
function buildBrakes(s) {
  const parts = [];
  if (typeof s.airPressure === 'number') parts.push(`🌬️${s.airPressure}psi`);
  if (s.parkBrakeOn) parts.push('🅿️');
  if (typeof s.retarderLevel === 'number' && s.retarderLevel > 0) parts.push(`🌀${s.retarderLevel}`);
  return parts.join(' ');
}

// Cluster compact de lumini -- afisam DOAR iconitele celor active, ca un
// indicator de bord real (nimic aprins = campul nu apare deloc pe bara).
// Apare DOAR cat o osie liftabila e ridicata acum -- camion si remorca
// distinct, ca la Trucky (showTruckWheelLiftIndicator / showTrailersWheelLiftIndicator).
function buildWheelLift(s) {
  const parts = [];
  if (s.truckWheelLifted) parts.push('🔼🚚');
  if (s.trailerWheelLifted) parts.push('🔼🚛');
  return parts.join(' ');
}

function buildLights(s) {
  const parts = [];
  if (s.blinkerLeftOn) parts.push('◀️');
  if (s.blinkerRightOn) parts.push('▶️');
  if (s.lightsHazard) parts.push('⚠️');
  if (s.lightsBeacon) parts.push('🚨');
  if (s.lightsBeamHigh) parts.push('🔆');
  else if (s.lightsBeamLow) parts.push('🔅');
  return parts.join(' ');
}

// Ora exacta de sosire (ora din joc + timpul ramas), ca alternativa la
// numaratoarea "1h35m" -- utila cand vrei sa stii CAND ajungi, nu doar
// cat mai dureaza.
function fmtArrivalClock(gameTimeMinutes, etaMinutes) {
  if (typeof gameTimeMinutes !== 'number' || typeof etaMinutes !== 'number') return null;
  return fmtGameTime(gameTimeMinutes + etaMinutes);
}

// Suma e in moneda nativa a jocului (mare, "bruta") -- doar formatare cu
// separator de mii, ca la Trucky (showJobIncome arata acelasi numar brut).
// Ceasul din realitate (ora calculatorului), nu ora din joc -- independent
// de telemetrie, ca la showClock din Trucky.
function fmtRealClock() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function fmtMoney(amount, isAts) {
  if (typeof amount !== 'number') return null;
  return `${Math.round(amount).toLocaleString('ro-RO')}${isAts ? '$' : '€'}`;
}

function buildParts(s) {
  const parts = [];
  if (fields.time && s.gameTimeMinutes !== null) parts.push(`🕒 ${fmtGameTime(s.gameTimeMinutes)}`);
  if (fields.real_clock) parts.push(`⏰ ${fmtRealClock()}`);
  if (s.onTrip) {
    if (fields.route) parts.push(`📍 ${s.routeFrom || '?'} → ${s.routeTo || '?'}`);
    if (fields.km_remaining && s.kmRemaining !== null) parts.push(`🛣 ${fmt(s.kmRemaining)} km`);
    if (fields.eta && s.etaMinutes !== null) parts.push(`🕐 ${fmtEta(s.etaMinutes)}`);
    if (fields.real_eta && s.realEtaMinutes !== null) parts.push(`⏳ ${fmtEta(s.realEtaMinutes)}`);
    if (fields.arrival_clock) {
      const arrival = fmtArrivalClock(s.gameTimeMinutes, s.etaMinutes);
      if (arrival) parts.push(`🏁 ${arrival}`);
    }
    if (fields.cargo && s.cargo) parts.push(`📦 ${s.cargo}`);
    if (fields.job_income) {
      const income = fmtMoney(s.jobIncome, s.isAts);
      if (income) parts.push(`💰 ${income}`);
    }
  } else if (!parts.length) {
    parts.push('Conectat');
  }
  if (fields.speed && s.speedKmh !== null) parts.push(`⏱ ${fmt(s.speedKmh)} km/h`);
  if (fields.fuel && s.fuelPct !== null) parts.push(`⛽ ${s.fuelPct}%`);
  if (fields.fuel_range && s.fuelRangeKm !== null) parts.push(`🛢 ${fmt(s.fuelRangeKm)} km`);
  if (fields.fuel_consumption && s.fuelAvgConsumptionL100km !== null) parts.push(`📊 ${fmt(s.fuelAvgConsumptionL100km, 1)} l/100km`);
  if (fields.truck_damage && s.truckDamagePct !== null) parts.push(`🔧 ${s.truckDamagePct}%`);
  if (fields.trailer_damage && s.trailerDamagePct !== null) parts.push(`🚛 ${s.trailerDamagePct}%`);
  if (fields.cargo_damage && s.cargoDamagePct !== null) parts.push(`📉 ${s.cargoDamagePct}%`);
  if (fields.trailer_name && s.trailerName) parts.push(`🚚 ${s.trailerName}`);
  if (fields.odometer && s.odometerKm !== null) parts.push(`🧭 ${fmt(s.odometerKm)} km`);
  if (fields.rest && s.restMinutes !== null) parts.push(`😴 ${fmtEta(s.restMinutes)}`);
  if (fields.cruise_control && s.cruiseControl) parts.push('✅ CC');
  if (fields.gear_rpm && (s.gear !== null || s.rpm !== null)) {
    parts.push(`⚙️ ${fmtGear(s.gear)} · ${s.rpm !== null ? `${s.rpm} rpm` : '—'}`);
  }
  if (fields.brakes) {
    const brakes = buildBrakes(s);
    if (brakes) parts.push(brakes);
  }
  if (fields.lights) {
    const lights = buildLights(s);
    if (lights) parts.push(lights);
  }
  if (fields.wheel_lift) {
    const wl = buildWheelLift(s);
    if (wl) parts.push(wl);
  }
  return parts;
}

// Bara ramane MEREU pe un singur rand in orizontal (ca la Trucky) -- daca
// textul nu incape la fontul preferat, micsoram pana la un minim lizibil.
function fitFontHorizontal() {
  let size = maxFont;
  const floor = Math.min(MIN_FONT, size);
  textEl.style.fontSize = `${size}px`;
  while (size > floor && textEl.scrollWidth > textEl.clientWidth) {
    size -= 1;
    textEl.style.fontSize = `${size}px`;
  }
}

function applyFont() {
  // Orizontal: mereu pe un rand, se micsoreaza doar daca nu incape.
  // Vertical: fontul ales se aplica direct (coloana oricum se sparge pe
  // randuri separate, cu "\n", deci nu are nevoie de auto-micsorare).
  if (vertical) {
    textEl.style.fontSize = `${maxFont}px`;
  } else {
    fitFontHorizontal();
  }
}

function render(s) {
  lastSnapshot = s;
  dotEl.classList.toggle('connected', !!s.connected);
  updateSpeedSign(s);

  if (!s.connected) {
    textEl.textContent = 'Aștept ETS2 sau ATS…';
    applyFont();
    return;
  }

  const parts = buildParts(s);
  const sep = vertical ? '\n' : '    ·    ';
  textEl.textContent = parts.join(sep);
  applyFont();
}

window.eurohaulBar.onTelemetryUpdate(render);
window.eurohaulBar.getTelemetrySnapshot().then(render);
