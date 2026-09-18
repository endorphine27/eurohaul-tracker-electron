const { Client } = require('@xhayper/discord-rpc');

// Acelasi Client ID folosit si in versiunea Python -- asset-urile
// (eurohaul_logo, ets2_icon, ats_icon) sunt deja incarcate in Discord
// Developer Portal pentru aceasta aplicatie, nu mai trebuie reincarcate.
const CLIENT_ID = '1379060472938102838';
const UPDATE_INTERVAL_MS = 15000;

function buildActivity(snapshot) {
  const truckName = [snapshot.truckBrand, snapshot.truckModel].filter(Boolean).join(' ') || 'Camion necunoscut';
  const speed = snapshot.speedKmh !== null && snapshot.speedKmh !== undefined ? Math.round(snapshot.speedKmh) : 0;
  const state = snapshot.onTrip
    ? `${snapshot.routeFrom || '?'} → ${snapshot.routeTo || '?'}`
    : 'Cursă liberă';

  return {
    details: `${truckName} — ${speed} km/h`,
    state,
    largeImageKey: 'eurohaul_logo',
    largeImageText: 'EuroHaul VTC',
    smallImageKey: snapshot.isAts ? 'ats_icon' : 'ets2_icon',
    smallImageText: snapshot.isAts ? 'American Truck Simulator' : 'Euro Truck Simulator 2',
    buttons: [{ label: 'Vizitează EuroHaul', url: 'https://www.eurohaul.eu' }],
    instance: false,
  };
}

// Porneste clientul Discord RPC si il tine actualizat la fiecare 15s cu
// telemetria curenta. Discord nu are erori vizibile daca ceva nu merge, deci
// logam explicit fiecare pas (conectare, reconectare, esec) ca sa putem
// depana de la distanta daca utilizatorul raporteaza "nu apare pe Discord".
function startDiscordRpc(getSnapshot) {
  const client = new Client({ clientId: CLIENT_ID, transport: 'ipc' });
  let ready = false;

  client.on('ready', () => {
    ready = true;
    console.log('[discord] conectat la Discord, RPC activ');
  });

  client.on('disconnected', () => {
    ready = false;
    console.log('[discord] deconectat de la Discord');
  });

  function attemptLogin() {
    client.login().catch((err) => {
      // Cel mai des: Discord nu ruleaza deloc pe calculator -- normal, nu
      // tratam ca eroare grava, doar informam si reincercam mai tarziu.
      console.log('[discord] nu m-am putut conecta (Discord nu ruleaza?):', err.message);
    });
  }
  attemptLogin();

  const retryTimer = setInterval(() => {
    if (!ready) attemptLogin();
  }, 30000);

  const updateTimer = setInterval(() => {
    if (!ready) return;
    const snapshot = getSnapshot();
    if (!snapshot.connected) return;
    client.user?.setActivity(buildActivity(snapshot)).catch((err) => {
      console.log('[discord] eroare la actualizarea activitatii:', err.message);
    });
  }, UPDATE_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(updateTimer);
      clearInterval(retryTimer);
      client.destroy().catch(() => {});
    },
  };
}

module.exports = { startDiscordRpc, buildActivity };
