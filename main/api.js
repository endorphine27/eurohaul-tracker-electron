const API_BASE = 'https://eurohaul.eu/api';

async function postJson(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Api-Token'] = token;
  try {
    const res = await fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch (err) {
    return { status: 0, data: { ok: false, error: `Eroare rețea: ${err.message}` } };
  }
}

async function getJson(path, token) {
  const headers = {};
  if (token) headers['X-Api-Token'] = token;
  try {
    const res = await fetch(`${API_BASE}/${path}`, { headers, signal: AbortSignal.timeout(10000) });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch (err) {
    return { status: 0, data: { ok: false, error: `Eroare rețea: ${err.message}` } };
  }
}

async function login(username, password) {
  const { status, data } = await postJson('token.php', { username, password });
  if (status === 200 && data.ok) {
    return { ok: true, token: data.api_token, displayName: data.display_name };
  }
  return { ok: false, error: data.error || `Autentificare eșuată (${status}).` };
}

async function fetchProfile(token) {
  if (!token) return { ok: false };
  const { data } = await getJson('profile.php', token);
  return data;
}

async function fetchWhoami(token) {
  if (!token) return { ok: false };
  const { data } = await getJson('whoami.php', token);
  return data;
}

async function contractAction(token, contractId, action) {
  const { data } = await postJson('contract_claim.php', { contract_id: Number(contractId), action }, token);
  return data;
}

// ---------- Raportare curse (log_trip / log_sample / push_live_status /
// log_fine) -- vezi main/tripReporter.js pentru starea care decide CAND se
// cheama fiecare dintre astea. Aici doar transmitem, fara logica. ----------

async function startTrip(token, fields, odometerKm, fuelLiters) {
  const { data } = await postJson('log_trip.php', {
    action: 'start', fields, odometer_km: odometerKm, fuel_liters: fuelLiters,
  }, token);
  return data;
}

async function endTrip(token, tripId, payload) {
  const { data } = await postJson('log_trip.php', { action: 'end', trip_id: tripId, ...payload }, token);
  return data;
}

async function logSample(token, tripId, samples) {
  const { data } = await postJson('log_sample.php', { trip_id: tripId, samples }, token);
  return data;
}

async function pushLiveStatus(token, payload) {
  const { data } = await postJson('push_live_status.php', payload, token);
  return data;
}

async function logFine(token, tripId, fineAmount, reason, eventId) {
  const { data } = await postJson('log_fine.php', {
    trip_id: tripId, fine_amount: fineAmount, reason, event_id: eventId,
  }, token);
  return data;
}

module.exports = {
  login, fetchProfile, fetchWhoami, contractAction, API_BASE,
  startTrip, endTrip, logSample, pushLiveStatus, logFine,
};
