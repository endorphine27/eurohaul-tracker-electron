// Alerte sonore de viteza, locale (nu tin de riscul de amenda de pe server) --
// 2 tipuri x 2 jocuri, exact ca la Trucky:
//  - "roadlimit": suna cand depasesti limita DRUMULUI cu mai mult decat
//    toleranta aleasa (0 = suna imediat ce depasesti).
//  - "maxspeed": suna cand depasesti un prag ABSOLUT de viteza, indiferent
//    de limita drumului (util pe autostrazi fara limita afisata).
const COOLDOWN_MS = 6000;

function checkOverspeed(snapshot, settings) {
  if (!snapshot.connected || snapshot.speedKmh === null || snapshot.speedKmh === undefined) {
    return false;
  }
  const suffix = snapshot.isAts ? 'ats' : 'ets2';
  const speed = snapshot.speedKmh;

  const roadOn = settings[`alert_roadlimit_${suffix}_on`];
  const roadTol = Number(settings[`alert_roadlimit_${suffix}_tol`] ?? 0);
  if (roadOn && snapshot.speedLimitKmh !== null && snapshot.speedLimitKmh !== undefined) {
    if (speed > snapshot.speedLimitKmh + roadTol) return true;
  }

  const maxOn = settings[`alert_maxspeed_${suffix}_on`];
  const maxVal = Number(settings[`alert_maxspeed_${suffix}_val`] ?? (snapshot.isAts ? 120 : 90));
  if (maxOn && speed > maxVal) return true;

  return false;
}

function createSpeedAlertWatcher(getSettings, onAlert) {
  let lastAlertAt = 0;

  function handleTelemetry(snapshot) {
    const settings = getSettings();
    if (!checkOverspeed(snapshot, settings)) return;
    const now = Date.now();
    if (now - lastAlertAt < COOLDOWN_MS) return;
    lastAlertAt = now;
    onAlert();
  }

  return { handleTelemetry };
}

module.exports = { createSpeedAlertWatcher, checkOverspeed, COOLDOWN_MS };
