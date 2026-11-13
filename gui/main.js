// RO Survivors bot — app shell (Electron).
//
// One window, two halves:
//   left  — the real game, docked into this window as a WebContentsView. It is
//           a normal CDP "page" target, so the engine drives exactly this view
//           (no second browser, no pop-up window). It uses its own partition,
//           so it never touches the user's normal browser profile.
//   right — the control panel (index.html in the window's own webContents),
//           laid out to mirror the CLI's flags one-for-one.
//
// The game's main-*.js is answered at its own URL with the patched bundle
// (rea/patched/main-*.js) so the engine reads exact game state read-only.
// Same-origin is required: a custom scheme + redirect is blocked by CORS and
// the game never boots (the splash just sits at "Loading…").
const { app, BrowserWindow, WebContentsView, ipcMain, session, net, shell, safeStorage, Menu } = require('electron');

// A stray rejection (e.g. a Playwright dialog that vanished) must never close
// the app window — log it and carry on.
process.on('unhandledRejection', (err) => { try { console.error('[app] unhandled rejection:', err && err.message || err); } catch {} });
process.on('uncaughtException', (err) => { try { console.error('[app] uncaught exception:', err && err.message || err); } catch {} });
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GAME_URL = 'https://ro-survivors.com/';
// Two dedicated profiles so a guest run can never clear an account login:
// "account" keeps the session you sign into in the game window, "guest" is a
// separate empty profile that only the guest mode ever touches.
const PARTITIONS = { account: 'persist:ropart', guest: 'persist:ro-guest' };
let currentProfile = 'account';
const oldViews = [];   // game views kept alive (destroying them crashes Electron)
const PANEL_WIDTH = 430;
const PATCHED_DIR = path.join(__dirname, '..', 'rea', 'patched');
const ENGINE = path.join(__dirname, 'engine.js');
const CFG_PATH = path.join(__dirname, 'config.json');
const BUNDLE_URL_RE = /^https:\/\/ro-survivors\.com\/build\/main-[A-Za-z0-9_-]+\.js/;

// Random loopback port per launch: never a well-known number, so the engine can
// never attach to some other tool's browser. The token below is required on
// the page the engine drives (engine.js refuses an untagged page).
const CDP_PORT = 20000 + Math.floor(Math.random() * 20000);
const BOT_TOKEN = crypto.randomBytes(16).toString('hex');

// The game picks its language from navigator.language; pin it so the panel and
// the game always agree (Spanish is only the HTML's authored default).
app.commandLine.appendSwitch('lang', 'en-US');
// Linux without a keyring daemon (gnome-keyring / kwallet) reports safeStorage
// as unavailable, which would make "save my account" impossible. The basic
// store keeps the value on disk in an obfuscated form; the panel reports which
// backend is in use so this is never mistaken for strong encryption.
if (process.platform === 'linux') app.commandLine.appendSwitch('password-store', 'basic');
app.commandLine.appendSwitch('remote-debugging-port', String(CDP_PORT));
app.commandLine.appendSwitch('user-data-dir', path.join(app.getPath('userData'), 'cdp-profile'));

// One instance only: a second launch would race for the same CDP profile and
// config. Focus the existing window instead.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
app.on('second-instance', () => {
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
});

let win = null;         // panel window (its webContents is the UI)
let gameView = null;    // docked game
let driver = null;      // connection to the engine daemon (a socket)
let driverBuf = '';
let driverStarting = false;
let engineReady = false;
let pendingCmd = null;  // { cmd, cfg } — sent as soon as the engine says ready
let runActive = false;  // true between batch-start and batch-done/engine-exit
const bundleSessions = new Set();

function patchedBundlePath() {
  // The patch tool (rea/patch.py) writes patched/bundle.json pointing at the
  // bundle it built for the CURRENT live build. That file is the authority:
  // the patched folder also holds older builds, and picking the wrong one
  // would serve a dead game bundle.
  const botDir = process.env.RO_BOT_DIR ||
    path.join(os.homedir(), '.local', 'share', 'ro-survivors-bot', 'rea', 'patched');
  for (const dir of [botDir, PATCHED_DIR]) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'bundle.json'), 'utf8'));
      if (manifest && manifest.ok && manifest.name) {
        const p = path.join(dir, manifest.name);
        if (fs.existsSync(p)) return p;
      }
    } catch {}
    try {
      const f = fs.readdirSync(dir).find(n => /^main-[A-Za-z0-9_-]+\.js$/.test(n));
      if (f) return path.join(dir, f);
    } catch {}
  }
  return null;
}

// Substitute the game bundle at the protocol layer, once per session.
function servePatchedBundle(partition) {
  if (bundleSessions.has(partition)) return;
  bundleSessions.add(partition);
  session.fromPartition(partition).protocol.handle('https', async request => {
    const p = patchedBundlePath();
    if (p && BUNDLE_URL_RE.test(request.url)) {
      return new Response(fs.readFileSync(p), { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
    }
    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  });
}

function layout() {
  if (!win || win.isDestroyed() || !gameView) return;
  const [w, h] = win.getContentSize();
  gameView.setBounds({ x: 0, y: 0, width: Math.max(360, w - PANEL_WIDTH), height: h });
}

// ---------- engine link -------------------------------------------------
// The engine (the "brain" that runs the bots) is a detached daemon: it keeps
// farming even if this window crashes or is closed, and a new window simply
// reconnects to it. Every event passes through here so main can track whether
// a run is live (that guards profile switches and reloads, which would kill
// the page the bot is driving).
function forward(ev) {
  if (ev.type === 'batch-start') runActive = true;
  if (ev.type === 'batch-done' || ev.type === 'engine-exit' || ev.type === 'fatal') runActive = false;
  if (ev.type === 'ready') { engineReady = true; flushPending(); }
  if (win && !win.isDestroyed()) win.webContents.send('bot-event', ev);
}

const ENGINE_INFO = path.join(__dirname, 'engine.json');
function engineDaemonAlive(info) {
  if (!info || !info.pid) return false;
  try { process.kill(info.pid, 0); return true; } catch { return false; }
}
function readEngineInfo() {
  try { return JSON.parse(fs.readFileSync(ENGINE_INFO, 'utf8')); } catch { return null; }
}

// Attach to the running daemon, starting one if needed.
function ensureDriver() {
  if (driver) return driver;
  if (driverStarting) return null;
  driverStarting = true;
  engineReady = false;
  let info = readEngineInfo();
  if (!engineDaemonAlive(info)) {
    // Start the brain detached so it outlives this window. Its log goes to a
    // file: the daemon has no terminal once the window is gone.
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' };
    try {
      fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
      const logFd = fs.openSync(path.join(__dirname, 'logs', 'engine.log'), 'a');
      const child = spawn(process.execPath, [ENGINE, CFG_PATH, '--daemon'], { env, cwd: __dirname, detached: true, stdio: ['ignore', logFd, logFd] });
      child.unref();
    } catch (e) {
      driverStarting = false;
      forward({ type: 'fatal', msg: 'could not start the engine: ' + (e && e.message || e) });
      return null;
    }
    // Wait for it to write its port.
    const deadline = Date.now() + 15000;
    const tryConnect = () => {
      info = readEngineInfo();
      if (engineDaemonAlive(info) && info.port) { connectDriver(info.port); return; }
      if (Date.now() > deadline) {
        driverStarting = false;
        forward({ type: 'fatal', msg: 'the engine daemon did not come up' });
        return;
      }
      setTimeout(tryConnect, 250);
    };
    tryConnect();
    forward({ type: 'engine-spawned' });
    return null;
  }
  connectDriver(info.port);
  forward({ type: 'engine-spawned' });
  return null;
}

function connectDriver(port) {
  const net = require('net');
  const sock = net.connect({ host: '127.0.0.1', port }, () => {
    driverStarting = false;
    driver = sock;
    driverBuf = '';
    forward({ type: 'link', msg: `engine link up (port ${port})` });
    // Ask the daemon what it is doing right now (a farm that was already
    // running when this window opened).
    try { sock.write(JSON.stringify({ cmd: 'state' }) + '\n'); } catch {}
  });
  sock.on('data', d => {
    driverBuf += d.toString();
    let idx;
    while ((idx = driverBuf.indexOf('\n')) >= 0) {
      const line = driverBuf.slice(0, idx).trim();
      driverBuf = driverBuf.slice(idx + 1);
      if (!line) continue;
      if (line.startsWith('@EVT@')) { try { forward(JSON.parse(line.slice(5))); } catch {} }
    }
  });
  sock.on('error', e => {
    if (driver === sock) { driver = null; driverStarting = false; }
    forward({ type: 'error', msg: 'lost the connection to the engine: ' + (e && e.message || e) });
  });
  sock.on('close', () => {
    if (driver === sock) { driver = null; driverStarting = false; engineReady = false; }
    forward({ type: 'link', msg: 'engine link lost — reconnecting' });
    // The daemon is still running (it is detached): reconnect in a moment.
    setTimeout(() => { if (!driver) ensureDriver(); }, 2000);
  });
  return sock;
}

// Queue a command for the engine; it is written as soon as the engine has
// booted and reported ready (no fixed sleep that can fire too early or after
// the engine died).
function dispatch(cmd, cfg) {
  pendingCmd = { cmd, cfg };
  if (!driver) ensureDriver();
  flushPending();
}
function flushPending() {
  if (engineReady && pendingCmd && driver) {
    const p = pendingCmd; pendingCmd = null;
    try { driver.write(JSON.stringify(p) + '\n'); } catch {}
  }
}

function sendToDriver(obj) {
  if (!driver) return false;
  try { driver.write(JSON.stringify(obj) + '\n'); return true; } catch { return false; }
}

// The daemon is detached on purpose: closing this window must NOT stop the
// farm. Stop the batch from the panel instead.
function stopDriver(kill) {
  const d = driver;
  if (!d) return;
  if (kill) {
    driver = null; engineReady = false; pendingCmd = null;
    try { d.end(); } catch {}
  } else {
    sendToDriver({ cmd: 'stop' });
  }
}

// ---------- presets -----------------------------------------------------
function presetsPath() { return path.join(app.getPath('userData'), 'presets.json'); }
function readPresets() { try { return JSON.parse(fs.readFileSync(presetsPath(), 'utf8')); } catch { return []; } }
function writePresets(list) { fs.mkdirSync(path.dirname(presetsPath()), { recursive: true }); fs.writeFileSync(presetsPath(), JSON.stringify(list, null, 2)); }

// ---------- saved account ------------------------------------------------
// Login details are kept on disk once and reused, so the account never has to
// be typed again. The password is encrypted with the OS keyring through
// Electron's safeStorage; if the OS cannot encrypt, it is NOT written in clear
// text — the field is kept empty and the panel says so.
function credsPath() { return path.join(app.getPath('userData'), 'account.json'); }
function readCreds() {
  try {
    const raw = JSON.parse(fs.readFileSync(credsPath(), 'utf8'));
    let password = '';
    if (raw.password) {
      if (raw.encrypted) { try { password = safeStorage.decryptString(Buffer.from(raw.password, 'base64')); } catch { password = ''; } }
      else password = raw.password;
    }
    return { username: raw.username || '', password, remember: raw.remember !== false, encrypted: !!raw.encrypted, plain: !!raw.plain };
  } catch { return { username: '', password: '', remember: true, encrypted: false, plain: false }; }
}
function writeCreds({ username, password, remember }) {
  const prev = readCreds();
  const out = { username: String(username || '').trim(), remember: remember !== false, encrypted: false };
  const pass = String(password || '');
  // An empty password field means "keep the saved one" (the panel's placeholder
  // promises this); only a real value replaces it.
  if (pass) {
    // Prefer the OS keystore; if this machine has none, keep the value anyway
    // (file is 0600 and the panel states plainly that it is not encrypted) so
    // the account never has to be typed twice.
    try {
      out.password = safeStorage.encryptString(pass).toString('base64');
      out.encrypted = true;
    } catch {
      out.password = pass;
      out.plain = true;
    }
  } else if (prev.password) {
    out.password = prev.password;
    out.encrypted = !!prev.encrypted;
    out.plain = !!prev.plain;
  }
  fs.mkdirSync(path.dirname(credsPath()), { recursive: true });
  fs.writeFileSync(credsPath(), JSON.stringify(out, null, 2), { mode: 0o600 });
  return { ok: true, encrypted: !!out.encrypted, plain: !!out.plain };
}

// ---- multi-account list (headless farm) ---------------------------------
// One entry per game account that runs its own headless browser. Same
// storage rules as the single login: OS keystore when available, 0600 file
// otherwise, and the panel says plainly which it is.
function accountsPath() { return path.join(app.getPath('userData'), 'accounts.json'); }
function readAccounts() {
  try {
    const raw = JSON.parse(fs.readFileSync(accountsPath(), 'utf8'));
    const list = Array.isArray(raw) ? raw : (raw.accounts || []);
    return list.map(a => {
      let password = '';
      if (a.password) {
        if (a.encrypted) { try { password = safeStorage.decryptString(Buffer.from(a.password, 'base64')); } catch { password = ''; } }
        else password = a.password;
      }
      return { username: a.username || '', password, job: a.job || '', stage: a.stage || '', lobby: a.lobby || '', character: a.character || '', encrypted: !!a.encrypted, plain: !!a.plain };
    }).filter(a => a.username);
  } catch { return []; }
}
function writeAccounts(list) {
  const out = (list || []).map(a => {
    const entry = { username: String(a.username || '').trim(), job: a.job || '', stage: a.stage || '', lobby: a.lobby || '', character: a.character || '', encrypted: false };
    const pass = String(a.password || '');
    if (pass) {
      try { entry.password = safeStorage.encryptString(pass).toString('base64'); entry.encrypted = true; }
      catch { entry.password = pass; entry.plain = true; }
    }
    return entry;
  }).filter(a => a.username);
  fs.mkdirSync(path.dirname(accountsPath()), { recursive: true });
  fs.writeFileSync(accountsPath(), JSON.stringify(out, null, 2), { mode: 0o600 });
  return out.length;
}

// The engine needs this launch's CDP port and token to find the game pane;
// the panel only sends run settings, so they are added here (never in the UI).
// A saved account turns "account" mode into an automatic sign-in.
// withCreds=false for commands (detect) that never need the password.
function engineCfg(cfg, { withCreds = true } = {}) {
  const base = { ...cfg, cdpPort: CDP_PORT, botToken: BOT_TOKEN, out: (cfg && cfg.out) || 'logs' };
  // Multi-account mode brings its own logins; the single saved account does
  // not belong in that payload.
  if (withCreds && base.mode !== 'guest' && base.mode !== 'multi') {
    const creds = readCreds();
    if (creds.username && creds.password) {
      base.mode = 'login';
      base.username = creds.username;
      base.password = creds.password;
    }
  }
  return base;
}

// Keyboard input (card picks, WASD) only reaches the game if the docked view
// owns focus; the panel's HTML otherwise keeps it.
function focusGame() { try { if (gameView) gameView.webContents.focus(); } catch {} }

// Run settings live in config.json; the account password never does, and the
// CDP port/token are launch-scoped (a stale port on disk once made the engine
// boot pointing at a dead session).
function writeCfg(cfg) {
  const { username, password, cdpPort, botToken, accounts, party, ...safe } = cfg || {};
  // Accounts (with their passwords) live only in the app's own accounts file;
  // run settings never carry them.
  fs.writeFileSync(CFG_PATH, JSON.stringify(safe, null, 2));
}

function requireIdle(action) {
  if (!runActive) return true;
  forward({ type: 'error', msg: `${action} is not possible while a run is in progress — press Stop first` });
  return false;
}

ipcMain.handle('bot:start', (e, cfg) => {
  if (!patchedBundlePath()) return { ok: false, reason: 'The patched game bundle is missing — run rea/patch.py first. The bot cannot read the game without it.' };
  if (runActive) return { ok: false, reason: 'A run is already in progress — press Stop first.' };
  focusGame();
  // The renderer sends run settings; saved prefs (builds) ride along from
  // config.json — the renderer's values win. Accounts only ever come from the
  // renderer, and only in multi mode (never from the saved config).
  const merged = { ...readCfgSync(), ...cfg };
  if (merged.mode === 'multi') merged.accounts = (cfg && Array.isArray(cfg.accounts)) ? cfg.accounts : [];
  else { delete merged.accounts; delete merged.party; }
  const full = engineCfg(merged);
  writeCfg(full);
  dispatch('start', full);
  return { ok: true };
});
ipcMain.handle('bot:stop', () => { if (driver) sendToDriver({ cmd: 'stop' }); return true; });
ipcMain.handle('bot:kill', () => { stopDriver(true); return true; });
ipcMain.handle('bot:detect', () => {
  if (!requireIdle('Detect')) return { ok: false };
  focusGame();
  dispatch('detect', engineCfg(readCfgSync(), { withCreds: false }));
  return { ok: true };
});
ipcMain.handle('game:reload', () => {
  if (!requireIdle('Reload')) return { ok: false };
  if (gameView) gameView.webContents.reloadIgnoringCache();
  return { ok: true };
});
ipcMain.handle('game:profile', (e, mode) => {
  if (!requireIdle('Switch profile')) return { ok: false, profile: currentProfile };
  return { ok: true, profile: setProfile(mode) };
});
// ---- saved account IPC ----
ipcMain.handle('creds:get', () => {
  const c = readCreds();
  const backend = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : (safeStorage.isEncryptionAvailable() ? 'os' : 'none');
  return { username: c.username, hasPassword: !!c.password, remember: c.remember, encrypted: c.encrypted, plain: c.plain, keyring: safeStorage.isEncryptionAvailable(), backend };
});
ipcMain.handle('creds:save', (e, payload) => writeCreds(payload || {}));
ipcMain.handle('creds:clear', () => { try { fs.unlinkSync(credsPath()); } catch {} return true; });
ipcMain.handle('login:now', () => {
  if (!requireIdle('Sign in')) return { ok: false };
  dispatch('login', engineCfg(readCfgSync()));
  return { ok: true };
});
ipcMain.handle('game:focus', () => { focusGame(); return true; });
ipcMain.handle('ctx:get', () => ({
  cdpPort: CDP_PORT, botToken: BOT_TOKEN, patched: patchedBundlePath(),
  dir: __dirname, panelWidth: PANEL_WIDTH, profile: currentProfile, cfg: readCfgSync(),
  running: runActive,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
}));
ipcMain.handle('presets:list', () => readPresets());
ipcMain.handle('presets:save', (e, preset) => {
  const list = readPresets().filter(p => p.name !== preset.name);
  list.push(preset); writePresets(list); return readPresets();
});
ipcMain.handle('presets:delete', (e, name) => { writePresets(readPresets().filter(p => p.name !== name)); return readPresets(); });
ipcMain.handle('prefs:get', () => readCfgSync());
ipcMain.handle('prefs:save', (e, prefs) => {
  const cur = readCfgSync();
  writeCfg({ ...cur, ...(prefs || {}) });
  return readCfgSync();
});
ipcMain.handle('accounts:get', () => readAccounts());
ipcMain.handle('accounts:save', (e, list) => ({ ok: true, count: writeAccounts(list || []) }));
// The game server announces maintenance on /status.json. The panel shows it,
// so a farm that stops is never a mystery.
function pollServerStatus() {
  fetch('https://ro-survivors.com/status.json', { signal: AbortSignal.timeout(8000) })
    .then(r => (r.ok ? r.json() : null))
    .then(j => { if (j && win && !win.isDestroyed()) win.webContents.send('server-status', j); })
    .catch(() => {});
}

// Preview grid: the engine writes one screenshot per instance every 5s; the
// panel pulls them through here (file → data URL).
ipcMain.handle('shot:get', (e, file) => {
  try {
    const p = String(file || '');
    if (!p) return { ok: false };
    const st = fs.statSync(p);
    const data = fs.readFileSync(p).toString('base64');
    return { ok: true, data: `data:image/png;base64,${data}`, mtime: st.mtimeMs, size: st.size };
  } catch { return { ok: false }; }
});
// The headless farm replaces the docked game view with the preview grid.
ipcMain.handle('ui:gameview', (e, visible) => {
  try {
    if (!gameView) return true;
    gameView.setVisible(!!visible);
    // A hidden view keeps rendering the game (a whole core for nothing), so
    // park it on about:blank while the farm grid is up and bring it back when
    // the game window is needed again.
    if (!visible) gameView.webContents.loadURL('about:blank');
    else gameView.webContents.loadURL(GAME_URL);
  } catch {}
  return true;
});
// Live inventory feed: each farm instance writes <out>/snapshot.json.
ipcMain.handle('snap:get', (e, file) => {
  try {
    const p = String(file || '');
    if (!p) return { ok: false };
    const raw = fs.readFileSync(p, 'utf8');
    return { ok: true, data: JSON.parse(raw) };
  } catch { return { ok: false }; }
});
// Per-instance controls: stop one bot, or reset it.
ipcMain.handle('instance:action', (e, index, action) => {
  dispatch('instance', { index: Number(index), action: String(action || 'stop') });
  return true;
});
ipcMain.on('app:dir', e => { e.returnValue = __dirname; });
// Synchronous context for the GAME view's preload (it must tag the page before
// the game's first script runs, so an async invoke is not good enough).
ipcMain.on('ctx:sync', e => { e.returnValue = { cdpPort: CDP_PORT, botToken: BOT_TOKEN, patched: patchedBundlePath() }; });

function readCfgSync() { try { return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); } catch { return {}; } }

// ---------- window ------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1040, minHeight: 660,
    title: 'RO Survivors Bot',
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  win.loadFile('index.html');

  mountGameView();

  layout();
  win.on('resize', layout);
  win.on('closed', () => { stopDriver(true); win = null; gameView = null; });
}

function mountGameView() {
  const partition = PARTITIONS[currentProfile];
  servePatchedBundle(partition);
  const view = new WebContentsView({
    webPreferences: {
      partition,
      preload: path.join(__dirname, 'game-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  win.contentView.addChildView(view);
  view.setBounds(gameView ? gameView.getBounds() : { x: 0, y: 0, width: 700, height: 900 });
  view.webContents.loadURL(GAME_URL);
  view.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  view.webContents.on('render-process-gone', (_e, d) => forward({ type: 'game-gone', reason: d.reason }));
  view.webContents.on('did-fail-load', (_e, code, desc, url) => forward({ type: 'game-load-failed', code, desc, url }));
  view.webContents.on('did-finish-load', () => {
    // Frame cap in the page's MAIN world (the preload runs isolated, so the
    // game's own requestAnimationFrame is what needs the patch). The game
    // renders at 60 fps even when it only sits in town, which costs half a
    // core for nothing; the simulation is time-based, so 30 fps changes
    // nothing about how the game plays.
    view.webContents.executeJavaScript(`(() => {
      const cap = 30, minGap = 1000 / cap;
      let last = 0;
      window.requestAnimationFrame = (cb) => {
        const wait = Math.max(0, minGap - (performance.now() - last));
        return setTimeout(() => { last = performance.now(); cb(performance.now()); }, wait);
      };
      window.cancelAnimationFrame = (id) => { clearTimeout(id); };
    })()`).catch(() => {});
    forward({ type: 'game-loaded', profile: currentProfile });
  });
  // Keep the old view alive: destroying a WebContentsView while it renders
  // WebGL segfaults Electron on Wayland (it cost the app a crash every hour
  // or so). The old view is simply hidden and parked.
  const old = gameView;
  gameView = view;
  if (old) {
    try {
      old.setVisible(false);
      old.webContents.loadURL('about:blank');
      win.contentView.removeChildView(old);
      oldViews.push(old);
      // Keep at most one parked view around; older ones are closed quietly.
      while (oldViews.length > 1) {
        const stale = oldViews.shift();
        try { stale.webContents.close(); } catch {}
      }
    } catch {}
  }
  layout();
}

function setProfile(mode) {
  const next = mode === 'guest' ? 'guest' : 'account';
  if (next === currentProfile && gameView) return currentProfile;
  currentProfile = next;
  mountGameView();
  return currentProfile;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // the default Electron menu is noise here
  createWindow();
  pollServerStatus();
  setInterval(pollServerStatus, 60000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { stopDriver(true); app.quit(); });
// A clean quit is remembered so the supervisor does not bring the window back
// (the farm keeps running in the background either way).
app.on('before-quit', () => {
  try { fs.writeFileSync(path.join(__dirname, 'quit.flag'), String(Date.now())); } catch {}
});
