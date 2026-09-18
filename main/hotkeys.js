const { globalShortcut } = require('electron');

// Versiunea anterioara (Python) avea 4 widget-uri separate (Viteza/Cursa/Ore/
// Rezervor) + Panou + Bara, fiecare cu propria tasta rapida (Ctrl+Alt+1..6).
// In aceasta versiune Electron nu mai exista acele widget-uri separate --
// totul e fie in fereastra principala, fie pe bara -- asa ca au ramas doar
// cele 2 taste care inca au sens:
//   Ctrl+Alt+H -> ascunde/arata tot (fereastra + bara)
//   Ctrl+Alt+B -> ascunde/arata doar bara
const SHORTCUTS = [
  { combo: 'Ctrl+Alt+H', label: 'Ctrl+Alt+H — ascunde / afișează tot' },
  { combo: 'Ctrl+Alt+B', label: 'Ctrl+Alt+B — ascunde / afișează bara' },
];

function registerHotkeys({ onToggleAll, onToggleBar }) {
  let registered = false;

  function register() {
    if (registered) return true;
    const okH = globalShortcut.register('Control+Alt+H', onToggleAll);
    const okB = globalShortcut.register('Control+Alt+B', onToggleBar);
    registered = okH && okB;
    if (!registered) {
      console.log('[hotkeys] nu s-au putut inregistra toate combinatiile (poate sunt deja folosite de alt program)');
    }
    return registered;
  }

  function unregister() {
    globalShortcut.unregister('Control+Alt+H');
    globalShortcut.unregister('Control+Alt+B');
    registered = false;
  }

  return { register, unregister, isRegistered: () => registered };
}

module.exports = { registerHotkeys, SHORTCUTS };
