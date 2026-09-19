const bar = document.getElementById('bar');
const dotEl = document.getElementById('dot');
const textEl = document.getElementById('main-text');
const signEl = document.getElementById('speed-sign');
const speedValueEl = document.getElementById('speed-value');

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
// Ordinea "de fabrica" -- folosita cand inca n-a venit stilul din Setari si
// ca rezerva pt orice camp lipsa din ordinea salvata (ex. adaugat intr-o
// versiune ulterioara). Viteza NU e aici -- are pozitie fixa langa semnul de
// limitare, nu se amesteca in restul textului (vezi updateSpeedValue).
const DEFAULT_FIELD_ORDER = [
  'time', 'real_clock', 'route', 'km_remaining', 'eta', 'real_eta', 'arrival_clock',
  'cargo', 'job_income', 'fuel', 'fuel_range', 'fuel_consumption',
  'truck_damage', 'trailer_damage', 'cargo_damage', 'trailer_name', 'odometer',
  'rest', 'cruise_control', 'gear_rpm', 'brakes', 'lights', 'wheel_lift',
];
let fieldsOrder = DEFAULT_FIELD_ORDER.slice();

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
  if (Array.isArray(style.fieldsOrder)) fieldsOrder = style.fieldsOrder;
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

// Viteza curenta, langa semnul de limitare (nu in textul care circula cu
// restul campurilor) -- pozitie fixa, ca sa le vezi pe amandoua dintr-o
// privire: cat merg / cat am voie.
function updateSpeedValue(s) {
  if (!fields.speed || !s.connected || s.speedKmh === null) {
    speedValueEl.style.display = 'none';
    return;
  }
  speedValueEl.textContent = `${fmt(s.speedKmh)} km/h`;
  speedValueEl.style.display = '';
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

// Un renderer per camp -- intoarce textul de afisat sau null daca nu se
// aplica acum. Viteza nu e aici (pozitie fixa langa semn, vezi updateSpeedValue).
const FIELD_RENDERERS = {
  time: (s) => s.gameTimeMinutes !== null ? `🕒 ${fmtGameTime(s.gameTimeMinutes)}` : null,
  real_clock: () => `⏰ ${fmtRealClock()}`,
  route: (s) => s.onTrip ? `📍 ${s.routeFrom || '?'} → ${s.routeTo || '?'}` : null,
  km_remaining: (s) => (s.onTrip && s.kmRemaining !== null) ? `🛣 ${fmt(s.kmRemaining)} km` : null,
  eta: (s) => (s.onTrip && s.etaMinutes !== null) ? `🕐 ${fmtEta(s.etaMinutes)}` : null,
  real_eta: (s) => (s.onTrip && s.realEtaMinutes !== null) ? `⏳ ${fmtEta(s.realEtaMinutes)}` : null,
  arrival_clock: (s) => {
    if (!s.onTrip) return null;
    const arrival = fmtArrivalClock(s.gameTimeMinutes, s.etaMinutes);
    return arrival ? `🏁 ${arrival}` : null;
  },
  cargo: (s) => (s.onTrip && s.cargo) ? `📦 ${s.cargo}` : null,
  job_income: (s) => {
    if (!s.onTrip) return null;
    const income = fmtMoney(s.jobIncome, s.isAts);
    return income ? `💰 ${income}` : null;
  },
  fuel: (s) => s.fuelPct !== null ? `⛽ ${s.fuelPct}%` : null,
  fuel_range: (s) => s.fuelRangeKm !== null ? `🛢 ${fmt(s.fuelRangeKm)} km` : null,
  fuel_consumption: (s) => s.fuelAvgConsumptionL100km !== null ? `📊 ${fmt(s.fuelAvgConsumptionL100km, 1)} l/100km` : null,
  truck_damage: (s) => s.truckDamagePct !== null ? `🔧 ${s.truckDamagePct}%` : null,
  trailer_damage: (s) => s.trailerDamagePct !== null ? `🚛 ${s.trailerDamagePct}%` : null,
  cargo_damage: (s) => s.cargoDamagePct !== null ? `📉 ${s.cargoDamagePct}%` : null,
  trailer_name: (s) => s.trailerName ? `🚚 ${s.trailerName}` : null,
  odometer: (s) => s.odometerKm !== null ? `🧭 ${fmt(s.odometerKm)} km` : null,
  rest: (s) => s.restMinutes !== null ? `😴 ${fmtEta(s.restMinutes)}` : null,
  cruise_control: (s) => s.cruiseControl ? '✅ CC' : null,
  gear_rpm: (s) => (s.gear !== null || s.rpm !== null)
    ? `⚙️ ${fmtGear(s.gear)} · ${s.rpm !== null ? `${s.rpm} rpm` : '—'}` : null,
  brakes: (s) => buildBrakes(s) || null,
  lights: (s) => buildLights(s) || null,
  wheel_lift: (s) => buildWheelLift(s) || null,
};

// Ordinea vine din Setari (fieldsOrder, actualizata pe masura ce activezi
// campuri) -- orice camp lipsa de-acolo (ex. adaugat intr-o versiune noua,
// inainte sa fi fost vreodata (re)activat manual) se adauga la coada, in
// ordinea "de fabrica", ca sa nu dispara pur si simplu din bara.
function buildParts(s) {
  const parts = [];
  const seen = new Set();
  const orderedKeys = fieldsOrder.concat(DEFAULT_FIELD_ORDER.filter((k) => !fieldsOrder.includes(k)));
  for (const key of orderedKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (!fields[key]) continue;
    const renderer = FIELD_RENDERERS[key];
    if (!renderer) continue;
    const text = renderer(s);
    if (text) parts.push(text);
  }
  if (!parts.length) parts.push('Conectat');
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
  updateSpeedValue(s);

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
