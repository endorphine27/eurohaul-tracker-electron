document.getElementById('btn-minimize').addEventListener('click', () => {
  window.eurohaul.minimizeWindow();
});
document.getElementById('btn-close').addEventListener('click', () => {
  window.eurohaul.closeWindow();
});

window.eurohaul.getOverspeedSoundPath().then((soundPath) => {
  const audio = document.getElementById('alert-sound');
  if (audio) audio.src = soundPath;
});

window.eurohaul.onPlayOverspeedSound(() => {
  const audio = document.getElementById('alert-sound');
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => {
    // fisierul de sunet lipseste inca (userul il adauga separat in sounds/)
    // -- nu tratam asta ca eroare, doar nu se aude nimic.
  });
});

// Comutatorul "Bară info" din Acasă -- pornea/oprea vizual, dar nu era
// conectat la nimic (bug real: click pe el nu facea absolut nimic).
const barToggle = document.getElementById('toggle-bar');
window.eurohaul.getSettings().then(({ values }) => {
  barToggle.checked = !!values.bar_visible;
});
barToggle.addEventListener('change', () => {
  window.eurohaul.setSetting('bar_visible', barToggle.checked);
});
window.eurohaul.onBarVisibilityChanged((visible) => {
  barToggle.checked = visible;
});

const railButtons = document.querySelectorAll('.rail-btn');
const pages = document.querySelectorAll('.page');

function showPage(key) {
  railButtons.forEach((b) => b.classList.toggle('active', b.dataset.page === key));
  pages.forEach((p) => p.classList.toggle('active', p.dataset.page === key));
}

railButtons.forEach((btn) => {
  btn.addEventListener('click', () => showPage(btn.dataset.page));
});

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function fmt(v, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toFixed(digits);
}

function fmtThousands(v) {
  const n = Math.round(Number(v) || 0);
  return n.toLocaleString('ro-RO').replace(/,/g, '.');
}

function fmtEta(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

function stars(rating) {
  const r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

function initials(name) {
  if (!name) return '–';
  const parts = String(name).trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '–';
}

// ---------------------------------------------------------------------
// Stare locala (ultimele instantanee primite) -- unele pagini au nevoie
// de AMBELE surse simultan (ex. Camion: camionul atribuit vine din profil,
// dar avertismentul de nepotrivire compara cu ce conduci ACUM, din telemetrie).
// ---------------------------------------------------------------------
let lastTelemetry = { connected: false };
let lastProfile = { ok: false };

function updateStatusPill(connected) {
  const pill = document.getElementById('status-pill');
  const text = document.getElementById('status-text');
  if (!pill || !text) return;
  pill.classList.toggle('offline', !connected);
  text.textContent = connected ? 'live' : 'offline';
}

function renderHome() {
  const s = lastTelemetry;
  const pf = lastProfile;
  const disconnectedCard = document.getElementById('disconnected-card');
  const tripCard = document.getElementById('trip-card');
  if (!s.connected || !s.onTrip) {
    if (disconnectedCard) disconnectedCard.style.display = '';
    if (tripCard) tripCard.style.display = 'none';
    setText('disconnected-text', s.connected
      ? 'Conectat — fără cursă activă.'
      : 'Aștept ETS2 sau ATS — deschide jocul dacă nu e deja pornit.');
  } else {
    if (disconnectedCard) disconnectedCard.style.display = 'none';
    if (tripCard) tripCard.style.display = '';

    const truckName = [s.truckBrand, s.truckModel].filter(Boolean).join(' ') || '—';
    setText('truck-name', truckName);
    setText('trip-speed', `${fmt(s.speedKmh)} km/h`);
    setText('route-from', s.routeFrom || '—');
    setText('route-to', s.routeTo || '—');
    setText('trip-eta', fmtEta(s.etaMinutes));
    setText('trip-km', fmt(s.kmRemaining));
    setText('trip-fuel', s.fuelPct !== null ? `${s.fuelPct}%` : '—');

    const progressFill = document.getElementById('trip-progress');
    if (progressFill) {
      const pct = s.progress !== null ? Math.round(s.progress * 100) : 0;
      progressFill.style.width = `${pct}%`;
    }
  }

  if (pf.ok) {
    setText('stat-trips', String(pf.trips ?? 0));
    setText('stat-km', fmtThousands(pf.km_total));
    setText('stat-earnings', `${fmtThousands(pf.earnings)} €`);
  }
}

function renderProfilePill() {
  const pf = lastProfile;
  if (!pf.ok) return;
  setText('profile-name', pf.display_name || '—');
  const avatarEl = document.getElementById('avatar');
  if (avatarEl) {
    if (pf.avatar_url) {
      avatarEl.innerHTML = `<img src="${pf.avatar_url}" alt="" />`;
    } else {
      avatarEl.textContent = initials(pf.display_name);
    }
  }
  const rankBadge = document.getElementById('rank-badge');
  if (rankBadge) rankBadge.textContent = (pf.rank || '').toUpperCase();
  setText('profile-stars', stars(pf.rating));
}

function renderProfil() {
  const pf = lastProfile;
  if (!pf.ok) return;

  const fc = pf.fines_count || 0;
  setText('fines-summary', fc
    ? `⚠ ${fc} amenzi · ${fmtThousands(pf.fines_total)} € total · ${fmtThousands(pf.km_week)} km în ultima săptămână`
    : `fără amenzi · ${fmtThousands(pf.km_week)} km în ultima săptămână`);
  const finesEl = document.getElementById('fines-summary');
  if (finesEl) finesEl.style.color = fc ? 'var(--danger)' : 'var(--muted)';

  const rankBar = document.getElementById('rank-progress');
  if (rankBar) rankBar.style.width = `${Math.round((pf.rank_pct || 0) * 100)}%`;
  setText('rank-next-label', pf.rank_next
    ? `încă ${fmtThousands(pf.km_to_next)} km → ${pf.rank_next}`
    : 'rang maxim atins');

  const warnBox = document.getElementById('profil-warn-box');
  const warnings = pf.warnings || [];
  if (warnings.length) {
    const head = `⚠ ${warnings.length} avertisment${warnings.length !== 1 ? 'e' : ''} de la admin`;
    const body = warnings.slice(0, 3).map((w) => `•  ${w.reason || ''}  —  ${w.by || ''} (${w.date || ''})`).join('\n');
    setText('profil-warn-text', `${head}\n${body}`);
    document.getElementById('profil-warn-text').style.whiteSpace = 'pre-line';
    warnBox.style.display = '';
  } else {
    warnBox.style.display = 'none';
  }

  const pay = pf.pay || {};
  const payCard = document.getElementById('pay-card');
  const payRows = document.getElementById('pay-rows');
  if (pay && Object.keys(pay).length) {
    payCard.style.display = '';
    payRows.innerHTML = '';
    const rows = [
      ['Tarif km', pay.km_pay, false],
      ['Diurnă', pay.per_diem, false],
      pay.salary_base ? ['Salariu bază', pay.salary_base, false] : null,
      pay.contract_bonus ? ['Bonus contracte', pay.contract_bonus, false] : null,
      pay.fines ? ['Amenzi', pay.fines, true] : null,
      pay.damage ? ['Daune / ocolire', pay.damage, true] : null,
      pay.tuning ? ['Tuning cumpărat', pay.tuning, true] : null,
      pay.contributions ? ['Luat de companie', pay.contributions, true] : null,
    ].filter(Boolean);
    for (const [label, val, neg] of rows) {
      const row = document.createElement('div');
      row.className = 'pay-row';
      row.innerHTML = `<span>${label}</span><span class="val${neg ? ' danger' : ''}">${neg ? '−' : ''}${fmtThousands(Math.abs(val || 0))} €</span>`;
      payRows.appendChild(row);
    }
    const net = document.createElement('div');
    net.className = 'pay-row bold';
    net.innerHTML = `<span>Net</span><span class="val bold">${fmtThousands(pay.net || 0)} €</span>`;
    payRows.appendChild(net);
  } else {
    payCard.style.display = 'none';
  }

  const fb = pf.fine_breakdown || [];
  const fbCard = document.getElementById('fine-breakdown-card');
  const fbRows = document.getElementById('fine-breakdown-rows');
  if (fb.length) {
    fbCard.style.display = '';
    fbRows.innerHTML = '';
    for (const f of fb) {
      const row = document.createElement('div');
      row.className = 'fine-row';
      row.innerHTML = `<span>${f.label || '?'} ×${f.n || 0}</span><span class="val danger">−${fmtThousands(f.total || 0)} €</span>`;
      fbRows.appendChild(row);
    }
  } else {
    fbCard.style.display = 'none';
  }
}

function renderCamion() {
  const pf = lastProfile;
  const s = lastTelemetry;
  const disconnected = document.getElementById('camion-disconnected');
  const card = document.getElementById('camion-card');
  const mismatchBox = document.getElementById('camion-mismatch');

  const truck = pf.ok ? pf.truck : null;
  if (!truck) {
    disconnected.style.display = '';
    card.style.display = 'none';
    mismatchBox.style.display = 'none';
    return;
  }
  disconnected.style.display = 'none';
  card.style.display = '';

  setText('camion-name', `${truck.brand || ''} ${truck.model || ''}`.trim() || '—');
  setText('camion-plate', truck.plate || 'fără număr');

  const wearFields = [
    ['engine', truck.wear_engine],
    ['transmission', truck.wear_transmission],
    ['cabin', truck.wear_cabin],
    ['chassis', truck.wear_chassis],
    ['wheels', truck.wear_wheels],
  ];
  for (const [key, value] of wearFields) {
    const pct = Number(value) || 0;
    setText(`wear-${key}-pct`, `${pct.toFixed(0)}%`);
    const bar = document.getElementById(`wear-${key}-bar`);
    if (bar) {
      bar.style.width = `${pct}%`;
      bar.style.background = pct >= 15 ? 'var(--danger)' : pct >= 5 ? 'var(--gold-br)' : 'var(--ok)';
    }
  }

  const liveBrand = (s.truckBrand || '').toLowerCase();
  const wantBrand = (truck.brand || '').toLowerCase();
  if (s.connected && s.onTrip && liveBrand && wantBrand && !liveBrand.includes(wantBrand) && !wantBrand.includes(liveBrand)) {
    setText('camion-mismatch-text', `⚠ Conduci ${s.truckBrand} — camionul atribuit e ${truck.brand}`);
    mismatchBox.style.display = '';
  } else {
    mismatchBox.style.display = 'none';
  }
}

function renderCurse() {
  const pf = lastProfile;
  const list = document.getElementById('trips-list');
  const empty = document.getElementById('trips-empty');
  if (!pf.ok) return;
  const recent = pf.recent || [];
  list.innerHTML = '';
  empty.style.display = recent.length ? 'none' : '';
  for (const d of recent) {
    const cancelled = d.status === 'cancelled';
    const bits = [d.game === 'ats' ? 'ATS' : 'ETS2'];
    if (d.km !== undefined && d.km !== null) bits.push(`${Math.round(d.km)} km`);
    if (d.cargo) bits.push(String(d.cargo));
    if (!cancelled) bits.push(d.on_time !== false ? 'la timp ✓' : 'întârziată ⚠');
    if (d.fine) bits.push(`amendă −${fmtThousands(d.fine)} €`);
    if (d.mismatch) bits.push('alt camion ⚠');
    if (d.date) bits.push(String(d.date));

    const card = document.createElement('div');
    card.className = 'list-card';
    const moneyText = cancelled ? 'anulată' : (d.income !== undefined && d.income !== null ? `+${fmtThousands(d.income)} €` : '—');
    card.innerHTML = `
      <div class="row-top">
        <span class="row-title">${d.route || '?'}</span>
        <span class="row-money${cancelled ? ' danger' : ''}">${moneyText}</span>
      </div>
      <div class="row-meta">${bits.join('    ·    ')}</div>
    `;
    list.appendChild(card);
  }
}

let currentContractGame = 'ets2';

function renderContracts() {
  const pf = lastProfile;
  if (!pf.ok) return;
  const ct = pf.contracts || {};
  const mine = ct.mine || [];
  const openR = ct.open || [];
  const byGame = (rows, game) => rows.filter((r) => (game === 'ats' ? r.game === 'ats' : r.game !== 'ats'));

  setText('ct-count-ets2', String(byGame(openR, 'ets2').length));
  setText('ct-count-ats', String(byGame(openR, 'ats').length));

  const mineList = document.getElementById('ct-mine-list');
  const openList = document.getElementById('ct-open-list');
  mineList.innerHTML = '';
  openList.innerHTML = '';

  function contractCard(r, actionName) {
    const hl = r.hours_left;
    let dl = '';
    if (hl !== undefined && hl !== null) {
      dl = hl < 48 ? `${hl}h rămase` : `${Math.floor(hl / 24)}z ${hl % 24}h rămase`;
    }
    const bits = [];
    if (r.km) bits.push(`${Math.round(r.km)} km`);
    if (r.cargo) bits.push(String(r.cargo));
    if (r.driver_bonus !== undefined && r.driver_bonus !== null) bits.push(`premium client · tu iei ${fmtThousands(r.driver_bonus)} €`);
    if (dl) bits.push(dl);

    const card = document.createElement('div');
    card.className = 'list-card';
    card.innerHTML = `
      <div class="row-top">
        <span class="row-title">${r.route || '?'}</span>
        <span class="row-money">${fmtThousands(r.bonus)} €</span>
      </div>
      <div class="row-meta">${bits.join('    ·    ')}</div>
      <div class="row-actions"></div>
    `;
    const btn = document.createElement('button');
    btn.className = 'btn-secondary';
    btn.textContent = actionName === 'claim' ? 'Preia' : 'Renunță';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await window.eurohaul.contractAction(r.id, actionName);
    });
    card.querySelector('.row-actions').appendChild(btn);
    return card;
  }

  const mRows = byGame(mine, currentContractGame);
  const oRows = byGame(openR, currentContractGame);
  if (!mRows.length) {
    mineList.innerHTML = '<div class="muted-row">Niciun contract preluat.</div>';
  } else {
    for (const r of mRows) mineList.appendChild(contractCard(r, 'release'));
  }
  if (!oRows.length) {
    openList.innerHTML = '<div class="muted-row">Niciun contract disponibil acum.</div>';
  } else {
    for (const r of oRows) openList.appendChild(contractCard(r, 'claim'));
  }
}

document.getElementById('ct-tab-ets2').addEventListener('click', () => {
  currentContractGame = 'ets2';
  document.getElementById('ct-tab-ets2').classList.add('active');
  document.getElementById('ct-tab-ats').classList.remove('active');
  renderContracts();
});
document.getElementById('ct-tab-ats').addEventListener('click', () => {
  currentContractGame = 'ats';
  document.getElementById('ct-tab-ats').classList.add('active');
  document.getElementById('ct-tab-ets2').classList.remove('active');
  renderContracts();
});
document.getElementById('ct-open-site').addEventListener('click', () => {
  window.open('https://eurohaul.eu/contracts', '_blank');
});

function renderLeaderboard() {
  const pf = lastProfile;
  if (!pf.ok) return;
  const lb = pf.leaderboard || [];
  const list = document.getElementById('leaderboard-list');
  list.innerHTML = '';
  if (!lb.length) {
    list.innerHTML = '<div class="muted-row">Niciun șofer încă.</div>';
  } else {
    for (const d of lb) {
      const row = document.createElement('div');
      row.className = `lb-row${d.me ? ' me' : ''}`;
      row.innerHTML = `
        <span class="lb-pos">${d.pos}.</span>
        <span class="lb-name">${d.name || '?'}</span>
        <span class="lb-trips">${d.trips} curse</span>
        <span class="lb-km">${fmtThousands(d.km)} km</span>
      `;
      list.appendChild(row);
    }
  }
  setText('leaderboard-mypos', (pf.my_pos && pf.my_pos > 10) ? `Ești pe locul ${pf.my_pos}.` : '');
}

function renderAllProfile() {
  renderProfilePill();
  renderHome();
  renderProfil();
  renderCamion();
  renderCurse();
  renderContracts();
  renderLeaderboard();
}

function renderAllTelemetry() {
  updateStatusPill(lastTelemetry.connected);
  renderHome();
  renderCamion();
}

window.eurohaul.onTelemetryUpdate((snapshot) => {
  lastTelemetry = snapshot;
  renderAllTelemetry();
});
window.eurohaul.getTelemetrySnapshot().then((snapshot) => {
  lastTelemetry = snapshot;
  renderAllTelemetry();
});

window.eurohaul.onProfileUpdate((snapshot) => {
  lastProfile = snapshot;
  renderAllProfile();
});
window.eurohaul.getProfileSnapshot().then((snapshot) => {
  lastProfile = snapshot;
  renderAllProfile();
});

window.eurohaul.onNavigate(showPage);

// ---------------------------------------------------------------------
// Autentificare
// ---------------------------------------------------------------------
function showLoginScreen(show) {
  document.getElementById('login-screen').classList.toggle('active', show);
  document.getElementById('profile-row').style.display = show ? 'none' : '';
  document.getElementById('shell').style.display = show ? 'none' : '';
}

async function checkAuth() {
  const status = await window.eurohaul.getAuthStatus();
  showLoginScreen(!status.loggedIn);
  if (status.loggedIn) {
    window.eurohaul.refreshProfile();
  }
  return status.loggedIn;
}

document.getElementById('login-submit').addEventListener('click', async () => {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  if (!username || !password) {
    errorEl.textContent = 'Introdu utilizatorul și parola.';
    return;
  }
  const btn = document.getElementById('login-submit');
  btn.disabled = true;
  btn.textContent = 'Se conectează…';
  const result = await window.eurohaul.login(username, password);
  btn.disabled = false;
  btn.textContent = 'Autentificare';
  if (result.ok) {
    showLoginScreen(false);
    window.eurohaul.refreshProfile();
  } else {
    errorEl.textContent = result.error || 'Autentificare eșuată.';
  }
});

document.getElementById('login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('login-submit').click();
});

document.getElementById('logout-btn').addEventListener('click', () => {
  window.eurohaul.logout();
  showLoginScreen(true);
});

window.eurohaul.onLoggedOut(() => showLoginScreen(true));

checkAuth();

// ---------------------------------------------------------------------
// Setari (culoare/pozitie/marime font bara)
// ---------------------------------------------------------------------
async function initSettings() {
  const { values, accentPresets, positions, shortcuts, barFields, soundFiles } = await window.eurohaul.getSettings();

  const swatchRow = document.getElementById('accent-swatches');
  const accentHint = document.getElementById('accent-hint');

  function paintAccentHint(key) {
    accentHint.textContent = `${accentPresets[key].label} — colorează tot fundalul benzii, nu fereastra asta.`;
  }

  function renderSwatches(activeKey) {
    swatchRow.innerHTML = '';
    for (const [key, preset] of Object.entries(accentPresets)) {
      const btn = document.createElement('button');
      btn.className = `swatch${key === activeKey ? ' active' : ''}`;
      btn.dataset.key = key;
      btn.style.background = preset.base;
      btn.textContent = key === activeKey ? '✓' : '';
      btn.addEventListener('click', () => {
        window.eurohaul.setSetting('bar_accent_color', key);
        renderSwatches(key);
        paintAccentHint(key);
      });
      swatchRow.appendChild(btn);
    }
  }
  renderSwatches(values.bar_accent_color);
  paintAccentHint(values.bar_accent_color);

  const posGrid = document.getElementById('position-grid');
  function renderPositions(activeKey) {
    posGrid.innerHTML = '';
    for (const pos of positions) {
      const btn = document.createElement('button');
      btn.className = `pos-btn${pos.key === activeKey ? ' active' : ''}`;
      btn.dataset.pos = pos.key;
      btn.textContent = pos.label;
      btn.addEventListener('click', () => {
        window.eurohaul.setSetting('bar_position', pos.key);
        renderPositions(pos.key);
      });
      posGrid.appendChild(btn);
    }
  }
  renderPositions(values.bar_position);

  document.getElementById('reset-position').addEventListener('click', () => {
    window.eurohaul.setSetting('bar_position', 'bottom_h');
    renderPositions('bottom_h');
  });

  const slider = document.getElementById('font-size-slider');
  const sliderValue = document.getElementById('font-size-value');
  slider.value = values.bar_font_size;
  sliderValue.textContent = `${values.bar_font_size}px`;
  slider.addEventListener('input', () => {
    sliderValue.textContent = `${slider.value}px`;
  });
  slider.addEventListener('change', () => {
    window.eurohaul.setSetting('bar_font_size', parseInt(slider.value, 10));
  });

  for (const [suffix, kind] of [['roadlimit-ets2', 'tol'], ['maxspeed-ets2', 'val'],
                                 ['roadlimit-ats', 'tol'], ['maxspeed-ats', 'val']]) {
    const key = suffix.replace('-', '_');
    const onEl = document.getElementById(`alert-${suffix}-on`);
    const numEl = document.getElementById(`alert-${suffix}-${kind}`);
    onEl.checked = !!values[`alert_${key}_on`];
    numEl.value = values[`alert_${key}_${kind}`];
    onEl.addEventListener('change', () => window.eurohaul.setSetting(`alert_${key}_on`, onEl.checked));
    numEl.addEventListener('change', () => window.eurohaul.setSetting(`alert_${key}_${kind}`, parseInt(numEl.value, 10) || 0));
  }

  // Ca la Trucky -- alegere dintr-un set de sunete existente in folderul
  // "sounds", nu un singur fisier fix (overspeed.mp3).
  const soundSelect = document.getElementById('alert-sound-select');
  soundSelect.innerHTML = soundFiles.map((f) => `<option value="${f}">${f}</option>`).join('');
  if (soundFiles.includes(values.alert_sound_file)) soundSelect.value = values.alert_sound_file;
  soundSelect.addEventListener('change', async () => {
    window.eurohaul.setSetting('alert_sound_file', soundSelect.value);
    const audio = document.getElementById('alert-sound');
    audio.src = await window.eurohaul.getOverspeedSoundPath();
  });
  document.getElementById('alert-sound-preview').addEventListener('click', () => {
    const audio = document.getElementById('alert-sound');
    audio.currentTime = 0;
    audio.play().catch(() => {});
  });

  const hotkeysToggle = document.getElementById('hotkeys-enabled');
  hotkeysToggle.checked = !!values.hotkeys_enabled;
  hotkeysToggle.addEventListener('change', () => {
    window.eurohaul.setSetting('hotkeys_enabled', hotkeysToggle.checked);
  });
  const shortcutsList = document.getElementById('shortcuts-list');
  shortcutsList.innerHTML = shortcuts.map((s) => `<div class="muted-row" style="padding:3px 0">${s.label}</div>`).join('');

  const barFieldsList = document.getElementById('bar-fields-list');
  barFieldsList.innerHTML = barFields.map((f) => `
    <div class="row-card" style="margin-bottom:8px">
      <span>${f.label}</span>
      <label class="switch"><input type="checkbox" id="bar-field-${f.key}" /><span class="switch-track"></span></label>
    </div>
  `).join('');
  for (const f of barFields) {
    const el = document.getElementById(`bar-field-${f.key}`);
    el.checked = !!values[`bar_field_${f.key}`];
    el.addEventListener('change', () => window.eurohaul.setSetting(`bar_field_${f.key}`, el.checked));
  }
}

initSettings();
