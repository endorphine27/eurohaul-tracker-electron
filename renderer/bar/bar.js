const bar = document.getElementById('bar');
const dotEl = document.getElementById('dot');
const textEl = document.getElementById('main-text');
const gearEl = document.getElementById('gear');

gearEl.addEventListener('click', () => window.eurohaulBar.openSettings());

let vertical = false;
let maxFont = 13;
let lastSnapshot = { connected: false };
const MIN_FONT = 9;

window.eurohaulBar.onOrientation((orientation) => {
  vertical = orientation === 'vertical';
  document.body.classList.toggle('vertical', vertical);
  render(lastSnapshot);
});

window.eurohaulBar.onStyle((style) => {
  if (style.accentColor) document.documentElement.style.setProperty('--accent', style.accentColor);
  if (style.accentBright) document.documentElement.style.setProperty('--accent-bright', style.accentBright);
  if (style.fontSize) maxFont = style.fontSize;
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

function buildParts(s) {
  const parts = [];
  if (s.onTrip) {
    parts.push(`📍 ${s.routeFrom || '?'} → ${s.routeTo || '?'}`);
    if (s.kmRemaining !== null) parts.push(`🛣 ${fmt(s.kmRemaining)} km`);
    if (s.etaMinutes !== null) parts.push(`🕐 ${fmtEta(s.etaMinutes)}`);
    if (s.cargo) parts.push(`📦 ${s.cargo}`);
  } else {
    parts.push('Conectat');
  }
  if (s.speedKmh !== null) parts.push(`⏱ ${fmt(s.speedKmh)} km/h`);
  if (s.fuelPct !== null) parts.push(`⛽ ${s.fuelPct}%`);
  if (s.odometerKm !== null) parts.push(`🧭 ${fmt(s.odometerKm)} km`);
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
