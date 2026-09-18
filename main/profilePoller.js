const { fetchProfile } = require('./api');

const REFRESH_MS = 90 * 1000; // acelasi ritm ca in versiunea anterioara

function startProfilePoller(getToken) {
  const listeners = [];
  let latest = { ok: false };
  let timer = null;

  function notify() {
    for (const cb of listeners) {
      try { cb(latest); } catch (err) { console.error('[profile] listener error', err); }
    }
  }

  async function refreshNow() {
    const token = getToken();
    if (!token) {
      latest = { ok: false };
      notify();
      return latest;
    }
    try {
      latest = await fetchProfile(token);
    } catch (err) {
      console.error('[profile] fetch error', err);
    }
    notify();
    return latest;
  }

  function start() {
    if (timer) return;
    refreshNow();
    timer = setInterval(refreshNow, REFRESH_MS);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    start,
    stop,
    refreshNow,
    getSnapshot: () => latest,
    onChange: (cb) => listeners.push(cb),
  };
}

module.exports = { startProfilePoller };
