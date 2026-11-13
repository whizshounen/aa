// Runs inside the docked game view. Two jobs, both before any game script:
// 1. tag this page as the app's own game page — the engine refuses to drive a
//    page that does not carry the token handed to it by main.js.
// 2. pin the game's language to English — the site defaults to its authored
//    Spanish when navigator.language isn't recognized at first boot.
const { ipcRenderer } = require('electron');

// Force English: the game reads navigator.language (es* → "es", zh* → "zh-TW")
// before any of its scripts run, and persists it in
// localStorage["ro-survivors:settings"].lang. Override both, as early as
// possible, in a way game scripts cannot undo.
try {
  const EN = 'en-US';
  for (const prop of ['language', 'languages']) {
    try {
      Object.defineProperty(Navigator.prototype, prop, {
        get: prop === 'language' ? () => EN : () => [EN],
        configurable: true,
      });
    } catch {}
  }
  const KEY = 'ro-survivors:settings';
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  if (s.lang !== 'en') {
    s.lang = 'en';
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  }
} catch (e) {
  console.error('game-preload: language pin failed', e);
}

// Frame cap for the docked game pane: the game renders every animation frame
// (60 fps) even when it just sits in the town, which costs half a core for
// nothing. 30 fps looks the same and the simulation is time-based, so the
// game speed does not change.
try {
  const cap = 30;
  const minGap = 1000 / cap;
  let last = 0;
  window.requestAnimationFrame = (cb) => {
    const wait = Math.max(0, minGap - (performance.now() - last));
    return setTimeout(() => { last = performance.now(); cb(performance.now()); }, wait);
  };
  const origCancel = window.cancelAnimationFrame.bind(window);
  window.cancelAnimationFrame = (id) => { try { origCancel(id); } catch {} clearTimeout(id); };
} catch (e) {
  console.error('game-preload: frame cap failed', e);
}

try {
  const ctx = ipcRenderer.sendSync('ctx:sync');
  if (ctx && ctx.botToken) {
    localStorage.setItem('__ro_bot_token__', String(ctx.botToken));
    localStorage.setItem('__ro_bot_profile__', 'app');
  }
} catch (e) {
  console.error('game-preload: could not tag the page', e);
}
