// RO Survivors bot v6.2 — PRE-BOSS THINNING, on top of v6/v6.1 (build main-BNOcv2PN.js, live 2026-11-11).
// v6 verdict: 0/3 clears, best 311.8s, first Eclipse kill — but all three
// runs died the SAME way: buried in the mob pack during a boss fight,
// HP melting ~9/s from contact damage at nearest 6-21px, live 66-70.
// The dodge layer works (skill hits are not the killer); the pack is.
// v6.2 = TWO changes on top of v6/v6.1:
//  (a) PRE-BOSS THINNING: in the ~40s before each boss spawns
//      (Eclipse 150, Toad 300, Dragon Fly 450, Vocal 600, Mastering 720),
//      force the pack thin — kite outward and burn adds down until live
//      < 40 AND nearest non-boss enemy > 100px, then hold that spacing
//      until the boss spawns. No loot detours, no elite pulls in the window.
//  (b) BREAK-OUT: during a boss fight, if the pack re-thickens
//      (live > 40 AND nearest non-boss enemy < 100px), break OUT of the
//      pack first (path-aware gap escape, held 4s) — do not keep engaging adds
//      inside it — re-establish spacing, then re-engage the boss.
//  (c) CORRECTION from Araso — MULTI-AoE AVOIDANCE: the bot also dies
//      because boss skills OVERLAP: it dodges one cast and lands inside
//      another's AoE. The dodge now considers ALL live danger zones AT
//      ONCE (their union) and steers to a spot safe from ALL of them; if
//      no fully-safe spot exists it minimises overlapping zones, then pack
//      density, then distance from the boss band — never stands still
//      inside a zone. Per-cast radial shoves are gone. Each death is
//      logged with its real damage source (skill vs contact, which skill,
//      zones overlapped at death) so the report can prove which diagnosis
//      was right.
// Mini-bosses are never skipped (they drop loot); meat rule unchanged;
// all four of Araso's points, v6.1 sidestep + killing-first boss mode,
// and loot-first are kept. Guest only, normal stages only, read-only
// patch, never Endless Tower. See ../beast-v6-report.md.
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { gapDir, hordeThreatAt, pathThreat, routeVectorFromPath } = require('./movement-policy');
const { runPersistentRuns } = require('./persistent-runner');
const {
  JOB_DEFS,
  normalizeBuilds,
  userTierIndex: _userTierIndex,
  planEntryFor,
  wizardScoreCard: _wizardScoreCard,
  scoreCard: _scoreCard,
} = require('./build-planner');
const {
  FALLBACK_BOSS_TIMES,
  SWORD_MIN,
  SWORD_MAX,
  SWARM_R,
  FLEE_HP,
  THIN_N,
  EMERG_N,
  EMERG_NEAR,
  PRETHIN_WINDOW,
  THIN_LIVE,
  THIN_NEAR,
  BOSS_MAX_SKILL_RANGE,
  SPAWN_FARM_RADIUS,
  VALUABLE_LOOT_RADIUS,
  ESCAPE_HOLD_MS,
  HORDE_PREP_WINDOW,
  MEAT_RESCUE_RANGE,
  mapBossTimes,
  nextBossTime,
  isValuablePickup,
  valuablePickupTarget,
  victorySweepActive,
  activeBosses,
  isLiveRunState,
  nearestVictoryPickup,
  applySpawnLeash,
  meatRescueOK,
  zonesAtPoint,
  sampleSafeDir,
  dodgeVector,
  engageBand,
  heldGapDir,
  steer,
  diagnoseDeath,
} = require('./steer-policy');

const SITE = 'https://ro-survivors.com/';
// The patched bundle is not a fixed file: the site ships a new build (and a
// new file name) on every deploy. The patch tool finds the live bundle and
// writes patched/<live name> plus patched/bundle.json; the bot reads that
// manifest. If patching is not possible the bot still runs on the plain live
// bundle (the farm keeps farming, only the inventory detail is missing).
const PATCHED_MANIFEST = path.join(__dirname, '..', 'rea', 'patched', 'bundle.json');
let PATCHED = null;
const PICKER_UNLOCK_BASE_MS = 380, PICKER_UNLOCK_PER_CARD_MS = 120;
const LOOP_MS = Math.max(120, parseInt(process.argv.find(a => a.startsWith('--loop-ms='))?.split('=')[1] || '250', 10));
const argv = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? 'true' : v]; }));
const ATTACH_EXISTING = argv['attach-existing'] !== 'false';
const START_FROM_EXISTING = argv['start-existing'] === 'true';
const PROBE = argv.probe === 'true';
const VIEWPORT = (argv.viewport || '640x400').split('x').map(Number);
const DSF = parseFloat(argv.dsf || '0.5');
const SPEED_PROBE_SECONDS = parseInt(argv['probe-seconds'] || '60', 10);
const RUNS = parseInt(argv.runs || '1', 10);
const MAX_SECONDS = parseInt(argv['max-seconds'] || '3600', 10);
const HEADLESS = argv.headless !== 'false';
const RECORD_VIDEO = argv['record-video'] === 'true'; // headed runs: Playwright records each page as .webm under OUT/videos
let JOB = (argv.job || 'mage').toLowerCase();
let STAGE = (argv.stage || 'prontera').toLowerCase();
const LADDER = argv.ladder === 'true';
const COMPARE = argv.compare === 'true';
const MAX_LOOT = argv['max-loot'] === 'true'; // push every difficulty slider to max (max loot multiplier)
// Camoufox mode: the bot launches its own headless Camoufox (Firefox) profiles
// instead of attaching to the app's CDP browser. One persistent profile per
// account; login and the created character persist across runs.
const CAMOUFOX = argv.browser === 'camoufox';
const CAMOUFOX_ROOT = process.env.RO_CAMOFOX_ROOT ||
  '/home/whizshounen/.local/share/mise/installs/node/26.12.1/lib/node_modules/camofox-browser/node_modules';
let camoufoxContext = null;
const OUT = path.resolve(argv.out || path.join(__dirname, 'logs-v6.2'));
// Multi-account mode: one account per bot process. Its sign-in is cached in
// its own file so later runs skip the login form.
const ACCOUNT_USER = process.env.RO_BOT_USER || argv.username || '';
const ACCOUNT_PASS = process.env.RO_BOT_PASS || argv.password || '';
// The character's equipment + backpack (read from the plaza snapshot) so the
// GUI can show the live inventory even while a run is going.
let lastCharData = null;
const AUTH_STATE = ACCOUNT_USER
  ? path.join(OUT, 'accounts', ACCOUNT_USER.replace(/[^A-Za-z0-9._-]/g, '_') + '.json')
  : path.join(OUT, 'browser-auth-state.json');
let ownedBrowserProcess = null;
let ownedHeadlessContext = null;
function commandOutput(command, args = []) {
  try {
    const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return result.status === 0 ? result.stdout.trim() : '';
  } catch { return ''; }
}
function executableForCommand(command) {
  if (!command) return null;
  if (path.isAbsolute(command)) return fs.existsSync(command) ? command : null;
  return commandOutput('which', [command]) || null;
}
function executableFromDesktop(desktopId, visited = new Set()) {
  if (!desktopId || visited.has(desktopId)) return null;
  visited.add(desktopId);
  const dataHome = process.env.XDG_DATA_HOME || path.join(require('os').homedir(), '.local', 'share');
  const dataDirs = [...new Set([dataHome, ...(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':')])];
  for (const dataDir of dataDirs) {
    const desktopFile = path.join(dataDir, 'applications', desktopId);
    if (!fs.existsSync(desktopFile)) continue;
    const contents = fs.readFileSync(desktopFile, 'utf8');
    const line = contents.match(/^Exec=(.*)$/m)?.[1]?.trim();
    const match = line && line.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
    const command = match && (match[1] || match[2] || match[3]);
    if (!command) continue;
    if (path.basename(command) === 'omarchy-launch-browser') {
      return executableFromDesktop(commandOutput('omarchy-cmd-default-browser'), visited);
    }
    const executable = executableForCommand(command);
    if (executable) return executable;
  }
  return null;
}
function defaultBrowserExecutable() {
  const desktopId = commandOutput('omarchy-cmd-default-browser') ||
    commandOutput('xdg-settings', ['get', 'default-web-browser']);
  const selected = executableFromDesktop(desktopId);
  if (selected) return selected;
  const browserCommand = process.env.BROWSER?.trim().split(/\s+/)[0];
  const fallback = executableForCommand(browserCommand);
  if (fallback) return fallback;
  throw new Error(`Couldn't resolve the default browser${desktopId ? ` (${desktopId})` : ''}.`);
}
async function cdpIsReady(cdpUrl) {
  try {
    const response = await fetch(`${cdpUrl.replace(/\/$/, '')}/json/version`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch { return false; }
}
const patchedRouteStates = new WeakMap();
let patchedDocCache = null;
// Firefox (Camoufox) ignores Playwright's fulfilled ES-module responses, so
// the patched bundle cannot be swapped in at the module URL. It CAN serve a
// document, so we rewrite the site's index.html and inline the patched bundle
// as a module script. Relative chunk specifiers are re-pointed at /build/
// because an inline module resolves them against the document URL.
async function patchedDocumentHtml() {
  if (patchedDocCache) return patchedDocCache;
  const html = await (await fetch(SITE)).text();
  let src = fs.readFileSync(PATCHED, 'utf8');
  // No service worker in headless mode: it would serve the live bundle from
  // its cache on the next load. (Done before the path rewrite below, or the
  // registration URL would already have been rewritten.)
  src = src.replace(/await a\.register\("sw\.js"\)/g, 'await Promise.resolve(null)');
  src = src.replace(/from"\.\/([A-Za-z0-9_.-]+\.js)"/g, 'from"./build/$1"');
  src = src.replace(/"\.\/([A-Za-z0-9_.-]+\.js)"/g, '"./build/$1"');
  const inline = '<script type="module">' + src.replace(/<\/script/gi, '<\\/script') + '</script>';
  // Function replacer: the bundle contains $& / $' sequences, and a string
  // replacement would expand them and corrupt the inlined source.
  const patched = html.replace(/<script[^>]*main-[A-Za-z0-9_-]+\.js[^>]*><\/script>/, () => inline);
  if (patched === html) throw new Error('could not find the game bundle script tag in index.html');
  patchedDocCache = patched;
  return patched;
}
async function installPatchedDocument(page) {
  if (!PATCHED) return { served: false };
  const html = await patchedDocumentHtml();
  await page.route(url => {
    try {
      const href = String(url && url.href ? url.href : url).replace(/\/$/, '');
      return href === SITE.replace(/\/$/, '');
    } catch { return false; }
  }, async route => {
    log({ msg: 'patched document served (patched bundle inlined)' });
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: html });
  });
}
async function installPatchedBundleRoute(page) {
  if (!PATCHED) return { served: false, cdpSession: null };
  if (CAMOUFOX) return installPatchedDocument(page);
  let state = patchedRouteStates.get(page);
  if (state) return state;
  state = { served: false, cdpSession: null };
  try {
    state.cdpSession = await page.context().newCDPSession(page);
    await state.cdpSession.send('Network.setBypassServiceWorker', { bypass: true });
    // The cache stays ENABLED (the game's art must stay cached between runs,
    // that is what makes a start fast). Only the patched bundle is served
    // with no-store below, so the page can never run a stale patch.
  } catch (error) {
    log({ msg: `could not bypass cached/service-worker bundle responses: ${String(error).slice(0, 160)}` });
  }
  const bundleName = path.basename(PATCHED);
  page.on('request', request => {
    if (request.url().includes('main-')) log({ msg: `main bundle request: ${request.url()}` });
  });
  await page.route(url => {
    try {
      // Playwright hands the matcher a URL object in some builds and a string
      // in others; a broken matcher silently serves the UNPATCHED bundle.
      const pathname = (url && typeof url === 'object' && url.pathname)
        ? url.pathname
        : new URL(String(url)).pathname;
      return pathname.endsWith(`/${bundleName}`);
    }
    catch { return false; }
  }, async route => {
    state.served = true;
    log({ msg: 'patched bundle served (route fulfilled)' });
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      // Never cache the patched bundle: the next run must always get the
      // current one, while the rest of the game stays cached.
      headers: { 'cache-control': 'no-store' },
      body: fs.readFileSync(PATCHED, 'utf8'),
    });
  });
  patchedRouteStates.set(page, state);
  return state;
}
async function saveBrowserAuth(context) {
  try {
    fs.mkdirSync(path.dirname(AUTH_STATE), { recursive: true });
    const state = await context.storageState({ indexedDB: true });
    const temporary = `${AUTH_STATE}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, AUTH_STATE);
  } catch (error) {
    log({ msg: `could not save browser sign-in state: ${String(error).slice(0, 180)}` });
  }
}
async function closeOwnedHeadlessBrowser() {
  if (!HEADLESS) return;
  if (ownedHeadlessContext) {
    const context = ownedHeadlessContext;
    ownedHeadlessContext = null;
    await context.close().catch(() => {});
  }
  if (camoufoxContext) {
    const context = camoufoxContext;
    camoufoxContext = null;
    await context.close().catch(() => {});
  }
  if (ownedBrowserProcess && ownedBrowserProcess.exitCode === null) {
    ownedBrowserProcess.kill('SIGTERM');
  }
  ownedBrowserProcess = null;
}
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    closeOwnedHeadlessBrowser().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  });
}
// Fallback only. Each map has its own live script.bosses schedule; the
// Job definitions imported from ./build-planner.js (swordsman, archer, mage, acolyte).
// Lobby ("server") selection. The game's lobby picker reuses the NPC dialog:
// the lobby buttons live in #npc-text as <button data-lb="N"> with the lobby
// name, and #npc-options holds only the escape hatch "Jugar sin conexión"
// (play offline). Without an explicit pick the bot treated that dialog as an
// NPC dialog and clicked the offline button, so every run was solo.
const LOBBY_NAMES = ['Asgard', 'Midgard', 'Alfheim', 'Vanaheim', 'Jotunheim', 'Nidavellir', 'Svartalfheim', 'Niflheim', 'Muspelheim'];
const LOBBY_NAME = String(argv.lobby || 'Nidavellir');
const LOBBY_ID = (() => { const i = LOBBY_NAMES.findIndex(n => n.toLowerCase() === LOBBY_NAME.toLowerCase()); return i >= 0 ? i + 1 : 6; })();
const RUN_TAG = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
const SCREENSHOT_DIR = path.join(OUT, 'screenshots');
const MAX_DIAGNOSTIC_SCREENSHOTS = 40;
const MAX_DIAGNOSTIC_SCREENSHOT_BYTES = 64 * 1024 * 1024;
function pruneScreenshots() {
  const candidates = fs.readdirSync(SCREENSHOT_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-r.+\.png$/.test(entry.name))
    .map(entry => {
      try {
        const file = path.join(SCREENSHOT_DIR, entry.name);
        const stat = fs.statSync(file);
        return { name: entry.name, file, modified: stat.mtimeMs, size: stat.size };
      } catch { return null; }
    })
    .filter(Boolean);
  let removed = 0;
  for (const name of screenshotsToDelete(candidates, MAX_DIAGNOSTIC_SCREENSHOTS, MAX_DIAGNOSTIC_SCREENSHOT_BYTES)) {
    try { fs.unlinkSync(path.join(SCREENSHOT_DIR, name)); removed++; } catch {}
  }
  return removed;
}
const logFile = path.join(OUT, `runs-${RUN_TAG}.jsonl`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });
function log(ev) { const rec = { t: new Date().toISOString(), ...ev }; logStream.write(JSON.stringify(rec) + '\n'); console.log(`[${rec.t.slice(11, 19)}]`, ev.msg || JSON.stringify(ev)); }
const prunedScreenshots = pruneScreenshots();
if (prunedScreenshots) log({ msg: `screenshot retention removed ${prunedScreenshots} old diagnostic images; keeping at most ${MAX_DIAGNOSTIC_SCREENSHOTS} / ${Math.round(MAX_DIAGNOSTIC_SCREENSHOT_BYTES / 1024 / 1024)} MiB` });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- auto re-patch on bundle-hash change. The patch tool (rea/patch.py)
// downloads the live bundle, discovers the game's anchors by pattern, injects
// the read-only snapshot hooks and writes patched/bundle.json. The bot reads
// that manifest afterwards.
//
// If the game renamed its internals so badly that the anchors cannot be
// found, patching fails but the FARM KEEPS RUNNING on the plain live bundle:
// a missing inventory panel must never stop the bots.
const { execSync } = require('child_process');
const PATCH_SCRIPT = path.join(__dirname, '..', 'rea', 'patch.py');

function readPatchManifest() {
  try { return JSON.parse(fs.readFileSync(PATCHED_MANIFEST, 'utf8')); } catch { return {}; }
}
function runPatchTool() {
  try {
    execSync(`python3 ${PATCH_SCRIPT}`, { timeout: 300000, stdio: 'pipe' });
  } catch (e) {
    log({ msg: `patch tool failed: ${String(e && e.stderr || e).slice(0, 300)}` });
  }
}
function ensurePatched() {
  const root = path.join(__dirname, '..');
  let manifest = readPatchManifest();
  // The manifest is only trusted if the patched file is really there.
  let ok = manifest && manifest.ok && manifest.name
    && fs.existsSync(path.join(root, 'rea', 'patched', manifest.name));
  if (!ok) {
    log({ msg: 'no usable patched bundle — running the patch tool' });
    runPatchTool();
    manifest = readPatchManifest();
    ok = manifest && manifest.ok && manifest.name
      && fs.existsSync(path.join(root, 'rea', 'patched', manifest.name));
  }
  if (ok) {
    PATCHED = path.join(root, 'rea', 'patched', manifest.name);
    log({ msg: `patched bundle ready: ${manifest.name} (sha ${String(manifest.patchedSha || '').slice(0, 12)})` });
  } else {
    PATCHED = null;
    log({ msg: `patch unavailable (${manifest && manifest.reason || 'unknown'}) — running the plain live bundle, the farm still works` });
  }
  return PATCHED;
}
ensurePatched();

// --- local CONNECT relay (same reason as v1 bot.js: Chromium cannot
// authenticate to this VM's egress proxy directly; curl/Node can). The relay
// re-issues CONNECT with the env credentials; credentials stay in memory.
// LOCAL-PACKAGE NOTE: the relay is only needed behind an egress proxy
// (this VM). On a normal PC with no https_proxy set, skip it and let
// Chromium connect directly — otherwise the browser gets pointed at
// a dead proxy and nothing loads.
const NEED_PROXY = !!(process.env.https_proxy || process.env.HTTPS_PROXY);
const relay = NEED_PROXY ? spawn('node', [path.join(__dirname, '..', 'rea', 'relay.js')], { env: { ...process.env, RELAY_PORT: '18080' }, stdio: 'ignore' }) : null;

// --- build planner (v4, DPS-per-level from soul_linker tables, Tp=1.5).
// DPS priors are L1 single-target DPS estimates (live dmgBy in the
// snapshot measures the real thing per run; see report). AoE skills get
// an `aoe` multiplier = how many targets they typically hit at once.
//   Swordsman: bash cd.9 dmg ~300/Tp=200 -> ~222 DPS single (observed
//     v3: much lower in practice - melee uptime is the tax); magnum cd4
//     AoE r~144 knock 260; sword_dance cd9 r185 3 ticks.
//   Archer: double_strafe cd.9, 2 arrows x 56/1.5=37.3 -> 83 DPS, +20%/lvl;
//     arrow_shower cd3.2, 22 dmg x 2 volleys, 60deg cone range 300, knock 90;
//     blitz_beat cd6 multi 3 hits; beast_strafing cd5 projectile;
//     phantasmic_arrow cd9 pierce projectile.
//   Mage: firebolt cd1.3, 19 dmg, 1 bolt +1 per level-ish (count grows),
//     range 420; soul_strike cd1.7, 10.35 dmg, count 1+, burst 2+;
//     sight cd8-uptime orbit flames r88 dmg 12.65 hitCd .6, count lvl+1;
//     frost_nova cd12 AoE freeze 60% 2s; meteor_storm cd14 AoE;
//     fire_pillar cd9 AoE ground; jupitel_thunder cd6 projectile;
//     earth_spike cd6 multi; storm_gust cd16 AoE freeze; lord_of_vermilion
//     cd18 AoE ground; energy_coat -6% dmg taken/rank (survive).
// Phase plan: early damage+area -> upgrades to owned -> crit/ASPD/CD ->
// survivability FORCED when a boss is due within 40s or HP<50% (v3 died
// to the t~150 boss with no survival picks). After t=600 (boss phase)
// single-target DPS is worth 1.5x (Mastering 52k HP must die in the
// 720-900 window: ~290 DPS needed). Discovery late-game only.
let USER_BUILDS = null;
try {
  if (argv.builds) {
    const raw = JSON.parse(fs.readFileSync(String(argv.builds), 'utf8'));
    USER_BUILDS = normalizeBuilds(raw);
    if (USER_BUILDS) console.error('builds: loaded user builds for ' + Object.keys(USER_BUILDS).join(', '));
  }
} catch (e) {
  console.error('builds: failed to load --builds: ' + (e && e.message));
}
function userTierIndex(text, ctx) { return _userTierIndex(text, ctx, USER_BUILDS); }
function wizardScoreCard(text, ctx) { return _wizardScoreCard(text, ctx, USER_BUILDS); }

function objectivesFound(observedNames, objectives) {
  const names = observedNames.map(name => String(name || '').toLowerCase());
  return objectives.every(objective => {
    const target = String(objective || '').trim().toLowerCase();
    return !!target && names.some(name => name.includes(target));
  });
}
function mergeFoundObjectives(previous, observedNames, objectives) {
  const found = new Set([...previous].map(objective => String(objective).toLowerCase()));
  for (const objective of objectives) {
    if (objectivesFound(observedNames, [objective])) found.add(String(objective).trim().toLowerCase());
  }
  return found;
}
function allObjectivesObtained(found, objectives) {
  return objectives.length > 0 && objectives.every(objective => found.has(String(objective).trim().toLowerCase()));
}
function screenshotsToDelete(entries, maxFiles, maxBytes) {
  const newestFirst = [...entries].sort((a, b) => b.modified - a.modified);
  const remove = [];
  let kept = 0, bytes = 0;
  for (const entry of newestFirst) {
    if (kept >= maxFiles || bytes + entry.size > maxBytes) remove.push(entry.name);
    else { kept++; bytes += entry.size; }
  }
  return remove;
}

function scoreCard(text, ctx) { return _scoreCard(text, ctx, USER_BUILDS); }
// --- exact-state perception
async function readState(page) {
  // The game snapshot contains large/cyclic metadata. Never JSON-clone it:
  // project only the fields consumed by steering and run accounting in-page.
  return page.evaluate(() => {
    if (typeof window.__RO_SNAPSHOT__ !== 'function') return null;
    try {
      const raw = window.__RO_SNAPSHOT__();
      if (!raw || typeof raw !== 'object') return null;
      const pick = (obj, keys) => {
        if (!obj || typeof obj !== 'object') return null;
        const out = {};
        for (const k of keys) {
          const v = obj[k];
          if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
        }
        return out;
      };
      const rows = (value, keys) => Array.isArray(value) ? value.map(v => pick(v, keys)).filter(Boolean) : [];
      // Item names and icons come from the game's own item table, which the
      // patched bundle exposes as __RO_ITEM__ (available once the character
      // has been in the plaza).
      const itemInfo = (id) => {
        try {
          const it = (typeof window.__RO_ITEM__ === 'function') ? window.__RO_ITEM__(id) : null;
          return it ? { name: it.name || null, icon: it.icon || null, slot: it.slot || null } : { name: null, icon: null, slot: null };
        } catch { return { name: null, icon: null, slot: null }; }
      };
      const named = (value, keys) => Array.isArray(value)
        ? value.map(v => { const p = pick(v, keys); if (!p) return null; return { ...p, ...itemInfo(p.id) }; }).filter(Boolean)
        : [];
      const count = value => Array.isArray(value) ? { length: value.length } : { length: 0 };
      const summary = value => {
        if (!value || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.slice(0, 12).map(v => typeof v === 'object' ? pick(v, ['id', 'name', 'key', 'value']) : v);
        return Object.fromEntries(Object.entries(value).slice(0, 24).map(([k, v]) => [k, typeof v === 'object' ? null : v]));
      };
      const out = pick(raw, [
        'ok', 'state', 'stage', 'time', 'timeUp', 'closeAt', 'lootUntil', 'finalBossDefeated', 'bossSchedule',
        'hp', 'maxHp', 'level', 'exp', 'expNext', 'kills', 'zeny', 'nextHordeAt', 'nextEliteAt',
        'chestsOpened', 'mobLoot', 'mvpsKilled', 'bossKills',
      ]) || {};
      out.bossSchedule = Array.isArray(raw.bossSchedule)
        ? raw.bossSchedule.map(b => pick(b, ['id', 't'])).filter(Boolean)
        : [];
      out.finalBossDefeated = raw.finalBossDefeated ?? (() => {
        const R = window.__RO__;
        if (!R || !R.script || !Array.isArray(R.script.bosses)) return false;
        const live = [...(R.bosses || []), ...(R.enemies || []).filter(e => e && !e.dead && e.def && e.def.boss)];
        return R.nextBoss >= R.script.bosses.length && !live.some(b => !b.dead);
      })();
      out.mvpsKilled = summary(raw.mvpsKilled);
      out.player = pick(raw.player, ['x', 'y', 'dead', 'moving']);
      out.bounds = pick(raw.bounds, ['x0', 'y0', 'x1', 'y1']);
      out.stats = pick(raw.stats, ['speedMult']);
      out.enemies = rows(raw.enemies, ['id', 'x', 'y', 'boss', 'elite', 'damage', 'hp', 'maxHp', 'dead']);
      out.pickups = rows(raw.pickups, ['x', 'y', 'kind', 'value', 'quality']);
      out.bosses = rows(raw.bosses, ['id', 'hp', 'maxHp']);
      // Some game builds expose a live boss in `enemies` but leave `bosses`
      // empty. Fold those flagged enemies in so end detection cannot declare
      // victory while the final boss is still on the field.
      for (const boss of (out.enemies || []).filter(e => e && e.boss && !out.bosses.some(b => b.id === e.id))) out.bosses.push(boss);
      out.bossBrains = Array.isArray(raw.bossBrains) ? raw.bossBrains.map(b => ({
        ...pick(b, ['boss', 'maxHp', 'busyUntil', 'phase', 'gcd']),
        skills: rows(b.skills, ['name', 'cd', 'range']),
        ready: Array.isArray(b.ready) ? b.ready.slice(0, 24) : [],
        skillReadyAt: Array.isArray(b.skillReadyAt) ? b.skillReadyAt.slice(0, 24) : [],
      })) : [];
      out.projectiles = rows(raw.projectiles, ['x', 'y', 'vx', 'vy']);
      out.fireRings = rows(raw.fireRings, ['x', 'y', 'r']);
      out.slots = summary(raw.slots) || [];
      out.weapons = summary(raw.weapons) || [];
      out.passives = summary(raw.passives) || [];
      out.runLoot = named(raw.runLoot, ['id', 'quality', 'ilvl', 'tier']);
      out.runCards = named(raw.runCards, ['id', 'quality', 'ilvl', 'tier']);
      out.runEggs = named(raw.runEggs, ['id', 'quality']);
      // Equipment the character is wearing (ids + names) — the game's own
      // look object keeps it during a run.
      out.equip = raw.equip && typeof raw.equip === 'object'
        ? Object.fromEntries(Object.entries(raw.equip).filter(([, v]) => v != null).map(([k, v]) => [k, { id: v, ...itemInfo(v) }]))
        : null;
      out.dmgBy = summary(raw.dmgBy);
      out.killsBy = summary(raw.killsBy);
      return out;
    } catch (e) { return { ok: false, error: String(e) }; }
  }).catch(e => ({ ok: false, error: String(e) }));
}
async function readHud(page) {
  return page.evaluate(() => {
    const txt = s => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; };
    // NOTE: offsetParent is null for position:fixed elements, which most
    // game overlays are — judge visibility by class + computed style.
    const vis = s => { const el = document.querySelector(s); if (!el || el.classList.contains('hidden')) return false; const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
    const cards = [...document.querySelectorAll('#pk-cards .pk-card')].map(el => ({ text: el.textContent.replace(/\s+/g, ' ').trim(), disabled: el.disabled }));
    const perkBtns = [...document.querySelectorAll('#picker button, #pk-perks button, .pk-perk')].map(el => ({ text: (el.textContent || '').replace(/\s+/g, ' ').trim(), disabled: !!el.disabled }));
    const pickerSub = txt('#pk-sub');
    const sockets = txt('#lu-sockets');
    const pickType = /skill|habilidad/i.test([txt('#pk-title'), pickerSub, sockets].filter(Boolean).join(' '))
      ? 'skill' : 'item';
    return { pickerOpen: vis('#picker'), pickerTitle: txt('#pk-title'), pickerSub, pickType, pickerTimer: txt('#pk-timer'), perkBtns, cards,
      gameOver: vis('#gameover'), gameOverTitle: txt('#go-title'), gameOverStats: txt('#go-stats'),
      paused: vis('#pause'), npcDialog: vis('#npc-dialog'), story: vis('#story'),
      stagesOpen: vis('#stages'), charSelect: vis('#charselect'), hudVisible: vis('#hud') };
  }).catch(e => ({ error: String(e) }));
}

// --- steering v4: anti-encirclement FIRST, kite-at-max-range for ranged.
// Spawn math (bundle yU): 1.2/s (maxAlive 40) -> 7/s (maxAlive 260); v3
// died at 63-69 live. v4 modes, in priority order:
//  boss: any boss alive. Ranged jobs hold a 710-760px ring: every damaging
//    boss skill in the bundle has range <=650 (summons reach 700 but deal
//    no direct damage), so beyond 700 the boss CANNOT cast — it only
//    chases at speed 80-115 while the player runs 145-165. Strafe
//    tangentially, keep firing (bow 770 / rod 728 range). Melee keeps the
//    v3 300px ring. Adds within 150px are fled from radially. During the
//    boss's busyUntil (casting/recovery) hold the ring and burn.
//  emergency: live>=55 OR nearest<25px OR (HP<35% AND nearest<200).
//    path-aware 16-direction escape, held 4s — escape EARLY, v3 only fled
//    once already surrounded and its centroid-away escape ran into the
//    pack in every direction.
//  thin: live>=40. Flow mode: keep a heading, turn only to avoid dense
//    cones; bias to the nearest map edge so spawns funnel to one side.
//  kite (ranged default): hold 350-550px from the nearest enemy; approach
//    if nearest>700 (basic-attack range), back off if <200; snake in
//    straight runs (orbit flips every 8s) so the pack trails in a line
//    for cone/AoE skills. Basic attacks auto-fire the whole time.
//  engage (melee default): v3 band 55-95px, predictive intercept.
// Telegraph dodging always on: fireRings / fxAnchors / projectiles
// (closest-approach test), weight x1.5 in boss mode.
// Boss schedule, valuable pickup, spawn leash, meat rescue, dodgeVector, steer,
// and diagnoseDeath are implemented in ./steer-policy.js.

// Keyboard movement is collision-resolved one frame at a time. A cardinal key
// can therefore keep the player pressed against a wall forever even though a
// safe direction exists around the corner. For escape modes, ask the running
// game for a real walkable route and steer toward its next waypoint instead of
// blindly holding the first geometric gap heading.
async function mapAwareVector(page, s, v) {
  const routeModes = new Set(['emergency', 'horde-prep', 'breakout', 'prethin', 'rescue', 'horde-avoid', 'spawn-leash']);
  if (!page || !s || !s.player || !v || !routeModes.has(v.mode)) return v;
  if (!Number.isFinite(v.dx) || !Number.isFinite(v.dy) || Math.hypot(v.dx, v.dy) < 0.05) return v;
  const distance = v.mode === 'rescue' ? 420 : 640;
  const route = await page.evaluate(({ vector, distance, bounds }) => {
    try {
      const R = window.__RO__;
      const walk = R && R.walk;
      if (!walk || typeof walk.pathTo !== 'function') return null;
      const x = Number(R.player && R.player.x);
      const y = Number(R.player && R.player.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const b = bounds && Number.isFinite(bounds.x0) && Number.isFinite(bounds.x1) && Number.isFinite(bounds.y0) && Number.isFinite(bounds.y1)
        ? bounds : null;
      const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
      let tx = x + vector.dx * distance;
      let ty = y + vector.dy * distance;
      if (b) {
        tx = clamp(tx, b.x0 + 32, b.x1 - 32);
        ty = clamp(ty, b.y0 + 32, b.y1 - 32);
      }
      if (typeof walk.nearestWalkable === 'function') [tx, ty] = walk.nearestWalkable(tx, ty);
      let path = walk.pathTo(x, y, tx, ty);
      // `resolve` is the game's own one-step collision rule. If a target is
      // valid only on one axis, use that resolved point as a final fallback;
      // the normal path still comes from pathTo and remains map-aware.
      if (!path && typeof walk.resolve === 'function') {
        const resolved = walk.resolve(x, y, tx, ty);
        if (Array.isArray(resolved) && resolved.length >= 2) path = walk.pathTo(x, y, resolved[0], resolved[1]);
      }
      return {
        x, y,
        path: Array.isArray(path) ? path.slice(0, 8).map(point => ({ x: Number(point.x), y: Number(point.y) })) : null,
      };
    } catch { return null; }
  }, { vector: { dx: v.dx, dy: v.dy }, distance, bounds: s.bounds }).catch(() => null);
  if (!route || !Array.isArray(route.path)) return { ...v, walkRouted: false, walkRouteMiss: true };
  const waypoint = routeVectorFromPath(route.path, route.x, route.y);
  if (!waypoint) return { ...v, walkRouted: false, walkRouteMiss: true };
  return { ...v, dx: waypoint.dx, dy: waypoint.dy, walkRouted: true, walkWaypoint: waypoint.waypoint };
}

// Steering, dodgeVector, meatRescueOK, and diagnoseDeath are imported from ./steer-policy.js.
const DIRS = [
  { keys: ['d'], name: 'E' }, { keys: ['s', 'd'], name: 'SE' }, { keys: ['s'], name: 'S' }, { keys: ['s', 'a'], name: 'SW' },
  { keys: ['a'], name: 'W' }, { keys: ['w', 'a'], name: 'NW' }, { keys: ['w'], name: 'N' }, { keys: ['w', 'd'], name: 'NE' },
];
class Mover {
  constructor(page) { this.page = page; this.held = new Set(); }
  async setVec(dx, dy) {
    if (Math.hypot(dx, dy) < 0.05) return;
    const ang = Math.atan2(dy, dx); // screen: x east, y south; DIRS[0]=E, +45deg steps clockwise
    const idx = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
    const want = new Set(DIRS[idx].keys);
    for (const k of [...this.held]) if (!want.has(k)) { await this.page.keyboard.up(k); this.held.delete(k); }
    for (const k of want) if (!this.held.has(k)) { await this.page.keyboard.down(k); this.held.add(k); }
    this.dirName = DIRS[idx].name;
  }
  async releaseAll() { for (const k of [...this.held]) { try { await this.page.keyboard.up(k); } catch {} } this.held.clear(); }
}
function parseTimer(t) { if (!t) return null; const m = String(t).match(/(\d+):(\d+)/); return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null; }
async function shot(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${RUN_TAG}-${name}.png`) }).catch(() => {});
  pruneScreenshots();
}
async function captureDashboard(page) {
  const finalPath = path.join(SCREENSHOT_DIR, 'live.png');
  const tempPath = path.join(SCREENSHOT_DIR, 'live.tmp.png');
  try {
    await page.screenshot({ path: tempPath });
    fs.renameSync(tempPath, finalPath);
  } catch {}
}
async function clickVisible(page, sel, timeout = 5000) { try { await page.locator(sel).first().click({ timeout }); return true; } catch { return false; } }
// Direct DOM click (bypasses Playwright actionability, which silently no-ops
// on this game's buttons — see #btn-create / #cc-ok failures). Returns the
// button state so a dead click is visible in the log.
async function domClick(page, sel) {
  return page.evaluate(s => { const b = document.querySelector(s); if (!b) return null; const r = b.getBoundingClientRect(); const st = { disabled: b.disabled, text: (b.textContent || '').trim().slice(0, 40), visible: r.width > 0 && r.height > 0 }; b.click(); return st; }, sel).catch(() => null);
}
async function waitVisible(page, sel, timeout = 15000) { try { await page.locator(sel).first().waitFor({ state: 'visible', timeout }); return true; } catch { return false; } }

// Join the requested lobby before anything else touches #npc-dialog. Returns
// true while the picker is on screen (clicked or waiting), so the caller can
// loop instead of falling through to the NPC handler.
async function ensureLobby(page) {
  const pick = await page.evaluate(({ name, id }) => {
    const dialog = document.querySelector('#npc-dialog');
    if (!dialog || !dialog.getClientRects().length) return { open: false };
    const buttons = [...document.querySelectorAll('#npc-text [data-lb]')];
    if (!buttons.length) return { open: false };
    const label = b => (b.querySelector('b')?.textContent || b.textContent || '').trim().slice(0, 24);
    const hit = buttons.find(b => new RegExp(name, 'i').test(b.textContent || '')) ||
      buttons.find(b => Number(b.dataset.lb) === id);
    try { localStorage.setItem('ro-survivors.lobby', String(id)); } catch {}
    if (hit) hit.click();
    return {
      open: true,
      choices: buttons.map(b => `${b.dataset.lb}:${label(b)}${b.disabled ? '(full)' : ''}`),
      clicked: hit ? `${hit.dataset.lb}:${label(hit)}` : null,
    };
  }, { name: LOBBY_NAME, id: LOBBY_ID }).catch(() => ({ open: false }));
  if (!pick.open) return false;
  log({ msg: pick.clicked
    ? `lobby picker: joined ${pick.clicked} (choices ${pick.choices.join(' ')}); not taking the offline option`
    : `lobby picker: ${LOBBY_NAME} not offered (choices ${pick.choices.join(' ')}); waiting instead of going offline` });
  // The plaza header names the lobby and channel once the socket is up
  // ("Prontera Fountain Square Nidavellir · Channel 16 · 12 players"), so it is
  // the one honest signal that we are online rather than solo.
  if (pick.clicked) {
    let online = false;
    for (let attempt = 0; attempt < 24 && !online; attempt++) {
      online = await page.evaluate(name => (document.querySelector('#lobby-place')?.innerText || '').includes(name), LOBBY_NAME).catch(() => false);
      if (!online) await page.waitForTimeout(500);
    }
    log({ msg: online
      ? `online confirmed: plaza header shows ${LOBBY_NAME}`
      : `WARN: ${LOBBY_NAME} not confirmed in the plaza header yet; continuing only after the lobby calls on screen` });
  }
  await page.waitForTimeout(1500);
  return true;
}
async function enterGame(page, runNo) {
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(4000);
  let enabled = false;
  {
    const st = await waitForPlay(page, 600000, `run ${runNo}`);
    enabled = st === 'play';
  }
  log({ run: runNo, msg: enabled ? 'splash loaded, entering as guest' : 'WARN #sp-play never enabled within 600s' });
  await shot(page, `r${runNo}-splash`);
  await clickVisible(page, '#sp-play', 8000);
  await page.waitForTimeout(2500);
  await dismissAccountModal(page, 'after pressing Play');
  const acc = await page.evaluate(() => { const el = document.querySelector('#account-popup'); return el ? !el.classList.contains('hidden') : false; });
  if (acc) { log({ run: runNo, msg: 'account popup appeared, declining (guest only)' }); await clickVisible(page, '#acc-decline', 3000); await page.waitForTimeout(1500); }
  await shot(page, `r${runNo}-after-splash`);
}
async function selectCharacter(page, runNo) {
  if (!await waitVisible(page, '#charselect', 20000)) { log({ run: runNo, msg: 'WARN #charselect did not appear' }); await shot(page, `r${runNo}-no-charselect`); return false; }
  const slots = await page.evaluate(() => [...document.querySelectorAll('#slots > *')].map(el => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 160)));
  log({ run: runNo, msg: `charselect slots: ${JSON.stringify(slots)}` });
  await shot(page, `r${runNo}-charselect`);
  // Only pick a slot that actually holds a character (a job name, NOT
  // "Empty slot"). Clicking an empty slot just highlights it and leaves
  // Play disabled — that was the v2 run-1/2 bug: the old fallback
  // `text.length > 3` matched "Empty slot" and Play did nothing.
  const picked = await page.evaluate((reSrc) => {
    const els = [...document.querySelectorAll('#slots > *')];
    const hit = els.find(e => new RegExp(reSrc, 'i').test(e.textContent) && !/empty slot/i.test(e.textContent)) || els.find(e => /swordsman|espadach|thief|ladr|mage|mago|archer|arquero|acolyte|acólito|merchant|mercader/i.test(e.textContent) && !/empty slot/i.test(e.textContent));
    if (hit) { hit.click(); return hit.textContent.replace(/\s+/g, ' ').trim().slice(0, 120); } return null;
  }, JOB_DEFS[JOB].re.source);
  if (picked) { log({ run: runNo, msg: `selected slot: ${picked}` }); await page.waitForTimeout(800); log({ run: runNo, msg: `btn-play click: ${JSON.stringify(await domClick(page, '#btn-play'))}` }); return true; }
  log({ run: runNo, msg: 'no character yet — opening Create (Crear) form' });
  // Direct DOM click: Playwright's click silently no-ops on this page
  // (previous run: #btn-create "clicked" but the form never opened).
  const createState = await page.evaluate(() => { const b = document.querySelector('#btn-create'); if (!b) return null; const r = b.getBoundingClientRect(); return { disabled: b.disabled, text: b.textContent.trim(), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }; });
  log({ run: runNo, msg: `btn-create state: ${JSON.stringify(createState)}` });
  await page.evaluate(() => { const b = document.querySelector('#btn-create'); if (b) b.click(); });
  if (!await waitVisible(page, '#charcreate', 15000)) { log({ run: runNo, msg: 'WARN #charcreate did not appear after Create' }); await shot(page, `r${runNo}-charcreate-missing`); return false; }
  await page.waitForTimeout(1500); await shot(page, `r${runNo}-charcreate`);
  const created = await page.evaluate(({ r, reSrc }) => {
    const jobs = [...document.querySelectorAll('#cc-jobs > *, #cc-jobs button, #cc-jobs .job')];
    const job = jobs.find(e => new RegExp(reSrc, 'i').test(e.textContent)) || jobs[0];
    if (job) job.click();
    const name = document.querySelector('#cc-name');
    if (name) { name.value = 'Bot' + Math.random().toString(36).slice(2, 7) + r; name.dispatchEvent(new Event('input', { bubbles: true })); }
    return job ? job.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : null;
  }, { r: runNo, reSrc: JOB_DEFS[JOB].re.source });
  log({ run: runNo, msg: `create: job picked=${created}` });
  // Submit via a direct DOM click (Playwright's click silently no-ops here
  // in the earlier run — the form stayed open with no error). Creation calls
  // vk() (guest-name registration), which is slow through the proxy
  // (api/guest took ~54s in the diag), so wait up to 180s for the form to
  // close, polling #cc-error for a validation message.
  const okState = await page.evaluate(() => { const b = document.querySelector('#cc-ok'); return b ? { disabled: b.disabled, text: b.textContent.trim(), name: (document.querySelector('#cc-name') || {}).value || null } : null; });
  log({ run: runNo, msg: `create submit state: ${JSON.stringify(okState)}` });
  await page.evaluate(() => { const b = document.querySelector('#cc-ok'); if (b) b.click(); });
  let createdOk = false, nameTries = 0;
  for (let waited = 0; waited < 180000; waited += 5000) {
    const st = await page.evaluate(() => {
      const form = document.querySelector('#charcreate');
      const err = document.querySelector('#cc-error');
      return { formHidden: !form || form.classList.contains('hidden'), err: err ? err.textContent.trim() : null };
    }).catch(() => ({}));
    if (st.err) {
      log({ run: runNo, msg: `create error: ${st.err}` });
      // Name-taken is retryable: pick a fresh random name and resubmit.
      if (/taken/i.test(st.err) && nameTries < 3) {
        nameTries++;
        await page.evaluate(() => { const n = document.querySelector('#cc-name'); if (n) { n.value = 'Bot' + Math.random().toString(36).slice(2, 7) + Date.now() % 1000; n.dispatchEvent(new Event('input', { bubbles: true })); } const b = document.querySelector('#cc-ok'); if (b) b.click(); });
        log({ run: runNo, msg: `name taken — retry ${nameTries} with a fresh name` });
      } else if (!/taken/i.test(st.err)) { break; }
    }
    if (st.formHidden) { createdOk = true; log({ run: runNo, msg: `character created — form closed after ~${waited / 1000}s` }); break; }
    await page.waitForTimeout(5000);
  }
  if (!createdOk) { log({ run: runNo, msg: 'character creation did not complete within 180s (form still open)' }); await shot(page, `r${runNo}-create-stuck`); return false; }
  await page.waitForTimeout(2000);
  await shot(page, `r${runNo}-after-create`);
  // After creation we are either back at charselect with the new character
  // selected, or already in the plaza. If back at charselect, press Play.
  const stillSelect = await page.evaluate(() => { const el = document.querySelector('#charselect'); return !!el && !el.classList.contains('hidden'); }).catch(() => false);
  if (stillSelect) {
    const slots2 = await page.evaluate(() => [...document.querySelectorAll('#slots > *')].map(el => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 120)));
    log({ run: runNo, msg: `after create, slots: ${JSON.stringify(slots2)}` });
    const picked2 = await page.evaluate((reSrc) => {
      const els = [...document.querySelectorAll('#slots > *')];
      const hit = els.find(e => (new RegExp(reSrc, 'i').test(e.textContent) || /^bot/i.test(e.textContent)) && !/empty slot/i.test(e.textContent));
      if (hit) { hit.click(); return hit.textContent.replace(/\s+/g, ' ').trim().slice(0, 120); } return null;
    }, JOB_DEFS[JOB].re.source);
    log({ run: runNo, msg: `after create, selected: ${picked2}` });
    await page.waitForTimeout(800); log({ run: runNo, msg: `btn-play click: ${JSON.stringify(await domClick(page, '#btn-play'))}` });
  }
  await page.waitForTimeout(1500);
  return true;
}
async function readPlaza(page) {
  return page.evaluate(() => {
    if (typeof window.__RO_PLAZA_SNAPSHOT__ === 'function') { try { return window.__RO_PLAZA_SNAPSHOT__(); } catch (e) { return { ok: false, error: String(e) }; } }
    return null;
  }).catch(e => ({ ok: false, error: String(e) }));
}

// Prontera plaza -> Prontera stage, via the Expedition Captain NPC.
// The captain is an NPC in the plaza (addNpc "captain", talk range Eu=170,
// Space/Enter talks to the nearest NPC). The bot steers the plaza player to
// him using the exact plaza snapshot (__RO_PLAZA__), then talks, then picks
// Prontera in the Expeditions window. No blind wandering.
// FIX (2026-11-10): the stages-open signal from readHud alone is unreliable —
// in smoke6 the plaza snapshot showed overlays=["stages"] while
// readHud().stagesOpen stayed false, so the bot kept re-talking to the
// captain for the full 180s instead of picking a stage. Trust EITHER signal.
async function stagesOpenNow(page) {
  const hud = await readHud(page);
  if (hud.stagesOpen) return { via: 'hud', hud };
  const pz = await readPlaza(page);
  if (pz && pz.ok && pz.overlays && pz.overlays.includes('stages')) return { via: 'plaza-overlays', hud, pz };
  return { via: null, hud, pz };
}
const STAGE_MATCH = {
  prontera: /prontera/i,
  sewer: /culvert|alcantarilla|sewer/i,
  culvert: /culvert|alcantarilla|sewer/i,
  sunken: /sunken|hundido/i,
  byalan: /byalan/i,
  payon_forest: /payon.?forest|forest/i,
  payon_cave: /payon.?cave|cave/i,
};
// v4: stageKey selects which stage card to pick (prontera default;
// sewer = Culverts Lv 9-12, sunken = Sunken Ship Lv 11-15 for the ladder).
// ---- party play ---------------------------------------------------------
// The game supports party expeditions: the leader proposes a trip from the
// captain and every member accepts it. Party work needs the game's realtime
// socket (the lobby, the invitations and the trip all travel over it), so
// when the socket is unavailable the bot says so and plays solo.
const PARTY = argv.party === 'true';
const ALLY = String(argv.ally || '').trim();
async function partyState(page) {
  return await page.evaluate(() => {
    const p = window.__RO_PLAZA__;
    if (!p) return null;
    return {
      net: !!p.net,
      status: p.status || '',
      inParty: !!p.party,
      leader: p.isPartyLeader ? !!p.isPartyLeader() : false,
      members: p.partyMembers ? p.partyMembers().length : 0,
      partyAsk: !!p.partyAsk,
      tripAsk: !!p.tripAsk,
    };
  }).catch(() => null);
}
// Click a button in the game's dialog by its label (the game writes its UI
// through the same Ae() helper, so the buttons live in #npc-dialog).
async function clickDialogButton(page, labelRe) {
  return await page.evaluate((reSrc) => {
    const re = new RegExp(reSrc, 'i');
    const dlg = document.getElementById('npc-dialog');
    if (!dlg || dlg.classList.contains('hidden')) return false;
    const btn = [...dlg.querySelectorAll('button')].find(b => re.test((b.textContent || '').trim()));
    if (!btn) return false;
    btn.click();
    return true;
  }, labelRe).catch(() => false);
}
// Wait for the game's party invitation dialog and accept it.
async function acceptPartyInvite(page, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const st = await partyState(page);
    if (st && st.partyAsk) {
      if (await clickDialogButton(page, '^(Aceptar|Accept)$')) { log({ msg: 'party: accepted the invitation' }); return true; }
    }
    await page.waitForTimeout(1000);
  }
  return false;
}
// Wait for the trip the leader proposed and accept it.
async function acceptTripAsk(page, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const st = await partyState(page);
    if (st && st.tripAsk) {
      if (await clickDialogButton(page, '^(Aceptar|Accept|Listo|Ready|Voy|Go)$')) { log({ msg: 'party: accepted the trip' }); return true; }
    }
    await page.waitForTimeout(1000);
  }
  return false;
}
// Leader side: invite a named partner from the lobby's friend list.
async function inviteAlly(page, name) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, .ro-btn')].find(b => /^(Friends|Party|Grupo|Amigos)$/i.test((b.textContent || '').trim()));
    if (btn) btn.click();
  }).catch(() => {});
  await page.waitForTimeout(1200);
  const done = await page.evaluate((n) => {
    const panel = document.getElementById('lobby-friends') || document.getElementById('friends');
    if (!panel) return false;
    const want = String(n).toLowerCase();
    const leaf = [...panel.querySelectorAll('*')].find(e => e.children.length === 0 && (e.textContent || '').trim().toLowerCase() === want);
    if (!leaf) return false;
    const row = leaf.closest('button, li, .fr, .row, .friend') || leaf;
    row.click();
    return true;
  }, name).catch(() => false);
  if (done) log({ msg: `party: invited ${name}` });
  else log({ msg: `party: ${name} was not in the friend list (not online?)` });
  return done;
}
async function enterStage(page, runNo, stageKey) {
  const stageRe = STAGE_MATCH[stageKey] || STAGE_MATCH.prontera;
  const onSelect = await page.evaluate(() => { const el = document.querySelector('#charselect'); return !!el && !el.classList.contains('hidden'); }).catch(() => false);
  if (onSelect) { log({ run: runNo, msg: 'still on character select — did not enter the plaza, aborting stage entry' }); await shot(page, `r${runNo}-still-charselect`); return false; }
  const onCreate = await page.evaluate(() => { const el = document.querySelector('#charcreate'); return !!el && !el.classList.contains('hidden'); }).catch(() => false);
  if (onCreate) { log({ run: runNo, msg: 'still on the Create character form — character was not created, aborting stage entry' }); await shot(page, `r${runNo}-still-charcreate`); return false; }
  // Party play: get into a party before the captain conversation. Without the
  // game's realtime socket there is no lobby, no invitation and no trip, so
  // the bot says so and continues solo.
  let partyMember = false;
  if (PARTY) {
    // The plaza object only exists once the character is in town.
    let pst = null;
    for (let waited = 0; waited < 90000; waited += 2000) {
      pst = await partyState(page);
      if (pst) break;
      await page.waitForTimeout(2000);
    }
    if (!pst) log({ run: runNo, msg: 'party: the plaza never came up — solo play' });
    else if (!pst.net) log({ run: runNo, msg: 'party: the game server socket is unavailable (offline) — solo play' });
    else {
      if (!pst.inParty || pst.members < 2) {
        if (ALLY) { await inviteAlly(page, ALLY); await page.waitForTimeout(6000); }
        else { await acceptPartyInvite(page, 45); }
        const now = await partyState(page);
        if (now && now.inParty && now.members >= 2) log({ run: runNo, msg: `party: joined (${now.members} member(s), leader=${now.leader})` });
        else log({ run: runNo, msg: 'party: no party formed — solo play' });
      }
      const cur = await partyState(page);
      // A party only counts when it really has members: with the socket
      // down the plaza still holds an empty party object.
      if (cur && cur.inParty && cur.members >= 2) {
        partyMember = !cur.leader;
        log({ run: runNo, msg: `party: ${cur.leader ? 'leading' : 'following the leader'} (${cur.members} members, status=${cur.status})` });
      } else {
        log({ run: runNo, msg: `party: no party (status=${cur ? cur.status : '?'} net=${cur ? cur.net : '?'} members=${cur ? cur.members : '?'}) — solo play` });
      }
    }
  }
  const mover = new Mover(page);
  const deadline = Date.now() + 180000;
  let loggedPlaza = false, loggedStagesDiag = false;
  while (Date.now() < deadline) {
    const chk = await stagesOpenNow(page);
    if (chk.via) {
      if (chk.via === 'plaza-overlays' && !loggedStagesDiag) {
        loggedStagesDiag = true;
        const diag = await page.evaluate(() => { const el = document.querySelector('#stages'); const cs = el ? getComputedStyle(el) : null; return el ? { cls: el.className, display: cs.display, visibility: cs.visibility, cards: document.querySelectorAll('#stg-list .stg-card').length, goDisabled: (document.querySelector('#stg-go') || {}).disabled ?? null, goHidden: (document.querySelector('#stg-go') || { classList: { contains: () => null } }).classList.contains('hidden') } : null; }).catch(() => null);
        log({ run: runNo, msg: `DIAG stages open via plaza overlays but NOT via readHud: ${JSON.stringify(diag)}` });
      }
      log({ run: runNo, msg: `stages overlay open (via ${chk.via}) — going to stage selection` });
      break;
    }
    const hud = chk.hud;
    if (hud.hudVisible) break; // already in a run
    // Must come before the NPC-dialog branch below: the lobby picker lives in
    // the same #npc-dialog, and its only #npc-options button plays offline.
    if (await ensureLobby(page)) continue;
    if (hud.npcDialog) {
      const acted = await page.evaluate(() => {
        const opts = [...document.querySelectorAll('#npc-options button, #npc-options > *')].filter(e => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && !/sin conexi|offline/i.test(e.textContent || ''); });
        const hit = opts.find(e => /expedici|stage|viajar|partir|prontera|salir/i.test(e.textContent)) || opts[0];
        if (hit) { hit.click(); return hit.textContent.trim().slice(0, 80); } return null;
      });
      log({ run: runNo, msg: `npc dialog: ${acted ? 'chose "' + acted + '"' : 'no option, pressing Space'}` });
      if (!acted) await page.keyboard.press('Space');
      await page.waitForTimeout(1200); continue;
    }
    const pz = chk.pz || await readPlaza(page);
    // Character inventory feed (equipment + backpack) — the plaza snapshot
    // carries it, so it is written for the GUI's live inventory panel.
    if (pz && pz.char && pz.char.ok) {
      lastCharData = pz.char;
      try {
        const target = path.join(OUT, 'inventory.json');
        const tmp = `${target}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ at: Date.now(), ...pz.char }));
        fs.renameSync(tmp, target);
      } catch {}
    }
    if (!pz && !hud.hudVisible) {
      const captainPrompt = await page.evaluate(() => {
        const prompt = document.querySelector('#lobby-prompt');
        return prompt && prompt.getClientRects().length && /talk to the captain/i.test(prompt.textContent) ? prompt.textContent.trim() : null;
      }).catch(() => null);
      if (captainPrompt) {
        await mover.releaseAll();
        log({ run: runNo, msg: `plaza snapshot unavailable; using visible captain prompt: ${captainPrompt}; pressing Space` });
        await page.keyboard.press('Space');
        await page.waitForTimeout(1000);
        continue;
      }
    }
    if (pz && pz.ok) {
      if (!loggedPlaza) { loggedPlaza = true; log({ run: runNo, msg: `plaza snapshot: player=(${pz.player.x},${pz.player.y}) npcs=${pz.npcs.map(n => n.id + '@' + n.x + ',' + n.y).join(' ')}` }); await shot(page, `r${runNo}-plaza`); }
      // Stages already open (seen via plaza overlays) — stop talking to the
      // captain and go straight to stage selection; pressing more keys here
      // only toggles/closes things (the smoke6 failure loop).
      if (pz.overlays && pz.overlays.includes('stages')) { log({ run: runNo, msg: 'stages already open per plaza snapshot — breaking to stage selection' }); break; }
      const cap = pz.npcs.find(n => n.id === 'captain');
      if (!cap) { log({ run: runNo, msg: 'plaza snapshot has no captain NPC yet — waiting' }); await page.waitForTimeout(2000); continue; }
      const dx = cap.x - pz.player.x, dy = cap.y - pz.player.y, d = Math.hypot(dx, dy);
      // Trust the game's own talk range (pz.near): inside a lobby the chat box
      // can hold focus, so WASD is swallowed and the character never moves —
      // that is how the bot sat at 148px from the captain for the full 180s.
      if (d < 120 || pz.near === 'captain') {
        await mover.releaseAll();
        log({ run: runNo, msg: `at captain (${Math.round(d)}px, near=${pz.near}, overlays=${JSON.stringify(pz.overlays)}, focus=${pz.activeTag}) — blurring focus, then Space` });
        await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
        await page.keyboard.press('Space');
        await page.waitForTimeout(1500);
        let chk2 = await stagesOpenNow(page);
        if (chk2.hud.npcDialog || chk2.via) continue;
        log({ run: runNo, msg: `Space did not open dialog — trying Enter` });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
        chk2 = await stagesOpenNow(page);
        if (chk2.hud.npcDialog || chk2.via) continue;
        // Mouse path (the game's own click-to-talk): click the captain's
        // screen position — moveTo() sets talkTo when the click lands within
        // 60 world units of an NPC and fires onTalk() when close.
        if (cap.screen) {
          log({ run: runNo, msg: `keys did not talk — clicking captain at screen (${cap.screen.x},${cap.screen.y})` });
          await page.mouse.click(cap.screen.x, cap.screen.y + 30);
          await page.waitForTimeout(2500);
          chk2 = await stagesOpenNow(page);
          if (chk2.hud.npcDialog || chk2.via) continue;
          log({ run: runNo, msg: `canvas click did not open dialog either — retrying loop` });
        } else {
          log({ run: runNo, msg: `no screen coords for captain — retrying loop` });
        }
        await page.waitForTimeout(1000);
        continue;
      }
      // A focused chat input eats WASD; drop focus before steering.
      await page.evaluate(() => { const a = document.activeElement; if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName)) a.blur(); }).catch(() => {});
      await mover.setVec(dx / d, dy / d);
      await page.waitForTimeout(300);
      continue;
    }
    // No plaza snapshot yet (plaza still loading) — wait.
    await page.waitForTimeout(2000);
  }
  await mover.releaseAll();
  const chkEnd = await stagesOpenNow(page);
  const hudEnd = chkEnd.hud;
  if (!chkEnd.via && !hudEnd.hudVisible) { log({ run: runNo, msg: 'FAILED to reach stages/run from plaza within 180s' }); await shot(page, `r${runNo}-plaza-failed`); return false; }
  if (chkEnd.via) {
    // Dump the real stage list before picking (card classes/select state).
    const listDump = await page.evaluate(() => [...document.querySelectorAll('#stg-list .stg-card')].map((c, i) => ({ i, cls: c.className, disabled: c.disabled, text: c.textContent.replace(/\s+/g, ' ').trim().slice(0, 90) }))).catch(() => null);
    log({ run: runNo, msg: `stages list (${(listDump || []).length} cards): ${JSON.stringify(listDump)}` });
    const stage = await page.evaluate((reSrc) => {
      const cards = [...document.querySelectorAll('#stg-list .stg-card')];
      const re = new RegExp(reSrc, 'i');
      const hit = cards.find(c => re.test(c.textContent));
      if (!hit) return null;
      const txt = hit.textContent.replace(/\s+/g, ' ').trim();
      hit.click();
      return { text: txt.slice(0, 120), locked: /locked|bloqueado/i.test(txt), cls: hit.className };
    }, stageRe.source);
    log({ run: runNo, msg: `stages open, picked [${stageKey}]: ${JSON.stringify(stage)}` });
    if (!stage) { log({ run: runNo, msg: `stage ${stageKey} NOT FOUND in stages list — aborting entry` }); return false; }
    if (stage.locked) { log({ run: runNo, msg: `stage ${stageKey} is LOCKED (${stage.text}) — ladder stops here` }); return false; }
    await page.waitForTimeout(800); await shot(page, `r${runNo}-stages`);
    const goState = await page.evaluate(() => { const b = document.querySelector('#stg-go'); return b ? { disabled: b.disabled, hidden: b.classList.contains('hidden'), text: b.textContent.trim() } : null; }).catch(() => null);
    log({ run: runNo, msg: `stg-go state before click: ${JSON.stringify(goState)}` });
    log({ run: runNo, msg: `stg-go click: ${JSON.stringify(await domClick(page, '#stg-go'))}` });
    // Fail fast if the run does not start: wait up to 20s for the run HUD
    // or the exposed run object; if neither appears, dump and abort
    // instead of burning the whole 180s play loop with no state.
    // "Set out" does NOT start the run directly: it closes the stages
    // window and opens a Difficulty dialog (rendered inside #npc-dialog)
    // with Cancel / "Go to the …" — the run only starts after confirming
    // there (found in fix1, 13:18:43). So wait up to 40s, and confirm the
    // dialog whenever it appears.
    let started = false, loggedDiff = false;
    for (let w = 0; w < 40000; w += 2000) {
      await page.waitForTimeout(2000);
      const liveState = await readState(page);
      if (isLiveRunState(liveState)) {
        started = true;
        log({ run: runNo, msg: `run started after ~${(w + 2000) / 1000}s (state=${liveState.state} stage=${liveState.stage})` });
        break;
      }
      // Party member: the leader's trip has to be accepted before the run
      // starts for this character.
      if (partyMember) await acceptTripAsk(page, 2);
      const dlg = await page.evaluate(() => {
        const d = document.querySelector('#npc-dialog');
        if (!d || d.classList.contains('hidden')) return null;
        const name = (document.querySelector('#npc-name') || {}).textContent || '';
        const text = (d.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500);
        const btns = [...d.querySelectorAll('button')].map(b => ({ text: b.textContent.trim().slice(0, 60), disabled: b.disabled, hidden: b.classList.contains('hidden') }));
        return { name, text, btns };
      }).catch(() => null);
      if (dlg) {
        if (!loggedDiff) { loggedDiff = true; log({ run: runNo, msg: `difficulty dialog: ${JSON.stringify(dlg)}` }); }
        // Re-entering a map that still holds an abandoned run offers Resume/Discard;
        // resume would restore the old difficulty, so discard and start fresh.
        if (/Unfinished run/i.test(dlg.text)) {
          const discarded = await page.evaluate(() => {
            const d = document.querySelector('#npc-dialog');
            const hit = [...(d?.querySelectorAll('button') || [])].find(b => /discard/i.test(b.textContent) && !b.disabled && !b.classList.contains('hidden'));
            if (!hit) return null;
            hit.click();
            return hit.textContent.trim().slice(0, 60);
          }).catch(() => null);
          if (discarded) {
            log({ run: runNo, msg: `discarded the unfinished run ("${discarded}"); starting a fresh one` });
            continue;
          }
        }
        if (MAX_LOOT) {
          const maxed = await page.evaluate(() => {
            const d = document.querySelector('#npc-dialog');
            if (!d) return null;
            const inputs = [...d.querySelectorAll('.diff input[data-key]')];
            if (!inputs.length) return { inputs: 0 };
            for (const inp of inputs) {
              inp.value = inp.max;
              inp.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return {
              inputs: inputs.length,
              values: inputs.map(i => `${i.dataset.key}=${i.value}`),
              loot: (d.querySelector('[data-out="drop"]') || {}).textContent || null,
            };
          }).catch(() => null);
          if (maxed && maxed.inputs) log({ run: runNo, msg: `MAX-LOOT: difficulty sliders at max (${maxed.values.join(',')}) loot ${maxed.loot}` });
        }
        const goBtn = await page.evaluate(() => {
          const d = document.querySelector('#npc-dialog');
          if (!d) return null;
          const btns = [...d.querySelectorAll('button')].filter(b => !b.disabled && !b.classList.contains('hidden'));
          const hit = btns.find(b => /go to|go!|start|depart|set out|comenzar|partir|confirm|accept/i.test(b.textContent));
          if (hit) { hit.click(); return hit.textContent.trim().slice(0, 60); } return null;
        }).catch(() => null);
        if (goBtn) log({ run: runNo, msg: `difficulty dialog: clicked "${goBtn}"` });
      }
    }
    if (!started) {
      const dump = await page.evaluate(() => ({ stagesHidden: (document.querySelector('#stages') || { classList: { contains: () => null } }).classList.contains('hidden'), overlays: [...document.querySelectorAll('.overlay:not(.hidden)')].map(e => e.id), bodyText: document.body.innerText.slice(0, 400) })).catch(() => null);
      log({ run: runNo, msg: `stg-go did NOT start a run within 40s: ${JSON.stringify(dump)}` });
      await shot(page, `r${runNo}-stage-start-failed`);
      return false;
    }
  }
  return true;
}

// After a stage clear the game shows loot/end screens, then returns to
// the plaza (or character select). Poll for the plaza snapshot; click
// through end screens with generic continue buttons. Returns true once
// the plaza snapshot is live.
async function returnToPlaza(page, runNo) {
  for (let w = 0; w < 120000; w += 3000) {
    const pz = await readPlaza(page).catch(() => null);
    if (pz && pz.ok) { log({ run: runNo, msg: `back in plaza after ~${w / 1000}s (player ${pz.player.x},${pz.player.y})` }); return true; }
    const st = await page.evaluate(() => {
      const vis = s => { const el = document.querySelector(s); return !!el && !el.classList.contains('hidden'); };
      return { charselect: vis('#charselect'), hud: vis('#hud'), overlays: [...document.querySelectorAll('.overlay:not(.hidden)')].map(e => e.id) };
    }).catch(() => ({}));
    if (st.charselect) {
      log({ run: runNo, msg: 'returnToPlaza: on character select — pressing Play to re-enter plaza' });
      await domClick(page, '#btn-play'); await page.waitForTimeout(3000); continue;
    }
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => !b.disabled && !b.classList.contains('hidden') && b.getBoundingClientRect().width > 0);
      const hit = btns.find(b => /plaza|return|continue|volver|salir|close|cerrar|accept|aceptar|ok|reclamar|claim/i.test(b.textContent || ''));
      if (hit) { hit.click(); return (hit.textContent || '').trim().slice(0, 60); } return null;
    }).catch(() => null);
    if (clicked) log({ run: runNo, msg: `returnToPlaza: clicked "${clicked}" (overlays=${JSON.stringify(st.overlays)})` });
    else await page.keyboard.press('Space');
    await page.waitForTimeout(3000);
  }
  log({ run: runNo, msg: 'returnToPlaza FAILED within 120s — ladder stops here' });
  await shot(page, `r${runNo}-no-plaza`);
  return false;
}

// v6.2 DEATH DIAGNOSIS: attribute the HP lost in the last 8 game-seconds
// before death to skill zones vs contact damage, from the rolling buffer.
// A tick's HP loss counts as skill damage when the player stood inside a
// live AoE zone (fireRing/fxAnchor) as it dropped, contact when no zone
// covered the player and the nearest enemy was < 60px, else other.
// Verdict SKILL-OVERLAP = Araso's diagnosis; PACK-CONTACT = the v6 one.
// Preview frame rate: set per page while a run is going (see runOneWithPage).
let setStreamRate = null;
// Persistent and Camoufox workers reuse one page between runs. Keep the first
// homepage/login load separate from later Results/Town -> Character Select
// recovery so every death does not download the whole game again.
const persistentPageRunState = new WeakMap();

async function resetToCharacterSelect(page, runNo) {
  for (let waited = 0; waited < 120000; waited += 1000) {
    const state = await page.evaluate(() => {
      const visible = el => !!el && !el.classList.contains('hidden') && el.getBoundingClientRect().width > 0;
      const charselect = document.querySelector('#charselect');
      const gameover = document.querySelector('#gameover');
      const plaza = typeof window.__RO_PLAZA_SNAPSHOT__ === 'function' && !!window.__RO_PLAZA_SNAPSHOT__()?.ok;
      return { charselect: visible(charselect), gameover: visible(gameover), plaza };
    }).catch(() => ({ charselect: false, gameover: false, plaza: false }));
    if (state.charselect) {
      log({ run: runNo, msg: 'reusing page: character select ready after previous run' });
      return true;
    }
    if (state.gameover) {
      const clicked = await page.evaluate(() => {
        const overlay = document.querySelector('#gameover');
        const buttons = [...(overlay?.querySelectorAll('button') || [])].filter(b => !b.disabled && !b.classList.contains('hidden') && b.getBoundingClientRect().width > 0);
        const hit = document.querySelector('#btn-restart') || buttons.find(b => /back to character|return to town|town|continue|return|close|ok/i.test(b.textContent || ''));
        if (!hit || hit.disabled || hit.classList.contains('hidden')) return null;
        hit.click();
        return (hit.textContent || '').trim().slice(0, 60);
      }).catch(() => null);
      if (clicked) log({ run: runNo, msg: `reusing page: left Results via "${clicked}"` });
    } else if (state.plaza) {
      const clicked = await page.evaluate(() => {
        const hit = document.querySelector('#lobby-switch') || [...document.querySelectorAll('button, [data-act]')].find(b => /switch\s+character/i.test(b.textContent || '') && b.getBoundingClientRect().width > 0);
        if (!hit) return false;
        hit.click();
        return true;
      }).catch(() => false);
      if (clicked) log({ run: runNo, msg: 'reusing page: town -> switch character' });
    } else {
      await page.keyboard.press('Space').catch(() => {});
    }
    await page.waitForTimeout(1000);
  }
  log({ run: runNo, msg: 'WARN could not return to character select without reloading' });
  return false;
}

async function playRun(page, runNo) {
  if (typeof setStreamRate === 'function') setStreamRate(true);
  const mover = new Mover(page);
  const start = Date.now();
  const stats = { picks: 0, pickLog: [], skippedLog: [], cause: null, maxLevel: 1, maxKills: 0, lastHp: null, hpMin: 1, hpMinAt: null, snapSamples: [], stateSeen: false, noStateTicks: 0, liveSnapSaved: false, startGameTime: null, endGameTime: null, startExp: 0, endExp: 0, totalExpGained: 0, expSamples: [], stuckEscapes: 0, walkReroutes: 0, walkRouteMisses: 0, modes: {}, maxLive: 0, timeAbove40: 0, timeAbove55: 0, timeAbove100: 0, bossFights: [], bossBrainDumped: {}, bossKillTimes: {}, cleared: false, mvpKilled: null, dmgBy: {}, killsBy: {}, closeAt: null, lootUntil: null, timeUp: null, pickDedupe: {}, phantomPicks: 0, _lastT: null, _overtimeLogged: false, _closeLogged: false, dodge: { triggers: 0, hard: 0, castsExposed: 0 }, meat: { rescuesAttempted: 0, rescuesSucceeded: 0, rescuesDenied: 0, meatEaten: 0, _lastMeatCount: null, _rescueKey: null, _lastHp: null, _rescueActive: false },
    thin: { prethinEntries: 0, breakouts: 0, atSpawn: {}, _lastMode: null }, // v6.2
    death: { buf: [], _prevHp: null, diag: null }, // v6.2: skill-overlap vs pack diagnosis
    // v5 LOOT metrics (see ../loot-spec.md §8). gemExp = cumulative EXP gained
    // (gems are the only regular EXP source; +30 for an empty chest also lands
    // here). zenyEarned = end zeny + zeny spent on chests. lootPerMin =
    // (gemExp + zenyEarned + 100*chests + 200*(gear+cards+eggs)) / game-min.
    loot: { gemExp: 0, zenyEnd: 0, zenyEarned: 0, chestSpend: 0, chestsOpened: 0, gear: 0, cards: 0, eggs: 0, mobLoot: 0, _prevExp: null, _prevLevel: null, _prevExpNext: null, _prevChests: 0, _bossLootAtSpawn: {} } };
  const steerState = { orbitDir: 1, orbitFlipAt: 0, lastPos: null, lastPosAt: 0, stuckSince: null, escapeUntil: 0, escapeDir: null, ranged: JOB_DEFS[JOB].ranged, prevReady: null, skillReadyAt: {}, dodges: 0, hardDodges: 0, castsExposed: 0, rescueDenied: 0, rescuesAttempted: 0 };
  let pickerOpenedAt = null, pickerCards = 0, lastPickerKey = null, lastLog = 0, lastSample = 0, lastShot = 0, lastDashboardShot = 0;
  while (Date.now() - start < MAX_SECONDS * 1000) {
    const now = Date.now(); const elapsedS = Math.floor((now - start) / 1000);
    if (now - lastDashboardShot >= 5000) {
      lastDashboardShot = now;
      await captureDashboard(page);
    }
    const hud = await readHud(page);
    const s = await readState(page);
    if (!s || !s.ok) await mover.releaseAll();
    if (s && s.ok) {
      stats.stateSeen = true;
      stats.maxLevel = Math.max(stats.maxLevel, s.level); stats.maxKills = Math.max(stats.maxKills, s.kills); stats.lastHp = s.hp / s.maxHp;
      if (s.hp / s.maxHp < stats.hpMin) { stats.hpMin = s.hp / s.maxHp; stats.hpMinAt = s.time; }
      if (stats.startGameTime == null) { stats.startGameTime = s.time; stats.startExp = s.exp; }
      stats.endGameTime = s.time; stats.endExp = s.exp;
      // v4 density ledger: game-time spent above the anti-encirclement lines.
      if (stats._lastT != null) { const dt = Math.max(0, s.time - stats._lastT); if (s.enemies.length >= 40) stats.timeAbove40 += dt; if (s.enemies.length >= 55) stats.timeAbove55 += dt; if (s.enemies.length >= 100) stats.timeAbove100 += dt; }
      stats._lastT = s.time;
      stats.maxLive = Math.max(stats.maxLive, s.enemies.length);
      if (s.timeUp) stats.timeUp = s.timeUp; if (s.closeAt) stats.closeAt = s.closeAt; if (s.lootUntil) stats.lootUntil = s.lootUntil;
      if (s.dmgBy) stats.dmgBy = s.dmgBy; if (s.killsBy) stats.killsBy = s.killsBy;
      // v5 loot ledger (every snapshot tick).
      { const L = stats.loot;
        if (L._prevExp == null) { L._prevExp = s.exp; L._prevLevel = s.level; L._prevExpNext = s.expNext; L._prevChests = s.chestsOpened || 0; }
        else {
          if (s.level > L._prevLevel) L.gemExp += Math.max(0, (L._prevExpNext - L._prevExp) + s.exp);
          else if (s.exp >= L._prevExp) L.gemExp += s.exp - L._prevExp;
          L._prevExp = s.exp; L._prevLevel = s.level; L._prevExpNext = s.expNext;
        }
        const ch = s.chestsOpened || 0;
        if (ch > L._prevChests) { for (let n = L._prevChests; n < ch; n++) L.chestSpend += Math.round(30 + 25 * n + 1.5 * n * n); L._prevChests = ch; }
        L.chestsOpened = ch; L.zenyEnd = s.zeny || 0; L.zenyEarned = L.zenyEnd + L.chestSpend;
        L.gear = (s.runLoot || []).length; L.cards = (s.runCards || []).length; L.eggs = (s.runEggs || []).length; L.mobLoot = s.mobLoot || 0;
      }
      if (s.timeUp && !stats._closeLogged) { stats._closeLogged = true; log({ run: runNo, msg: `run timing: timeUp=${s.timeUp}s closeAt=${s.closeAt} lootUntil=${s.lootUntil} stage=${s.stage} bossSchedule=${JSON.stringify(mapBossTimes(s))}` }); }
      // v6.2 DEATH DIAGNOSIS: rolling 8-game-second buffer of what was
      // hurting us — live AoE zones overlapped, skills about to fire,
      // nearest enemy, HP deltas. On death this proves skill-overlap vs
      // pack-contact instead of asserting either. Zones = fireRings ONLY
      // (fxAnchors are damage numbers/visuals, not telegraphs — counting
      // them polluted the first smoke diagnosis).
      const _zonesNow = (s.fireRings || []).filter(r => Math.hypot(s.player.x - r.x, s.player.y - r.y) < r.r).length;
      const _nearNow = s.enemies.reduce((m, e) => Math.min(m, Math.hypot(e.x - s.player.x, e.y - s.player.y)), Infinity);
      const _immNow = [];
      for (const bb of s.bossBrains || []) (bb.skills || []).forEach((sk, i) => { if (bb.ready && bb.ready[i] != null && bb.ready[i] <= 0.5) _immNow.push(bb.boss + ':' + sk.name); });
      const _dhp = stats.death._prevHp == null ? 0 : s.hp - stats.death._prevHp;
      stats.death.buf.push({ t: s.time, hp: s.hp, dhp: _dhp, zones: _zonesNow, nearest: _nearNow === Infinity ? null : Math.round(_nearNow), imminent: _immNow });
      while (stats.death.buf.length > 1 && s.time - stats.death.buf[0].t > 8) stats.death.buf.shift();
      stats.death._prevHp = s.hp;
      // Boss tracking: first sight per boss id -> dump bossBrains (attack
      // patterns from the bundle, live) + record the fight; kill = boss
      // disappears from the live lists. mvpsKilled confirms Mastering.
      for (const bb of s.bossBrains || []) {
        if (!stats.bossBrainDumped[bb.boss]) {
          stats.bossBrainDumped[bb.boss] = true;
          stats.bossFights.push({ boss: bb.boss, spawnT: Math.round(s.time * 10) / 10, hpMax: bb.maxHp, skills: bb.skills, killT: null, hpStart: s.hp, hpMin: s.hp, hpEnd: null, dmgDealt: null, lastBossHp: bb.maxHp, castsStart: steerState.castsExposed || 0, dodgesStart: steerState.dodges || 0, castsExposed: null, dodges: null, maxZones: _zonesNow });
          // v6.2: what did the pack look like when this boss spawned?
          // (the whole point of pre-boss thinning — did we enter thin?)
          const _na = s.enemies.filter(e => !e.boss).reduce((m, e) => Math.min(m, Math.hypot(e.x - s.player.x, e.y - s.player.y)), Infinity);
          stats.thin.atSpawn[bb.boss] = { t: Math.round(s.time), live: s.enemies.length, nearestAdd: _na === Infinity ? null : Math.round(_na) };
          stats.loot._bossLootAtSpawn[bb.boss] = { gear: (s.runLoot || []).length, cards: (s.runCards || []).length, eggs: (s.runEggs || []).length, gemExp: stats.loot.gemExp, zeny: s.zeny || 0 };
          try { fs.writeFileSync(path.join(OUT, `boss-${bb.boss}-${Math.round(s.time)}s.json`), JSON.stringify({ t: s.time, brain: bb }, null, 2)); } catch (e) {}
          log({ run: runNo, msg: `BOSS ${bb.boss} spawned t=${s.time.toFixed(0)}s hp=${bb.maxHp} skills=${(bb.skills || []).map(x => x.name + '(cd' + x.cd + '/r' + x.range + ')').join(', ')} thinAtSpawn=${JSON.stringify(stats.thin.atSpawn[bb.boss])}` });
        }
      }
      for (const f of stats.bossFights) {
        if (f.killT == null) {
          f.hpMin = Math.min(f.hpMin, s.hp);
          f.maxZones = Math.max(f.maxZones || 0, _zonesNow); // v6.2: worst overlap during this fight
          const be = (s.bosses || []).find(b => b.id === f.boss) || (s.enemies || []).find(e => e.id === f.boss);
          if (be) f.lastBossHp = be.hp;
        }
      }
      for (const f of stats.bossFights) {
        if (f.killT == null && !(s.bosses || []).some(b => b.id === f.boss) && !(s.enemies || []).some(e => e.id === f.boss) && s.time > f.spawnT + 5) {
          f.killT = Math.round(s.time * 10) / 10; stats.bossKillTimes[f.boss] = f.killT;
          const b0 = stats.loot._bossLootAtSpawn[f.boss] || { gear: 0, cards: 0, eggs: 0, gemExp: 0, zeny: 0 };
          f.drops = { gear: (s.runLoot || []).length - b0.gear, cards: (s.runCards || []).length - b0.cards, eggs: (s.runEggs || []).length - b0.eggs, gemExp: Math.round(stats.loot.gemExp - b0.gemExp), zeny: (s.zeny || 0) - b0.zeny };
          f.hpEnd = s.hp; f.dmgDealt = f.hpMax - (f.lastBossHp ?? f.hpMax); f.castsExposed = (steerState.castsExposed || 0) - (f.castsStart || 0); f.dodges = (steerState.dodges || 0) - (f.dodgesStart || 0);
          log({ run: runNo, msg: `BOSS ${f.boss} KILLED at t=${f.killT}s (fight lasted ${Math.round(f.killT - f.spawnT)}s game) drops=${JSON.stringify(f.drops)}` });
          log({ run: runNo, msg: `BOSS ${f.boss} FIGHT ECONOMY: hp ${f.hpStart}->${f.hpEnd} (min ${f.hpMin}) dmgDealt=${f.dmgDealt} castsExposed=${f.castsExposed} dodges=${f.dodges}` });
        }
      }
      { const mvps = Array.isArray(s.mvpsKilled) ? s.mvpsKilled.length : (s.mvpsKilled || 0);
        if (mvps > 0 && stats.mvpKilled == null) { stats.mvpKilled = mvps; log({ run: runNo, msg: `MVP KILLED: mvpsKilled=${JSON.stringify(s.mvpsKilled)} at t=${s.time.toFixed(0)}s` }); } }
      const xpTotal = (s.level - 1) * 100 + s.exp; // coarse XP proxy (expNext varies; level is the real signal)
      stats.expSamples.push({ t: s.time, lv: s.level, exp: s.exp, kills: s.kills });
      if (stats.expSamples.length > 400) stats.expSamples.splice(0, 100);
      if (now - lastSample > 15000) { lastSample = now; stats.snapSamples.push({ t: s.time, lv: s.level, hp: s.hp, maxHp: s.maxHp, kills: s.kills, enemies: s.enemies.length, nearest: null, pickups: s.pickups.length, state: s.state, px: s.player.x, py: s.player.y }); }
      if (!stats.liveSnapSaved && s.enemies.length > 0) {
        stats.liveSnapSaved = true;
        log({ run: runNo, msg: `live snapshot active: t=${s.time.toFixed(1)}s enemies=${s.enemies.length} pickups=${s.pickups.length}` });
      }
      // Slim inventory feed for the GUI's live inventory panel. Written
      // every couple of seconds, one file per instance.
      if (s.ok && (!stats.snapFeedAt || now - stats.snapFeedAt > 2000)) {
        stats.snapFeedAt = now;
        try {
          const slim = {
            at: Date.now(), run: runNo, t: s.time, stage: s.stage, state: s.state,
            level: s.level, hp: s.hp, maxHp: s.maxHp, exp: s.exp, expNext: s.expNext,
            kills: s.kills, zeny: s.zeny, chestsOpened: s.chestsOpened,
            mvpsKilled: s.mvpsKilled, bossKills: s.bossKills, mobLoot: s.mobLoot,
            slots: s.slots || [], weapons: s.weapons || [], passives: s.passives || [],
            runCards: s.runCards || [], runLoot: s.runLoot || [], runEggs: s.runEggs || [],
            equip: s.equip || (lastCharData && lastCharData.equipInfo) || null,
            backpack: (lastCharData && lastCharData.inventory) || [],
            charName: (lastCharData && lastCharData.name) || null,
            stats: s.stats || null,
          };
          const target = path.join(OUT, 'snapshot.json');
          const tmp = `${target}.tmp`;
          fs.writeFileSync(tmp, JSON.stringify(slim));
          fs.renameSync(tmp, target);
        } catch {}
      }
    } else if (s === null) { stats.noStateTicks++; }
    // v6 FAIL-FAST (found in Eclipse smoke 2026-11-11): if the snapshot
    // goes away (page navigated / renderer died), readState returns an
    // error object and the loop below spins SILENTLY forever — no status
    // logs, ~0 CPU — until the wall cap. Abort loudly instead.
    if (s && s.ok) stats._lastGoodStateAt = now;
    else {
      if (stats._lastGoodStateAt == null) stats._lastGoodStateAt = now;
      else if (now - stats._lastGoodStateAt > 30000) {
        stats.cause = 'state-lost: no snapshot for 30s (page navigated/crashed?)';
        log({ run: runNo, msg: `STATE LOST: no __RO_SNAPSHOT__ for 30s — aborting run (last good t=${stats.endGameTime != null ? stats.endGameTime.toFixed(1) : '-'}s, noStateTicks=${stats.noStateTicks})` });
        await shot(page, `r${runNo}-state-lost`);
        break;
      }
    }
    if (hud.gameOver) {
      stats.cause = hud.gameOverTitle || 'game over';
      const diag = diagnoseDeath(stats); // v6.2: what actually killed us?
      log({ run: runNo, msg: `RUN OVER: ${stats.cause} — ${hud.gameOverStats || ''}` });
      log({ run: runNo, msg: `DEATH-DIAGNOSIS: ${JSON.stringify(diag)}` });
      log({ run: runNo, msg: `DEATH-BUFFER: ${JSON.stringify(stats.death.buf)}` }); // v6.2: full 8s tick log for post-hoc attribution
      await shot(page, `r${runNo}-gameover`); break;
    }
    if (s && s.ok && s.state === 'over') {
      const won = !!(s.finalBossDefeated || s.lootUntil > 0) && !activeBosses(s).length;
      stats.cleared = won; stats.mvpKilled = s.mvpsKilled;
      stats.cause = won ? 'STAGE CLEAR — endgame pickup sweep ended' : 'stage ended';
      log({ run: runNo, msg: `${won ? 'STAGE CLEAR' : 'STAGE ENDED'}: state=over time=${s.time.toFixed(0)}s pickupsRemaining=${s.pickups.length}` });
      await shot(page, `r${runNo}-${won ? 'clear' : 'ended'}`); break;
    }
    if (s && s.ok && s.timeUp && s.time >= s.timeUp) {
      const liveBosses = activeBosses(s);
      if (!liveBosses.length && victorySweepActive(s)) {
        if (!stats._victoryLootLogged) {
          stats._victoryLootLogged = true;
          log({ run: runNo, msg: `FINAL BOSS DEFEATED: leash removed; targeting nearest Magnet, otherwise nearest pickup` });
        }
      } else if (!liveBosses.length) {
        stats.cause = 'STAGE CLEAR — timeUp reached (' + s.timeUp + 's game time)'; stats.cleared = true; stats.mvpKilled = s.mvpsKilled;
        log({ run: runNo, msg: `STAGE CLEAR: time=${s.time.toFixed(0)}s lv=${s.level} kills=${s.kills} mvpsKilled=${s.mvpsKilled} bossKills=${s.bossKills} chests=${s.chestsOpened}` });
        await shot(page, `r${runNo}-clear`); break;
      } else {
        const closeAt = Number(s.closeAt);
        if (Number.isFinite(closeAt) && closeAt >= 0 && s.time >= closeAt) {
          stats.cause = 'timeUp reached but boss alive at closeAt (' + s.timeUp + 's)'; stats.mvpKilled = s.mvpsKilled;
          log({ run: runNo, msg: `END: timeUp passed, boss ${liveBosses[0].id || '-'} still alive at closeAt — lv=${s.level} kills=${s.kills} mvpsKilled=${s.mvpsKilled}` });
          await shot(page, `r${runNo}-clear-noboss`); break;
        }
        if (!stats._overtimeLogged) { stats._overtimeLogged = true; log({ run: runNo, msg: `OVERTIME: timeUp ${s.timeUp}s passed, boss ${liveBosses[0].id || '-'} still alive (hp ${liveBosses[0].hp}) — continuing until defeat` }); }
      }
    }
    if (hud.paused) { await mover.releaseAll(); await clickVisible(page, '#btn-resume', 3000); await sleep(500); continue; }
    if (hud.story || hud.npcDialog) { await mover.releaseAll(); await page.keyboard.press('Space'); await sleep(600); continue; }
    if ((hud.pickerOpen || (s && s.ok && s.state === 'levelup')) && hud.cards.length) {
      await mover.releaseAll();
      const key = hud.pickerTitle + '|' + hud.cards.map(c => c.text).join('||');
      if (key !== lastPickerKey) { pickerOpenedAt = now; pickerCards = hud.cards.length; lastPickerKey = key; log({ run: runNo, msg: `picker (${hud.pickerTitle || 'level-up'}): ${hud.cards.map(c => c.text.slice(0, 60)).join(' | ')}` }); }
      const unlockAt = pickerOpenedAt + PICKER_UNLOCK_BASE_MS + PICKER_UNLOCK_PER_CARD_MS * pickerCards;
      if (Date.now() < unlockAt) { await sleep(Math.min(unlockAt - Date.now(), 1500)); continue; }
      const ownedSkills = (s && s.ok ? [...(s.slots || []), ...(s.weapons || []), ...(s.passives || [])] : []);
      const _t = (s && s.ok ? s.time : 0);
      const _nextBoss = nextBossTime(s, _t);
      const liveBosses = activeBosses(s);
      const ctx = { hpFrac: (s && s.ok ? s.hp / s.maxHp : 1), level: (s && s.ok ? s.level : 1), elapsedS, ownedSkills, slotsFree: (s && s.ok && s.slots ? Math.max(0, 8 - s.slots.length) : null), job: JOB, pickType: hud.pickType, liveEnemies: (s && s.ok ? s.enemies.length : 0), bossDueIn: (_nextBoss != null ? _nextBoss - _t : null), bossActive: liveBosses.length > 0, zeny: (s && s.ok ? s.zeny : 0), chestsOpened: (s && s.ok ? s.chestsOpened : 0), masteringActive: liveBosses.some(b => /mastering/i.test(b.id || '')), timeToMastering: (s && s.ok ? 720 - s.time : null), bossId: liveBosses.length ? liveBosses[0].id : null };
      const scored = hud.cards.map((c, i) => ({ index: i, ...scoreCard(c.text, ctx), text: c.text }));
      let best = null; scored.forEach(sc => { if (!best || sc.score > best.score) best = sc; });
      const rerollBtn = (hud.perkBtns || []).find(b => /reroll|repetir/i.test(b.text) && !b.disabled);
      const wizardNoPreferred = JOB === 'mage' && scored.every(sc => (sc.hits || []).some(h => h === 'user-priority:random' || h === 'user-banned'));
      if (wizardNoPreferred && rerollBtn && !stats._rerolledThisPicker) {
        stats._rerolledThisPicker = true;
        log({ run: runNo, msg: 'Wizard offer has no preferred card — rerolling once before fallback/banish' });
        await page.evaluate(() => { const b = [...document.querySelectorAll('#picker button, #pk-perks button')].find(x => /reroll|repetir/i.test(x.textContent || '') && !x.disabled); if (b) b.click(); });
        await sleep(900); lastPickerKey = null; pickerOpenedAt = null; continue;
      }
      if (wizardNoPreferred && (stats._rerolledThisPicker || !rerollBtn) && !stats._banishedThisPicker) {
        const banishBtn = (hud.perkBtns || []).find(b => /banish|desterrar/i.test(b.text) && !b.disabled);
        if (banishBtn) {
          stats._banishedThisPicker = true;
          log({ run: runNo, msg: 'Wizard reroll still has no preferred card — using banish before random fallback' });
          await page.evaluate(() => { const b = [...document.querySelectorAll('#picker button, #pk-perks button, .pk-perk')].find(x => /banish|desterrar/i.test(x.textContent || '') && !x.disabled); if (b) b.click(); });
          await sleep(700); lastPickerKey = null; pickerOpenedAt = null; continue;
        }
      }
      // Other jobs: reroll once when every offer is poor and a reroll perk is visible.
      if (best && best.score < 150 && !(best.hits || []).some(h => String(h).startsWith('loot:')) && rerollBtn && !stats._rerolledThisPicker) {
        stats._rerolledThisPicker = true;
        log({ run: runNo, msg: `picker: all offers poor (best ${best.score}) — rerolling once` });
        await page.evaluate(() => { const b = [...document.querySelectorAll('#picker button, #pk-perks button')].find(x => /reroll|repetir/i.test(x.textContent || '') && !x.disabled); if (b) b.click(); });
        await sleep(900); lastPickerKey = null; pickerOpenedAt = null; continue;
      }
      stats._rerolledThisPicker = false;
      stats._banishedThisPicker = false;
      scored.filter(sc => sc !== best).forEach(sc => stats.skippedLog.push({ at: elapsedS, card: sc.text.slice(0, 100), score: sc.score, plan: sc.plan }));
      log({ run: runNo, msg: `picking ${best.index + 1}/${hud.cards.length} score=${best.score} [${best.hits.join(',')}] "${best.text.slice(0, 90)}"` });
      const pickKey = ((s && s.ok ? s.level : '?') + '|' + best.text.slice(0, 80));
      if (stats.pickDedupe[pickKey] != null && now - stats.pickDedupe[pickKey] < 20000) {
        stats.phantomPicks++;
        const diag = await page.evaluate(() => [...document.querySelectorAll('#pk-cards .pk-card')].map(el => ({ cls: el.className, dis: el.disabled }))).catch(() => null);
        log({ run: runNo, msg: `PHANTOM? same level+card ${Math.round((now - stats.pickDedupe[pickKey]) / 1000)}s after last counted pick — pressing again but NOT counting: "${best.text.slice(0, 60)}" cards=${JSON.stringify(diag)}` });
      } else {
        stats.pickDedupe[pickKey] = now; stats.picks++;
        stats.pickLog.push({ at: elapsedS, card: best.text.slice(0, 100), score: best.score, plan: best.plan, hits: best.hits, skipped: scored.filter(sc => sc !== best).map(sc => ({ card: sc.text.slice(0, 60), score: sc.score })) });
      }
      await page.keyboard.press(String(best.index + 1)); await sleep(700);
      const h2 = await readHud(page);
      if (h2.pickerOpen && h2.cards.length && h2.cards.map(c => c.text).join() === hud.cards.map(c => c.text).join()) { await page.keyboard.press('Enter'); await sleep(500); }
      // Wait for the picker to actually close (confirm animation) before
      // looping — otherwise the same open picker is re-logged and re-pressed
      // as a phantom second pick (validation run: 9 logged vs ~6 real).
      for (let w = 0; w < 3000; w += 250) { const h3 = await readHud(page); if (!h3.pickerOpen) break; await sleep(250); }
      lastPickerKey = null; pickerOpenedAt = null; continue;
    }
    // In-run: steer from exact state.
    if (s && s.ok && s.state === 'playing' && !s.player.dead) {
      // Orbit direction flips every 12s of game time (v4.1: less turning, chasers cut chords).
      if (s.time > steerState.orbitFlipAt) { steerState.orbitDir *= -1; steerState.orbitFlipAt = s.time + 12; }
      // Stuck detection: moved <25px in 5s of wall time while enemies are near.
      const nowMs = Date.now();
      if (!steerState.lastPos) { steerState.lastPos = { x: s.player.x, y: s.player.y }; steerState.lastPosAt = nowMs; }
      else if (nowMs - steerState.lastPosAt > 5000) {
        const moved = Math.hypot(s.player.x - steerState.lastPos.x, s.player.y - steerState.lastPos.y);
        if (moved < 25 && s.enemies.length > 0) {
          steerState.stuckSince = (steerState.stuckSince || nowMs);
          if (nowMs - steerState.stuckSince > 0 && nowMs > steerState.escapeUntil) {
            stats.stuckEscapes++;
            // Escape: sample 8 directions, pick the one with fewest enemies
            // within 250px along that ray (pure centroid-away runs into the
            // pack when surrounded). Hold it for 2s.
            let bestDir = null, bestCount = Infinity;
            for (let k = 0; k < 8; k++) {
              const a = k * Math.PI / 4, ux = Math.cos(a), uy = Math.sin(a);
              let cnt = 0;
              for (const e of s.enemies) { const rx = e.x - s.player.x, ry = e.y - s.player.y, d = Math.hypot(rx, ry); if (d < 250 && (rx * ux + ry * uy) / (d || 1) > 0.5) cnt++; }
              if (cnt < bestCount) { bestCount = cnt; bestDir = { dx: ux, dy: uy }; }
            }
            steerState.escapeDir = bestDir; steerState.escapeUntil = nowMs + 2000;
            log({ run: runNo, msg: `STUCK? moved ${Math.round(moved)}px in 5s with ${s.enemies.length} enemies near at (${Math.round(s.player.x)},${Math.round(s.player.y)}) moving=${!!s.player.moving} — escaping (${stats.stuckEscapes})` });
          }
        } else steerState.stuckSince = null;
        steerState.lastPos = { x: s.player.x, y: s.player.y }; steerState.lastPosAt = nowMs;
      }
      let v;
      if (nowMs < steerState.escapeUntil && steerState.escapeDir) { v = { ...steer(s, steerState), dx: steerState.escapeDir.dx, dy: steerState.escapeDir.dy }; }
      else v = steer(s, steerState);
      v = applySpawnLeash(s, v);
      v = await mapAwareVector(page, s, v);
      if (v.walkRouted) stats.walkReroutes++;
      if (v.walkRouteMiss) stats.walkRouteMisses++;
      stats.modes[v.mode] = (stats.modes[v.mode] || 0) + 1;
      // v6.2 thin ledger: log every entry into prethin / breakout once.
      if (v.mode === 'horde-prep' && stats.thin._lastMode !== 'horde-prep') { log({ run: runNo, msg: `HORDE PREP: t=${s.time.toFixed(0)}s next horde in ${v.timeToHorde != null ? Math.round(v.timeToHorde) : '-'}s live=${v.nEnemies} nearest=${v.nearest === Infinity ? '-' : Math.round(v.nearest)} hp=${s.hp}/${s.maxHp}` }); }
      if (v.mode === 'prethin' && stats.thin._lastMode !== 'prethin') { stats.thin.prethinEntries++; log({ run: runNo, msg: `PRETHIN: t=${s.time.toFixed(0)}s next boss in ${v.timeToBoss != null ? Math.round(v.timeToBoss) : '-'}s live=${v.nEnemies} nearestAdd=${v.nearestAdd} hp=${s.hp}/${s.maxHp}` }); }
      if (v.mode === 'breakout' && stats.thin._lastMode !== 'breakout') { stats.thin.breakouts++; log({ run: runNo, msg: `BREAKOUT: t=${s.time.toFixed(0)}s boss=${v.bossId} live=${v.nEnemies} nearestAdd=${v.nearestAdd} hp=${s.hp}/${s.maxHp}` }); }
      stats.thin._lastMode = v.mode;
      // (setVec is guarded below: a dead target aborts cleanly.)
      stats.dodge.triggers = steerState.dodges || 0; stats.dodge.hard = steerState.hardDodges || 0; stats.dodge.castsExposed = steerState.castsExposed || 0;
      stats.meat.rescuesAttempted = steerState.rescuesAttempted || 0; stats.meat.rescuesDenied = steerState.rescueDenied || 0;
      { const meatNow = (s.pickups || []).filter(p => p.kind === 'meat').length;
        const wasRescue = stats.meat._rescueActive;
        if (stats.meat._lastMeatCount != null && meatNow < stats.meat._lastMeatCount && stats.meat._lastHp != null && s.hp > stats.meat._lastHp) {
          stats.meat.meatEaten++;
          if (wasRescue) stats.meat.rescuesSucceeded++;
        }
        stats.meat._rescueActive = (v.mode === 'rescue');
        stats.meat._lastMeatCount = meatNow; stats.meat._lastHp = s.hp; }
      try { await mover.setVec(v.dx, v.dy); } catch (e) { stats.cause = 'state-lost: input failed (target closed)'; log({ run: runNo, msg: `STATE LOST at input: ${String(e).slice(0, 120)} — aborting run` }); break; }
      if (now - lastLog > 15000) { lastLog = now; const L = stats.loot; log({ run: runNo, msg: `alive t=${s.time.toFixed(0)}s lv=${s.level} hp=${s.hp}/${s.maxHp} kills=${s.kills} (${(s.kills / Math.max(1, s.time) * 60).toFixed(1)}/game-min) enemies=${v.nEnemies} maxLive=${stats.maxLive} >55=${Math.round(stats.timeAbove55)}s nearest=${v.nearest === Infinity ? '-' : Math.round(v.nearest)} mode=${v.mode} hordeIn=${v.timeToHorde == null ? '-' : Math.round(v.timeToHorde)}s boss=${v.nearestBoss === Infinity ? '-' : Math.round(v.nearestBoss) + '/' + (v.bossHp == null ? '-' : v.bossHp + '/' + v.bossMaxHp)} pickups=${v.nPickups} dir=${mover.dirName} LOOT gemExp=${Math.round(L.gemExp)} zeny=${L.zenyEnd} chests=${L.chestsOpened} gear=${L.gear} cards=${L.cards} eggs=${L.eggs} bestPickup=${v.bestPickup ? v.bestPickup.kind + '@' + v.bestPickup.d + 'px' : '-'} dodge=${(v.dodge.reasons || []).join('+') || '-'} casts=${v.castsExposed} rescue=${v.rescue ? (v.rescue.denied ? 'DENIED@' + v.rescue.d : 'GO@' + v.rescue.d) : '-'}` }); }
      // Headed/watchable runs: periodic screenshot every 60s wall so the run
      // can be reviewed as stills even without the video.
      if (!ATTACH_EXISTING && now - lastShot > 60000) { lastShot = now; await shot(page, `r${runNo}-t${Math.round(s.time)}s`); }
    } else if (s && s.ok) {
      await mover.releaseAll();
      // v4.1: refresh the stuck-detection baseline while paused/picking so
      // the 5s window never spans a picker pause (false STUCK? in v4).
      steerState.lastPos = { x: s.player.x, y: s.player.y }; steerState.lastPosAt = Date.now(); steerState.stuckSince = null;
      if (now - lastLog > 15000) { lastLog = now; log({ run: runNo, msg: `state=${s.state} t=${s.time.toFixed(0)}s lv=${s.level} hp=${s.hp}/${s.maxHp} kills=${s.kills}` }); }
    } else {
      await mover.releaseAll();
    }
    await sleep(LOOP_MS);
  }
  await mover.releaseAll();
  if (typeof setStreamRate === 'function') setStreamRate(false);
  const survivedS = Math.floor((Date.now() - start) / 1000);
  const gameSeconds = (stats.endGameTime != null && stats.startGameTime != null) ? Math.max(0, stats.endGameTime - stats.startGameTime) : 0;
  const _gmin = Math.max(gameSeconds / 60, 0.001);
  const _L = stats.loot;
  const lootSummary = { gemExp: Math.round(_L.gemExp), gemExpPerMin: Math.round((_L.gemExp / _gmin) * 10) / 10, zenyEnd: _L.zenyEnd, zenyEarned: _L.zenyEarned, zenyPerMin: Math.round((_L.zenyEarned / _gmin) * 10) / 10, chestSpend: _L.chestSpend, chestsOpened: _L.chestsOpened, chestsPerMin: Math.round((_L.chestsOpened / _gmin) * 100) / 100, gear: _L.gear, cards: _L.cards, eggs: _L.eggs, mobLoot: _L.mobLoot, pickupsLeftOnField: stats.snapSamples.length ? stats.snapSamples[stats.snapSamples.length - 1].pickups : null, lootPerMin: Math.round(((_L.gemExp + _L.zenyEarned + 100 * _L.chestsOpened + 200 * (_L.gear + _L.cards + _L.eggs)) / _gmin) * 10) / 10 };
  const result = { run: runNo, survivedSeconds: survivedS, gameSeconds: Math.round(gameSeconds * 10) / 10, loot: lootSummary, gameWallRatio: survivedS ? Math.round((gameSeconds / survivedS) * 1000) / 1000 : 0, level: stats.maxLevel, kills: stats.maxKills, killsPerMin: gameSeconds ? Math.round((stats.maxKills / gameSeconds) * 60 * 100) / 100 : 0, killsPerGameMin: gameSeconds ? Math.round((stats.maxKills / gameSeconds) * 60 * 100) / 100 : 0, xpPerGameMin: null, picks: stats.picks, lastHpFrac: stats.lastHp, hpMin: Math.round(stats.hpMin * 1000) / 1000, hpMinAtGameS: stats.hpMinAt, stuckEscapes: stats.stuckEscapes, walkReroutes: stats.walkReroutes, walkRouteMisses: stats.walkRouteMisses, modes: stats.modes, thin: { prethinEntries: stats.thin.prethinEntries, breakouts: stats.thin.breakouts, atSpawn: stats.thin.atSpawn }, deathDiag: stats.death.diag, stateSeen: stats.stateSeen, noStateTicks: stats.noStateTicks, cause: stats.cause || (survivedS >= MAX_SECONDS ? 'time-cap reached (still alive)' : 'loop ended'), mvpKilled: stats.mvpKilled ?? null, job: JOB, stage: STAGE, cleared: stats.cleared, maxLive: stats.maxLive, timeAbove40: Math.round(stats.timeAbove40), timeAbove55: Math.round(stats.timeAbove55), timeAbove100: Math.round(stats.timeAbove100), bossFights: stats.bossFights, bossKillTimes: stats.bossKillTimes, dmgBy: stats.dmgBy, killsBy: stats.killsBy, phantomPicks: stats.phantomPicks, dodge: stats.dodge, meat: { rescuesAttempted: stats.meat.rescuesAttempted, rescuesSucceeded: stats.meat.rescuesSucceeded, rescuesDenied: stats.meat.rescuesDenied, meatEaten: stats.meat.meatEaten }, closeAt: stats.closeAt, timeUp: stats.timeUp, snapSamples: stats.snapSamples, pickLog: stats.pickLog, skippedLog: stats.skippedLog };
  // XP/min from level progression: expNext is 5 at L1; use level + exp samples.
  if (stats.expSamples.length >= 2) { const a = stats.expSamples[0], b2 = stats.expSamples[stats.expSamples.length - 1]; const dt = Math.max(1, b2.t - a.t); result.xpPerGameMin = Math.round((((b2.lv - a.lv) * 5 + (b2.exp - a.exp)) / dt) * 60 * 10) / 10; }
  log({ run: runNo, msg: `RESULT run ${runNo}: ${result.survivedSeconds}s, lv ${result.level}, ${result.kills} kills, ${result.picks} picks, stateSeen=${result.stateSeen}, cause: ${result.cause} | LOOT gemExp=${lootSummary.gemExp} (${lootSummary.gemExpPerMin}/min) zeny=${lootSummary.zenyEarned} (${lootSummary.zenyPerMin}/min) chests=${lootSummary.chestsOpened} gear=${lootSummary.gear} cards=${lootSummary.cards} eggs=${lootSummary.eggs} loot/min=${lootSummary.lootPerMin} | DODGE triggers=${stats.dodge.triggers} hard=${stats.dodge.hard} castsExposed=${stats.dodge.castsExposed} | MEAT rescues=${stats.meat.rescuesAttempted}/${stats.meat.rescuesSucceeded} denied=${stats.meat.rescuesDenied} eaten=${stats.meat.meatEaten} | THIN prethin=${stats.thin.prethinEntries} breakouts=${stats.thin.breakouts} atSpawn=${JSON.stringify(stats.thin.atSpawn)} | DEATH ${stats.death.diag ? JSON.stringify(stats.death.diag) : '-'}` });
  return result;
}

// --- speed probe (v3): measure game-time/wall-time ratio per viewport config
// in ONE entered run (no re-entry per config). Steers with the v3 policy so
// the bot does not die mid-probe; handles pickers with the planner.
async function probeSpeed(page, runNo) {
  const mover = new Mover(page);
  const steerState = { orbitDir: 1, orbitFlipAt: 0, lastPos: null, lastPosAt: 0, stuckSince: null, escapeUntil: 0, escapeDir: null, ranged: JOB_DEFS[JOB].ranged, prevReady: null, skillReadyAt: {}, dodges: 0, hardDodges: 0, castsExposed: 0, rescueDenied: 0, rescuesAttempted: 0 };
  // NOTE: deviceScaleFactor is fixed at context creation (--dsf), so one probe
  // launch covers the viewport axis at that dsf. Run a second probe launch
  // with --viewport=640x400 --dsf=0.5 for the low-dsf axis.
  const configs = [
    { name: `640x400 dsf${DSF}`, w: 640, h: 400 },
    { name: `800x500 dsf${DSF}`, w: 800, h: 500 },
    { name: `1280x800 dsf${DSF} (v2 baseline)`, w: 1280, h: 800 },
  ];
  const results = [];
  for (const cfg of configs) {
    await page.setViewportSize({ width: cfg.w, height: cfg.h });
    await sleep(5000); // settle
    const s0 = await readState(page);
    const wall0 = Date.now();
    let pickerOpenedAt = null, pickerCards = 0, lastPickerKey = null;
    while (Date.now() - wall0 < SPEED_PROBE_SECONDS * 1000) {
      const hud = await readHud(page);
      const s = await readState(page);
      if (hud.pickerOpen && hud.cards.length) {
        await mover.releaseAll();
        const key = hud.pickerTitle + '|' + hud.cards.map(c => c.text).join('||');
        if (key !== lastPickerKey) { pickerOpenedAt = Date.now(); pickerCards = hud.cards.length; lastPickerKey = key; }
        if (Date.now() < pickerOpenedAt + PICKER_UNLOCK_BASE_MS + PICKER_UNLOCK_PER_CARD_MS * pickerCards) { await sleep(200); continue; }
        const ctx = { hpFrac: (s && s.ok ? s.hp / s.maxHp : 1), level: (s && s.ok ? s.level : 1), elapsedS: 0, ownedSkills: (s && s.ok ? [...(s.slots || []), ...(s.weapons || [])] : []), slotsFree: 8 };
        let best = null; hud.cards.forEach((c, i) => { const sc = scoreCard(c.text, ctx); if (!best || sc.score > best.score) best = { index: i, ...sc }; });
        if (best) { log({ run: runNo, msg: `probe picker: ${best.index + 1}/${hud.cards.length} score=${best.score}` }); await page.keyboard.press(String(best.index + 1)); await sleep(700); }
        lastPickerKey = null; pickerOpenedAt = null; continue;
      }
      if (s && s.ok && s.state === 'playing' && !s.player.dead) {
        if (s.time > steerState.orbitFlipAt) { steerState.orbitDir *= -1; steerState.orbitFlipAt = s.time + 12; }
        const v = steer(s, steerState);
        await mover.setVec(v.dx, v.dy);
      }
      await sleep(LOOP_MS);
    }
    await mover.releaseAll();
    const s1 = await readState(page);
    const wallS = (Date.now() - wall0) / 1000;
    const gameS = (s0 && s0.ok && s1 && s1.ok) ? (s1.time - s0.time) : null;
    const ratio = gameS != null ? Math.round((gameS / wallS) * 1000) / 1000 : null;
    const rec = { config: cfg.name, wallSeconds: Math.round(wallS), gameSeconds: gameS != null ? Math.round(gameS * 10) / 10 : null, ratio, level: s1 && s1.ok ? s1.level : null, kills: s1 && s1.ok ? s1.kills : null, hp: s1 && s1.ok ? `${s1.hp}/${s1.maxHp}` : null };
    results.push(rec);
    log({ run: runNo, msg: `PROBE ${cfg.name}: ${rec.gameSeconds}s game / ${rec.wallSeconds}s wall = ${ratio}x (lv ${rec.level}, kills ${rec.kills})` });
    if (s1 && s1.ok && (s1.state === 'over' || s1.player.dead)) { log({ run: runNo, msg: 'probe: run ended, stopping probe' }); break; }
  }
  await mover.releaseAll();
  return results;
}
async function runOne(browser, runNo, job, stageKey) {
  // One full session: enter game, create/select `job`, enter `stageKey`,
  // play it. If it clears Prontera and LADDER is on, attempts sewer
  // (Culverts) then sunken (Sunken Ship) in the same session/character.
  const accountState = ACCOUNT_USER && fs.existsSync(AUTH_STATE) ? AUTH_STATE : undefined;
  const ctx = await browser.newContext({ viewport: { width: VIEWPORT[0], height: VIEWPORT[1] }, deviceScaleFactor: DSF, ignoreHTTPSErrors: true, ...(accountState ? { storageState: accountState } : {}), ...(RECORD_VIDEO ? { recordVideo: { dir: path.join(OUT, 'videos'), size: { width: VIEWPORT[0], height: VIEWPORT[1] } } } : {}) });
  const page = await ctx.newPage();
  // Frame cap: the game renders on every animation frame, which on a software
  // rasterizer costs a full core per instance. The simulation is time-based,
  // so a lower frame rate keeps the game speed and only makes it coarser.
  const fpsCap = parseInt(argv.fps || '0', 10);
  if (fpsCap > 5) {
    await page.addInitScript((cap) => {
      // The cap follows window.__RO_FPS__ so the bot can drop it while the
      // game is loading or idling (an idle browser still burns a core if it
      // animates at 20 fps).
      const minGap = () => 1000 / (window.__RO_FPS__ || cap);
      let last = 0;
      window.requestAnimationFrame = (cb) => {
        const wait = Math.max(0, minGap() - (performance.now() - last));
        return setTimeout(() => { last = performance.now(); cb(performance.now()); }, wait);
      };
      const origCancel = window.cancelAnimationFrame.bind(window);
      window.cancelAnimationFrame = (id) => { try { origCancel(id); } catch {} clearTimeout(id); };
    }, fpsCap);
  }
  try {
    return await runOneWithPage(page, runNo, job, stageKey);
  } finally {
    await ctx.close().catch(() => {});
  }
}
// Same session body, on a caller-owned page (Camoufox reuses one persistent
// profile page across runs; login and the created character survive).
async function runOneWithPage(page, runNo, job, stageKey) {
  JOB = job; STAGE = stageKey;
  await installPatchedBundleRoute(page);
  page.on('dialog', async dialog => { try { await dialog.dismiss(); } catch {} });
  page.on('console', m => { if (/error|replay/i.test(m.text())) log({ run: runNo, msg: `console.${m.type()}: ${m.text().slice(0, 300)}` }); });
  page.on('pageerror', e => log({ run: runNo, msg: `pageerror: ${String(e).slice(0, 300)}` }));
  const stageResults = [];
  // Live preview for the GUI grid. A screencast is used instead of repeated
  // screenshots: the compositor already produces frames, so asking for a fresh
  // capture every 5s only competes with the game for CPU (the box has 4 cores
  // and the headless games run on SwiftShader). The frames go out as JPEGs
  // that the app streams to the panel, so the preview plays like a video.
  const previewPath = path.join(OUT, argv.shot || 'shot.jpg');
  const previewEvery = Math.max(1, parseInt(argv['shot-every'] || '5', 10)) * 1000;
  const FRAME_PORT = parseInt(argv['frame-port'] || '0', 10);
  const FRAME_INDEX = parseInt(argv['frame-index'] || '0', 10);
  let previewCdp = null;
  let latestFrame = null;
  let lastWrite = 0;
  const postFrame = (b64) => {
    if (!FRAME_PORT) return false;
    try {
      const body = Buffer.from(b64, 'base64');
      const req = require('http').request({
        host: '127.0.0.1', port: FRAME_PORT, path: `/frame/${FRAME_INDEX}`, method: 'POST',
        headers: { 'content-type': 'image/jpeg', 'content-length': body.length },
      }, res => res.resume());
      req.on('error', () => {});
      req.end(body);
      return true;
    } catch { return false; }
  };
  try {
    previewCdp = await page.context().newCDPSession(page);
    await previewCdp.send('Page.enable');
    previewCdp.on('Page.screencastFrame', async frame => {
      latestFrame = frame.data;
      try { await previewCdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }); } catch {}
      // Push at most ~20 frames per second. The frames go straight to the
      // engine's memory (no disk churn); without a server they land in a file.
      const now = Date.now();
      if (now - lastWrite >= 50 && latestFrame) {
        lastWrite = now;
        if (!postFrame(latestFrame)) {
          try { fs.writeFileSync(previewPath, Buffer.from(latestFrame, 'base64')); } catch {}
        }
      }
    });
    await previewCdp.send('Page.startScreencast', { format: 'jpeg', quality: 55, everyNthFrame: 1 });
  } catch (e) {
    previewCdp = null;
  }
  // Adaptive rate: full speed while a run is going, a trickle while the bot
  // is loading, in town or waiting. An idle instance must not burn a core.
  let streamBusy = null;
  const applyStreamRate = (busy) => {
    if (!previewCdp || streamBusy === busy) return;
    streamBusy = busy;
    previewCdp.send('Page.startScreencast', { format: 'jpeg', quality: busy ? 55 : 40, everyNthFrame: busy ? 1 : 8 }).catch(() => {});
    page.evaluate(fps => { window.__RO_FPS__ = fps; }, busy ? 20 : 6).catch(() => {});
  };
  setStreamRate = applyStreamRate;
  applyStreamRate(false);
  const previewTimer = setInterval(() => {
    // Fallback for a browser without a screencast: a still every 5s.
    if (latestFrame || previewCdp) return;
    page.screenshot({ path: previewPath, timeout: 8000 }).catch(() => {});
  }, previewEvery);
  const continuing = persistentPageRunState.has(page);
  try {
    if (continuing) {
      if (!await resetToCharacterSelect(page, runNo)) {
        stageResults.push({ run: runNo, job, stage: stageKey, cause: 'could not return to character select without reload' });
        return stageResults;
      }
    } else {
      if (ACCOUNT_USER) {
        await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 120000 });
        const signedIn = await ensureAccountLogin(page);
        if (!signedIn) {
          // Never farm the wrong identity: a failed login would leave the bot on
          // the guest profile, creating and levelling a throwaway character.
          log({ run: runNo, msg: `ERROR: could not sign in as ${ACCOUNT_USER} — refusing to play on the guest profile` });
          stageResults.push({ run: runNo, job, stage: stageKey, cause: 'account login failed (guest refused)' });
          return stageResults;
        }
        // The first load let the site register its service worker, which caches
        // the live bundle. Drop it, or the next load would run unpatched.
        await clearSiteCaches(page);
      }
      await enterGame(page, runNo);
    }
    if (!await selectCharacter(page, runNo)) { stageResults.push({ run: runNo, job, stage: stageKey, cause: 'character select failed' }); return stageResults; }
    persistentPageRunState.set(page, true);
    await page.waitForTimeout(2000);
    const apiState = await page.evaluate(() => ({ run: typeof window.__RO_SNAPSHOT__, plaza: typeof window.__RO_PLAZA_SNAPSHOT__ })).catch(() => null);
    log({ run: runNo, msg: `patched APIs: ${JSON.stringify(apiState)}` });
    if (!await enterStage(page, runNo, stageKey)) { stageResults.push({ run: runNo, job, stage: stageKey, cause: 'could not enter stage from plaza' }); return stageResults; }
    const hudOk = await waitVisible(page, '#hud', 30000);
    log({ run: runNo, msg: hudOk ? 'run HUD visible — starting exact-state play loop' : 'WARN run HUD never appeared' });
    await shot(page, `r${runNo}-run-start`);
    const s0 = await readState(page);
    log({ run: runNo, msg: `__RO_SNAPSHOT__ at run start: ${JSON.stringify(s0 ? { ok: s0.ok, state: s0.state, stage: s0.stage, px: s0.player && s0.player.x, py: s0.player && s0.player.y, enemies: s0.enemies && s0.enemies.length, bossBrains: s0.bossBrains && s0.bossBrains.length, dmgBy: s0.dmgBy } : null)}` });
    if (s0 && s0.ok) { try { fs.writeFileSync(path.join(__dirname, '..', 'rea', 'live-snapshot.json'), JSON.stringify(s0, null, 2)); } catch {} }
    let res;
    if (PROBE) { res = { run: runNo, probe: await probeSpeed(page, runNo) }; }
    else res = await playRun(page, runNo);
    res.job = job; res.stage = stageKey;
    stageResults.push(res);
    // Ladder: after a Prontera clear, same character/session -> sewer -> sunken.
    if (LADDER && res.cleared && stageKey === 'prontera') {
      for (const next of ['sewer', 'sunken']) {
        log({ run: runNo, msg: `LADDER: prontera cleared — attempting ${next} with the same character` });
        STAGE = next;
        if (!await returnToPlaza(page, runNo)) { stageResults.push({ run: runNo, job, stage: next, cause: 'could not return to plaza' }); break; }
        if (!await enterStage(page, runNo, next)) { stageResults.push({ run: runNo, job, stage: next, cause: 'could not enter stage / locked' }); break; }
        const hudOk2 = await waitVisible(page, '#hud', 30000);
        log({ run: runNo, msg: hudOk2 ? `ladder ${next}: HUD visible — playing` : `WARN ladder ${next}: HUD never appeared` });
        const res2 = await playRun(page, runNo + '-' + next);
        res2.job = job; res2.stage = next;
        stageResults.push(res2);
        if (!res2.cleared) break;
      }
    }
  } catch (e) {
    log({ run: runNo, msg: `ERROR run ${runNo}: ${String(e).slice(0, 500)}` });
    await shot(page, `r${runNo}-error`);
    stageResults.push({ run: runNo, job, stage: stageKey, cause: 'error: ' + String(e).slice(0, 200) });
  }
  clearInterval(previewTimer);
  return stageResults;
}
// Splash -> account -> character select. Needed both on first attach and after a
// patched-bundle reload, which always lands back on the splash screen.
async function passSplash(page) {
  const st = await waitForPlay(page, 180000, 'splash');
  if (st !== 'play') {
    log({ msg: 'WARN #sp-play never enabled within 180s' });
    return false;
  }
  log({ msg: 'splash ready — entering the already-signed-in account' });
  await page.evaluate(() => document.querySelector('#sp-play').click());
  await page.waitForTimeout(2500);
  // Pressing Play while signed out pops the account prompt over the splash.
  await dismissAccountModal(page, 'after pressing Play');
  const acc = await page.evaluate(() => { const el = document.querySelector('#account-popup'); return el ? !el.classList.contains('hidden') : false; });
  if (acc) {
    log({ msg: 'account popup appeared — staying on the saved guest (decline)' });
    await page.evaluate(() => { const b = document.querySelector('#acc-decline'); if (b) b.click(); });
    await page.waitForTimeout(1500);
  }
  return true;
}
async function runAttached() {
  const cdpUrl = argv['cdp-url'] || 'http://127.0.0.1:9222';
  let browser, browserSource, launchedBrowser = false;
  let storageState = HEADLESS && fs.existsSync(AUTH_STATE) ? AUTH_STATE : undefined;
  // Optional: restore a saved guest/account session BEFORE the app boots.
  // The game reads localStorage on load and mints a fresh guest in parallel
  // with any post-boot write, so a runtime setItem + reload loses the race.
  // Seed the context storage state instead; the first /api/save then carries
  // the saved token (verified: HTTP 200 GET api/save with account 38092).
  if (argv.session) {
    let seed = { cookies: [], origins: [] };
    try { if (typeof storageState === 'string' && fs.existsSync(storageState)) seed = JSON.parse(fs.readFileSync(storageState, 'utf8')); } catch { seed = { cookies: [], origins: [] }; }
    const origins = Array.isArray(seed.origins) ? seed.origins : [];
    const siteOrigin = new URL(SITE).origin;
    let site = origins.find(origin => origin.origin === siteOrigin);
    if (!site) { site = { origin: siteOrigin, localStorage: [] }; origins.push(site); }
    site.localStorage = (site.localStorage || []).filter(entry => entry.name !== 'ro-survivors-guest-session');
    site.localStorage.push({ name: 'ro-survivors-guest-session', value: String(argv.session) });
    storageState = { cookies: seed.cookies || [], origins };
  }
  if (await cdpIsReady(cdpUrl)) {
    browser = await chromium.connectOverCDP(cdpUrl);
    browserSource = 'existing browser session';
  } else {
    if (HEADLESS && !storageState) {
      throw new Error('Headless mode needs a saved sign-in. Start Visible mode once and sign in first.');
    }
    const executablePath = defaultBrowserExecutable();
    const profile = path.join(OUT, HEADLESS ? 'browser-profile-headless' : 'browser-profile-visible');
    fs.mkdirSync(profile, { recursive: true });
    const debugPort = new URL(cdpUrl).port || (new URL(cdpUrl).protocol === 'https:' ? '443' : '80');
    const args = [
      `--remote-debugging-port=${debugPort}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      `--window-size=${VIEWPORT[0]},${VIEWPORT[1]}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--ignore-certificate-errors',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      ...(HEADLESS ? ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : []),
      ...(NEED_PROXY ? ['--proxy-server=http://127.0.0.1:18080'] : []),
    ];
    ownedBrowserProcess = spawn(executablePath, args, { detached: true, stdio: 'ignore' });
    ownedBrowserProcess.unref();
    launchedBrowser = true;
    browserSource = `app-launched ${HEADLESS ? 'headless' : 'visible'} default browser`;
    log({ msg: `${browserSource}: ${executablePath}` });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await cdpIsReady(cdpUrl)) { ready = true; break; }
      if (ownedBrowserProcess.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) {
      if (ownedBrowserProcess.exitCode === null) ownedBrowserProcess.kill('SIGTERM');
      ownedBrowserProcess = null;
      throw new Error(`The default browser did not expose its local control endpoint: ${cdpUrl}`);
    }
    browser = await chromium.connectOverCDP(cdpUrl);
    if (HEADLESS) {
      ownedHeadlessContext = await browser.newContext({
        storageState, viewport: { width: VIEWPORT[0], height: VIEWPORT[1] },
        deviceScaleFactor: DSF, ignoreHTTPSErrors: true,
      });
    }
  }
  let page = null, state = null;
  const safeDialog = p => { try { p.on('dialog', async dialog => { try { await dialog.dismiss(); } catch {} }); } catch {} };
  for (const context of browser.contexts()) {
    for (const candidate of context.pages()) {
      if (!candidate.url().includes('ro-survivors.com')) continue;
      safeDialog(candidate);
      await installPatchedBundleRoute(candidate);
      const observed = await readState(candidate);
      if (isLiveRunState(observed)) {
        page = candidate; state = observed; break;
      }
      if (!page && START_FROM_EXISTING) page = candidate;
    }
    if (state) break;
  }
  if (!page) {
    const context = ownedHeadlessContext || browser.contexts()[0] || await browser.newContext();
    const pages = context.pages();
    page = launchedBrowser ? (pages[0] || await context.newPage()) :
      (pages.find(candidate => candidate.url() === 'about:blank') || await context.newPage());
    safeDialog(page);
    await installPatchedBundleRoute(page);
    if (!page.url().includes('ro-survivors.com')) await page.goto(SITE, { waitUntil: 'domcontentloaded' });
    state = await readState(page);
  } else {
    safeDialog(page);
  }
  // The saved session is already seeded into this context's storage state
  // (see runAttached). Only a CDP-attached browser needs the runtime fallback.
  if (argv.session && !(HEADLESS && ownedHeadlessContext)) {
    await page.evaluate(s => { try { localStorage.setItem('ro-survivors-guest-session', s); } catch {} }, String(argv.session));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(5000);
    log({ msg: 'session injected: reloaded the game with the saved account session' });
  } else if (argv.session) {
    log({ msg: 'session seeded into browser storage state before boot (no reload needed)' });
  }
  const patchRouteState = patchedRouteStates.get(page) || await installPatchedBundleRoute(page);
  // runAttached goes straight to the character select, but the splash has to
  // finish loading first (the loading bar takes ~25s) and an existing guest
  // account gets a register prompt after Play. Without this the bot clicked
  // nothing, found zero slots, and refused to start.
  const hudNow = await page.evaluate(() => document.querySelector('#hud')?.innerText || '').catch(() => '');
  const inPlaza = await page.evaluate(() => typeof window.__RO_PLAZA_SNAPSHOT__ === 'function' && !!window.__RO_PLAZA_SNAPSHOT__()?.ok).catch(() => false);
  const onSelectNow = await page.evaluate(() => { const el = document.querySelector('#charselect'); return !!el && !el.classList.contains('hidden'); }).catch(() => false);
  if (START_FROM_EXISTING && !isLiveRunState(state) && !inPlaza && !onSelectNow && !hudNow) await passSplash(page);
  const hasSnapshotApi = await page.evaluate(() => typeof window.__RO_SNAPSHOT__ === 'function').catch(() => false);
  // Some hosts serve the patched bundle themselves (the GUI app answers
  // /build/main-*.js at the protocol layer, so this bot's route never fires and
  // patchRouteState.served stays false). Ask the loaded bundle directly: if it
  // carries the instrumentation, the page is already patched — a reload would
  // be pointless and, worse, would abort the attach.
  const bundlePatched = hasSnapshotApi || inPlaza ? true : await page.evaluate(async () => {
    const src = [...document.querySelectorAll('script[src]')].map(s => s.src).find(s => /build\/main-/.test(s));
    if (!src) return false;
    try { const text = await (await fetch(src, { cache: 'no-store' })).text(); return text.includes('__RO_SNAPSHOT__') && text.includes('__RO_PLAZA_SNAPSHOT__'); }
    catch { return false; }
  }).catch(() => false);
  if (bundlePatched && !patchRouteState.served) log({ msg: 'patched bundle already served by this host — no reload needed' });
  // __RO_SNAPSHOT__ only appears inside a field, so a plaza page (which only renders
  // with the patched bundle) is already instrumented and must not be reloaded.
  if (!hasSnapshotApi && !inPlaza && !patchRouteState.served && !bundlePatched) {
    const pageState = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const gameOver = document.querySelector('#gameover') && !document.querySelector('#gameover').classList.contains('hidden');
      const inTown = /Fountain Square|Talk to the captain|Stylist|Ore Merchant|Channel\s+\d+/i.test(text);
      const mapNames = ['Sunken Ship', 'Prontera Fields', 'Prontera Culverts', 'Byalan Island', 'Payon Forest', 'Payon Cave'];
      const currentMap = mapNames.find(name => text.toLowerCase().includes(name.toLowerCase())) || null;
      const fieldCoordinates = /(?:Sunken Ship|Prontera Fields|Prontera Culverts|Byalan Island|Payon Forest|Payon Cave)[^\n]{0,100}\(\s*\d+\s*,\s*\d+\s*\)/i.test(text);
      const hasClock = /\b\d{2}:\d{2}\b/.test(text);
      return { gameOver: !!gameOver, currentMap, activeField: !inTown && fieldCoordinates && hasClock };
    }).catch(() => ({ gameOver: false, currentMap: null, activeField: false }));
    if (pageState.gameOver) {
      throw new Error('The browser is showing run results without snapshot instrumentation; refusing to reload and lose them.');
    }
    if (pageState.activeField && (!pageState.currentMap || (STAGE_MATCH[STAGE] || /$a/).test(pageState.currentMap))) {
      throw new Error('A run is active in the requested map, but this page lacks snapshot instrumentation; refusing to reload and lose progress.');
    }
    if (pageState.activeField) {
      log({ msg: `abandoning an uninstrumented ${pageState.currentMap} run to honor requested ${STAGE}; refreshing through the patched bundle route` });
    }
    log({ msg: 'idle game page lacks snapshot instrumentation; refreshing once through the patched bundle route' });
    // An installed service worker can serve a cached, unpatched bundle that Playwright
    // cannot intercept; drop it (and its caches) so the reload fetches the patched one.
    const dropped = await page.evaluate(async () => {
      const scopes = [];
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        scopes.push(registration.scope);
        await registration.unregister();
      }
      const names = await caches.keys();
      await Promise.all(names.map(name => caches.delete(name)));
      return { scopes, names };
    }).catch(() => null);
    if (dropped && dropped.scopes.length) log({ msg: `unregistered service worker ${dropped.scopes.join(', ')} and cleared ${dropped.names.length} cache(s) so the patched bundle is fetched` });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    for (let attempt = 0; attempt < 80 && !patchRouteState.served; attempt++) {
      await page.waitForTimeout(250);
    }
    if (!patchRouteState.served) {
      // One retry: a freshly re-installed service worker can still win the race.
      log({ msg: 'patched bundle missed on first reload; clearing the service worker again and retrying' });
      await page.evaluate(async () => {
        for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
        await Promise.all((await caches.keys()).map(name => caches.delete(name)));
      }).catch(() => {});
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
      for (let attempt = 0; attempt < 80 && !patchRouteState.served; attempt++) {
        await page.waitForTimeout(250);
      }
    }
    if (!patchRouteState.served) {
      throw new Error('The patched game bundle was not loaded after refreshing the idle page; not steering.');
    }
    state = await readState(page);
    log({ msg: 'patched game bundle loaded; snapshot will become available when the selected character enters a field' });
    // The reload always lands on the splash screen; enter the saved account again.
    if (START_FROM_EXISTING) {
      await passSplash(page);
      state = await readState(page);
    }
  }
  const authContext = browser.contexts().find(context => context.pages().includes(page));
  if (!HEADLESS && authContext) await saveBrowserAuth(authContext);
  if (!page) throw new Error('Could not open the game in the selected browser.');
  let objectives;
  try { objectives = JSON.parse(argv.objectives || '[]'); } catch { throw new Error('--objectives must be a JSON array of objective names.'); }
  if (!Array.isArray(objectives)) throw new Error('--objectives must be a JSON array of objective names.');
  objectives = objectives.map(value => String(value).trim()).filter(Boolean);
  if (!objectives.length && argv['until-card']) objectives = [String(argv['until-card']).trim()].filter(Boolean);
  const maxCardRuns = Math.max(0, parseInt(argv['max-card-runs'] || '0', 10) || 0);
  if (objectives.length && !START_FROM_EXISTING) throw new Error('Repeat objectives require --start-existing=true so later runs can reuse the saved character.');
  if (!isLiveRunState(state) && !START_FROM_EXISTING) throw new Error('No active run; pass --start-existing=true to start from this signed-in browser profile.');
  const results = [];
  const foundObjectives = new Set();
  let runNo = 1, allObjectivesFound = false;
  while (true) {
    if (!isLiveRunState(state)) {
      const leftResults = await page.evaluate(() => {
        const overlay = document.querySelector('#gameover');
        const button = document.querySelector('#btn-restart');
        if (!overlay || overlay.classList.contains('hidden') || !button) return false;
        button.click();
        return true;
      }).catch(() => false);
      if (leftResults) {
        log({ run: runNo, msg: 'left Results screen via Back to character; reusing the signed-in profile' });
        await page.waitForTimeout(1500);
      }
      let onSelect = await page.evaluate(() => {
        const el = document.querySelector('#charselect');
        return !!el && !el.classList.contains('hidden');
      });
      for (let attempt = 0; attempt < 120 && !onSelect; attempt++) {
        const entered = await page.evaluate(() => !!document.querySelector('#hud')?.innerText);
        if (entered) break;
        await page.waitForTimeout(250);
        onSelect = await page.evaluate(() => {
          const el = document.querySelector('#charselect');
          return !!el && !el.classList.contains('hidden');
        });
      }
      if (!onSelect) {
        const openedAccount = await page.evaluate(() => {
          const button = [...document.querySelectorAll('*')].find(el => {
            const rect = el.getBoundingClientRect();
            return el.textContent?.replace(/\s+/g, ' ').trim() === 'Play!' && rect.width > 0 && rect.height > 0;
          });
          if (!button) return false;
          button.click();
          return true;
        });
        if (openedAccount) {
          log({ run: runNo, msg: 'opening the already-signed-in account; not creating an account' });
          for (let attempt = 0; attempt < 60; attempt++) {
            onSelect = await page.evaluate(() => {
              const el = document.querySelector('#charselect');
              return !!el && !el.classList.contains('hidden');
            });
            const hud = await page.evaluate(() => document.querySelector('#hud')?.innerText || '');
            if (onSelect || JOB_DEFS[JOB].re.test(hud)) break;
            await page.waitForTimeout(250);
          }
        }
      }
      // Starting while already in town: the plaza HUD does not name the character,
      // so hop back to character select to confirm the job before setting out.
      if (!onSelect) {
        const switched = await page.evaluate(() => {
          const el = [...document.querySelectorAll('button, [data-act]')]
            .find(b => /switch\s+character/i.test(b.textContent || '') && b.getBoundingClientRect().width > 0);
          if (!el) return false;
          el.click();
          return true;
        }).catch(() => false);
        if (switched) {
          log({ run: runNo, msg: 'already in town — switched back to character select to confirm the character' });
          for (let attempt = 0; attempt < 80; attempt++) {
            onSelect = await page.evaluate(() => {
              const el = document.querySelector('#charselect');
              return !!el && !el.classList.contains('hidden');
            });
            if (onSelect) break;
            await page.waitForTimeout(250);
          }
        }
      }
      let selectedExistingCharacter = null;
      if (onSelect) {
        const selected = await page.evaluate(reSrc => {
          const hit = [...document.querySelectorAll('#slots > *')]
            .find(el => new RegExp(reSrc, 'i').test(el.textContent) && !/empty slot/i.test(el.textContent));
          if (!hit) return null;
          hit.click();
          return hit.textContent.replace(/\s+/g, ' ').trim().slice(0, 120);
        }, JOB_DEFS[JOB].re.source);
        if (!selected) throw new Error(`No existing ${JOB} character found; refusing to create or select another job.`);
        selectedExistingCharacter = selected;
        log({ run: runNo, msg: `selected existing character: ${selected}` });
        await page.waitForTimeout(500);
        if (!await domClick(page, '#btn-play')) throw new Error('Could not open existing character in the signed-in profile.');
        await page.waitForTimeout(1500);
      }
      const setupHud = await page.evaluate(() => document.querySelector('#hud')?.innerText || '');
      if (!JOB_DEFS[JOB].re.test(setupHud) && !JOB_DEFS[JOB].re.test(selectedExistingCharacter || '')) {
        throw new Error(`Neither the selected character nor the game screen confirms ${JOB}; refusing to start another job.`);
      }
      log({ run: runNo, msg: `starting ${STAGE} from existing ${JOB}/profile; no guest account or slider changes` });
      if (!await enterStage(page, runNo, STAGE)) throw new Error(`Could not start selected stage ${STAGE} from the existing profile.`);
      for (let i = 0; i < 120; i++) {
        state = await readState(page);
        if (isLiveRunState(state)) break;
        await page.waitForTimeout(250);
      }
      if (!isLiveRunState(state)) throw new Error('Stage UI closed but no live run snapshot appeared; not steering.');
    }
    const wantedStage = STAGE_MATCH[STAGE] || STAGE_MATCH.prontera;
    if (state.stage && !wantedStage.test(String(state.stage))) {
      throw new Error(`Existing run is ${state.stage}, not the selected ${STAGE} stage; refusing to steer a different map.`);
    }
    for (const key of ['w', 'a', 's', 'd']) await page.keyboard.up(key).catch(() => {});
    const characterHud = await page.evaluate(() => document.querySelector('#hud')?.innerText || '');
    if (!JOB_DEFS[JOB].re.test(characterHud)) throw new Error(`The active character HUD does not identify ${JOB}; refusing to steer another job.`);
    const b = state.bounds;
    const center = b ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : null;
    const radius = center ? Math.round(Math.hypot(state.player.x - center.x, state.player.y - center.y)) : null;
    log({ run: runNo, msg: `ATTACHED existing browser; state=${state.state} stage=${state.stage} time=${state.time}s player=(${Math.round(state.player.x)},${Math.round(state.player.y)}) spawnRadius=${radius} jobPolicy=${JOB}; preserving signed-in profile and settings` });
    const result = await playRun(page, runNo);
    result.job = JOB; result.stage = STAGE;
    await page.waitForTimeout(500);
    const observed = await page.evaluate(() => {
      const names = value => Array.isArray(value) ? value.flatMap(item => {
        if (typeof item === 'string') return [item];
        if (!item || typeof item !== 'object') return [];
        return ['name', 'title', 'label', 'id', 'key', 'type', 'kind'].map(key => item[key]).filter(value => typeof value === 'string');
      }) : [];
      const root = window.__RO__ || {};
      const cards = [...document.querySelectorAll('#gameover .go-cards .cardimg')].map(card => card.title || card.getAttribute('alt') || '').filter(Boolean);
      const resultText = document.querySelector('#gameover')?.innerText || '';
      const lootNames = [...names(root.runLoot), ...names(root.runCards), ...names(root.runEggs)];
      return { cards, lootNames, resultText };
    }).catch(() => ({ cards: [], lootNames: [], resultText: '' }));
    const resultNames = [...observed.cards, ...observed.lootNames, observed.resultText];
    result.cards = observed.cards;
    result.lootNames = observed.lootNames;
    for (const objective of mergeFoundObjectives(foundObjectives, resultNames, objectives)) foundObjectives.add(objective);
    result.objectiveStatus = objectives.map(objective => ({ objective, found: foundObjectives.has(objective.toLowerCase()) }));
    result.foundObjectives = [...foundObjectives];
    allObjectivesFound = allObjectivesObtained(foundObjectives, objectives);
    log({ run: runNo, msg: `RESULT-OBJECTIVES: ${JSON.stringify(result.objectiveStatus)}; progress=${foundObjectives.size}/${objectives.length}; complete=${allObjectivesFound}; resultCards=${JSON.stringify(observed.cards)}; lootNames=${JSON.stringify(observed.lootNames)}` });
    results.push(result);
    if (!objectives.length || allObjectivesFound || (maxCardRuns > 0 && runNo >= maxCardRuns)) break;
    log({ run: runNo, msg: `objectives incomplete; starting run ${runNo + 1} on the same saved ${JOB}` });
    const returned = await page.evaluate(() => {
      const overlay = document.querySelector('#gameover');
      const button = document.querySelector('#btn-restart');
      if (!overlay || overlay.classList.contains('hidden') || !button) return false;
      button.click();
      return true;
    }).catch(() => false);
    if (returned) await page.waitForTimeout(1500);
    state = null;
    runNo++;
  }
  const patchedSha = PATCHED ? require('crypto').createHash('sha256').update(fs.readFileSync(PATCHED)).digest('hex').slice(0, 16) : 'none';
  fs.writeFileSync(path.join(OUT, `summary-${RUN_TAG}.json`), JSON.stringify({
    tag: RUN_TAG, bot: 'v6.2-pre-boss-thinning-attached', job: JOB, stage: STAGE,
    runs: results.length, maxSeconds: MAX_SECONDS, objectives, foundObjectives: [...foundObjectives], allObjectivesFound,
    attached: browserSource, patchedSha256: patchedSha, results,
  }, null, 2));
  if (authContext) await saveBrowserAuth(authContext);
  await closeOwnedHeadlessBrowser();
  await new Promise(resolve => logStream.end(resolve));
  process.exit(0); // Leave a user-visible browser open; close only the app-owned headless browser.
}

// v6.1 harness: the browser can die under load (renderer OOM-killed
// while another agent's headed browser hogs the shared CPU) — a dead
// browser used to kill the whole batch at the next runOne's newContext
// (outside runOne's try/catch). Relaunch on demand, never lose the batch.
async function launchBrowser() {
  // --gpu=true lets headless Chromium use the machine's real GPU through
  // ANGLE; the default forces SwiftShader, which burns a full CPU core per
  // instance (and this box has only 4 cores).
  const GPU = argv.gpu === 'true';
  // A shared disk cache lets the second and later instances load the game's
  // assets from disk instead of downloading them again (the game ships a lot
  // of art). Each account still keeps its own profile (cookies, localStorage).
  const cacheDir = argv['cache-dir'] || '';
  return chromium.launch({
    headless: HEADLESS,
    args: [
      ...(GPU ? ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan,SkiaGraphite'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']),
      ...(cacheDir ? [`--disk-cache-dir=${cacheDir}`] : []),
      '--disable-gpu-sandbox', '--no-sandbox',
      `--window-size=${VIEWPORT[0]},${VIEWPORT[1]}`,
      ...(NEED_PROXY ? ['--proxy-server=http://127.0.0.1:18080'] : []),
      '--ignore-certificate-errors', '--disable-dev-shm-usage', '--mute-audio',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      // Keep the GPU process light: the farm renders many small canvases.
      '--disable-features=CalculateNativeWinOcclusion',
    ],
  });
}
async function ensureBrowser(browser) {
  if (browser && browser.isConnected()) return browser;
  log({ msg: 'browser dead — relaunching for the next run' });
  try { await browser.close().catch(() => {}); } catch {}
  return launchBrowser();
}
async function safeRunOne(browser, runNo, job, stageKey) {
  try { return await runOne(browser, runNo, job, stageKey); }
  catch (e) {
    log({ run: runNo, msg: `ERROR run ${runNo} (outside runOne): ${String(e).slice(0, 300)}` });
    return [{ run: runNo, job, stage: stageKey, cause: 'error: ' + String(e).slice(0, 200) }];
  }
}
// The site registers a service worker that caches the game's bundle. The
// worker fetches the bundle itself (Playwright does not intercept worker
// requests), so it would serve the UNPATCHED bundle on the next load and the
// bot would lose its state API. Drop the worker and its caches before every
// load so the patched bundle is always the one that runs.
async function clearSiteCaches(page) {
  await page.evaluate(async () => {
    try {
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) { try { await r.unregister(); } catch {} }
      }
    } catch {}
    try {
      if (window.caches) {
        const keys = await caches.keys();
        for (const k of keys) { try { await caches.delete(k); } catch {} }
      }
    } catch {}
  }).catch(() => {});
}

// The splash replaces the Play button with "Check again" while the server is
// in maintenance. Waiting for a Play button that never appears just burns
// the wait; this helper reports the maintenance state instead, and pokes the
// "Check again" button every minute so the splash picks the server up again
// on its own.
async function splashState(page) {
  return page.evaluate(() => {
    const b = document.querySelector('#sp-play');
    const maint = document.querySelector('.sp-maint-retry');
    const text = document.body ? (document.body.innerText || '') : '';
    return {
      play: !!(b && !b.disabled),
      maintenance: !!maint || /under maintenance|server maintenance/i.test(text),
    };
  }).catch(() => ({ play: false, maintenance: false }));
}
async function waitForPlay(page, maxMs, label) {
  const deadline = Date.now() + maxMs;
  let saidMaint = false;
  while (Date.now() < deadline) {
    const st = await splashState(page);
    if (st.play) return 'play';
    if (st.maintenance && !saidMaint) {
      saidMaint = true;
      log({ msg: `the splash says the server is in maintenance — waiting (checked every 60s, starts automatically)${label ? ` [${label}]` : ''}` });
    }
    if (saidMaint) {
      await page.evaluate(() => { const b = document.querySelector('.sp-maint-retry'); if (b) b.click(); }).catch(() => {});
      await page.waitForTimeout(60000);
    } else {
      await page.waitForTimeout(2000);
    }
  }
  return 'timeout';
}

// The splash puts a "You now need an account" modal over everything once
// Play is pressed while signed out. It has to be dismissed before the login
// tab (and the rest of the splash) can be used.
async function dismissAccountModal(page, why) {
  const dismissed = await page.evaluate(() => {
    const all = [...document.querySelectorAll('button, .ro-btn, [role=button]')];
    const b = all.find(x => /i have an account/i.test((x.textContent || '').trim()));
    if (b) { b.click(); return true; }
    return false;
  }).catch(() => false);
  if (dismissed) {
    await page.waitForTimeout(700);
    log({ msg: `dismissed the "I have an account" prompt${why ? ` (${why})` : ''}` });
  }
  return dismissed;
}

// Sign the page into a game ACCOUNT at the splash's own login tab. The
// session is then cached per account (AUTH_STATE) so later runs skip this.
// A maintenance answer is not a rejection: the attempt is repeated until the
// server is back, so an unattended instance recovers on its own.
async function ensureAccountLogin(page) {
  const user = ACCOUNT_USER, pass = ACCOUNT_PASS;
  if (!user || !pass) return false;
  for (let attempt = 1; attempt <= 120; attempt++) {
    const res = await attemptAccountLogin(page, user, pass);
    if (res !== 'maintenance') return res === 'ok';
    log({ msg: 'the server is in maintenance — the sign-in is retried in 60s' });
    await page.waitForTimeout(60000);
    await page.evaluate(() => { const b = document.querySelector('.sp-maint-retry'); if (b) b.click(); }).catch(() => {});
  }
  log({ msg: 'WARN the server stayed in maintenance for 2 hours — giving up on this sign-in' });
  return false;
}

async function attemptAccountLogin(page, user, pass) {
  let ready = false;
  {
    const st = await waitForPlay(page, 120000, 'account login');
    ready = st === 'play';
  }
  if (!ready) { log({ msg: 'WARN splash never became ready for the account login' }); return 'failed'; }
  await dismissAccountModal(page, 'before signing in');
  const signed = await page.evaluate((u) => {
    // The splash shows the signed-in account name on the first tab when the
    // session is still valid, so a case-insensitive name match is enough.
    const txt = (document.body.innerText || '').toLowerCase();
    return txt.includes(String(u).toLowerCase());
  }, user).catch(() => false);
  if (signed) { log({ msg: `account already signed in: ${user}` }); return 'ok'; }
  log({ msg: `signing in as ${user}` });
  await page.evaluate(() => { const t = document.querySelector('.sp-tabs [data-sp-tab="login"]'); if (t) t.click(); });
  await page.waitForTimeout(800);
  await page.evaluate(({ u, p }) => {
    const f = document.getElementById('sp-login');
    if (!f) return;
    // The game reads the fields through their input events; setting .value
    // alone leaves it with empty credentials and it silently stays on guest.
    const iu = f.querySelector('input[name="username"]');
    const ip = f.querySelector('input[name="password"]');
    iu.value = u; iu.dispatchEvent(new Event('input', { bubbles: true }));
    ip.value = p; ip.dispatchEvent(new Event('input', { bubbles: true }));
    f.querySelector('.sp-submit').click();
  }, { u: user, p: pass });
  for (let waited = 0; waited < 40000; waited += 2000) {
    // A successful login lands on the character select screen with the
    // account's characters. Accounts without a display name show nothing
    // about the user name there, so the screen itself is the signal.
    const st = await page.evaluate(() => {
      const cs = document.getElementById('charselect');
      const slots = [...document.querySelectorAll('#slots > *')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(t => t && !/empty slot/i.test(t));
      return {
        charselect: !!(cs && !cs.classList.contains('hidden')),
        err: (document.querySelector('#sp-login .sp-error')?.textContent || '').trim(),
        slots: slots.length,
      };
    }).catch(() => ({ charselect: false, err: '', slots: 0 }));
    if (st.err) {
      if (/maintenance|server is down|come back in a few minutes/i.test(st.err)) return 'maintenance';
      log({ msg: `login rejected: ${st.err}` });
      return 'rejected';
    }
    if (st.charselect) {
      log({ msg: `signed in as ${user}${st.slots ? ` (${st.slots} character slot(s))` : ''}` });
      await saveBrowserAuth(page.context());
      return 'ok';
    }
    await page.waitForTimeout(2000);
  }
  log({ msg: 'WARN account login did not confirm within 40s' });
  return 'failed';
}

// Camoufox (Firefox) sign-in, at the splash's own login tab. Runs before
// enterGame so the later Play click lands on the signed-in account.
async function loginCamoufox(page) {
  const user = process.env.RO_BOT_USER || argv.username || '';
  const pass = process.env.RO_BOT_PASS || argv.password || '';
  const signedIn = await page.evaluate(() => { try { const a = JSON.parse(localStorage.getItem('ro-survivors.account.v1') || 'null'); return !!(a && a.name); } catch { return false; } }).catch(() => false);
  if (signedIn) { log({ msg: 'camoufox: profile already signed in — skipping login' }); return; }
  if (!user || !pass) { log({ msg: 'camoufox: no saved sign-in and no username/password given — staying on guest (selectCharacter will create a guest character)' }); return; }
  let ready = false;
  {
    const st = await waitForPlay(page, 180000, 'camoufox login');
    ready = st === 'play';
  }
  if (!ready) { log({ msg: 'WARN camoufox: splash never ready for login' }); return; }
  await dismissAccountModal(page, 'camoufox before signing in');
  log({ msg: `camoufox: signing in as ${user}` });
  await page.evaluate(() => { const t = document.querySelector('.sp-tabs [data-sp-tab="login"]'); if (t) t.click(); });
  await page.waitForTimeout(800);
  await page.evaluate(({ u, p }) => {
    const f = document.getElementById('sp-login');
    if (!f) return;
    const iu = f.querySelector('input[name="username"]');
    const ip = f.querySelector('input[name="password"]');
    iu.value = u; iu.dispatchEvent(new Event('input', { bubbles: true }));
    ip.value = p; ip.dispatchEvent(new Event('input', { bubbles: true }));
    f.querySelector('.sp-submit').click();
  }, { u: user, p: pass });
  for (let waited = 0; waited < 40000; waited += 2000) {
    const ok = await page.evaluate(() => {
      const cs = document.getElementById('charselect');
      return {
        charselect: !!(cs && !cs.classList.contains('hidden')),
        session: !!localStorage.getItem('ro-survivors-session'),
      };
    }).catch(() => ({ charselect: false, session: false }));
    if (ok.charselect || ok.session) { log({ msg: `camoufox: signed in as ${user}` }); return; }
    await page.waitForTimeout(2000);
  }
  log({ msg: 'WARN camoufox: login did not confirm within 40s — continuing' });
}

// Multi-account headless mode: one persistent Camoufox profile, real login,
// character auto-created on first run, 5s preview screenshots into OUT.
async function runCamoufox() {
  const { firefox } = require(CAMOUFOX_ROOT + '/playwright-core');
  const { launchOptions } = require(CAMOUFOX_ROOT + '/camoufox-js');
  const { generateFingerprint } = require(CAMOUFOX_ROOT + '/camoufox-js/dist/fingerprints.js');
  const profileDir = argv.profile || path.join(OUT, `camoufox-profile-${RUN_TAG}`);
  fs.mkdirSync(profileDir, { recursive: true });
  // Headless instances must be SILENT:
  //   media.volume_scale 0 -> Firefox scales every audio stream to zero.
  // Prefs go through the profile's user.js because camoufox's protocol
  // injector refuses double prefs. (Do NOT disable service workers here:
  // that breaks Playwright's request interception in Firefox, which is how
  // the patched game bundle gets served.)
  const userJs = path.join(profileDir, 'user.js');
  try {
    fs.writeFileSync(userJs, [
      'user_pref("media.volume_scale", 0.0);',
      '',
    ].join('\n'));
  } catch {}
  let fingerprint = null;
  try { fingerprint = JSON.parse(fs.readFileSync(path.join(profileDir, 'fingerprint.json'), 'utf8')); } catch {}
  if (!fingerprint) {
    fingerprint = generateFingerprint(undefined, { operatingSystems: ['linux'] });
    try { fs.writeFileSync(path.join(profileDir, 'fingerprint.json'), JSON.stringify(fingerprint)); } catch {}
  }
  const opts = await launchOptions({ headless: true, humanize: true, enable_cache: true, os: 'linux', fingerprint, iKnowWhatImDoing: true });
  log({ msg: `camoufox: launching headless profile ${profileDir}` });
  const ctx = await firefox.launchPersistentContext(profileDir, { ...opts, viewport: { width: VIEWPORT[0], height: VIEWPORT[1] }, deviceScaleFactor: DSF, ignoreHTTPSErrors: true });
  camoufoxContext = ctx;
  const page = ctx.pages()[0] || await ctx.newPage();
  // Before any game script runs: English + muted (game-level silence), so the
  // instance never produces sound even if the M keypress is refused.
  await page.addInitScript(() => {
    try {
      const KEY = 'ro-survivors:settings';
      let s = {};
      try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
      s.lang = 'en';
      s.muted = true;
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
  });
  await installPatchedBundleRoute(page);
  page.on('dialog', async d => { try { await d.dismiss(); } catch {} });
  page.on('console', m => { if (/error|replay/i.test(m.text())) log({ msg: `console.${m.type()}: ${m.text().slice(0, 300)}` }); });
  page.on('pageerror', e => log({ msg: `pageerror: ${String(e).slice(0, 300)}` }));

  const shotEvery = Math.max(1, parseInt(argv['shot-every'] || '5', 10));
  const shotPath = path.join(OUT, argv.shot || 'shot.png');
  const shotTimer = setInterval(() => { page.screenshot({ path: shotPath }).catch(() => {}); }, shotEvery * 1000);
  log({ msg: `camoufox: preview shots every ${shotEvery}s → ${shotPath}` });

  try {
    await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginCamoufox(page);
    // Mute the game itself. The init script already sets the game's muted
    // flag, so only press M when it is somehow not muted — pressing it
    // blindly would toggle a muted game back to sound.
    try {
      const before = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('ro-survivors:settings') || '{}').muted; } catch { return null; } }).catch(() => null);
      if (before !== true) { await page.keyboard.press('m'); await page.waitForTimeout(800); }
      const muted = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('ro-survivors:settings') || '{}').muted; } catch { return null; } }).catch(() => null);
      log({ msg: `camoufox: muted=${muted} (browser volume scaled to 0)` });
    } catch (e) { log({ msg: `camoufox: mute key failed: ${String(e).slice(0, 120)}` }); }
    const results = [];
    let runNo = 0;
    for (let i = 0; i < RUNS; i++) {
      runNo++;
      await clearSiteCaches(page);
      const rs = await runOneWithPage(page, runNo, JOB, STAGE);
      results.push(...rs);
      if (i < RUNS - 1) await sleep(3000);
    }
    const summary = { tag: RUN_TAG, bot: 'v6.2-camoufox', job: JOB, stage: STAGE, runs: RUNS, maxSeconds: MAX_SECONDS, headless: true, viewport: VIEWPORT.join('x'), dsf: DSF, results };
    fs.writeFileSync(path.join(OUT, `summary-${RUN_TAG}.json`), JSON.stringify(summary, null, 2));
    log({ msg: `DONE. ${JSON.stringify(results.map(r => ({ run: r.run, job: r.job, stage: r.stage, s: r.survivedSeconds, gameS: r.gameSeconds, lv: r.level, kills: r.kills, cleared: !!r.cleared, cause: r.cause })))}` });
  } finally {
    clearInterval(shotTimer);
    await ctx.close().catch(() => {});
    camoufoxContext = null;
  }
}

// The game's own status endpoint. "warn"/"down" means the server is in
// maintenance: no lobby, no party, no runs. The bot says so instead of
// spinning on a dead server.
async function serverStatus() {
  try {
    const res = await fetch('https://ro-survivors.com/status.json', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = await res.json();
    return (j && typeof j === 'object') ? j : null;
  } catch { return null; }
}
// status.json is a hand-written flag and it can go stale: it stayed
// "maintenance" long after both servers were back up. The lobby list is the
// truth (it says per-lobby "up" and "state"). Returns 'up', 'down' or
// 'unknown' (unknown = the list could not be read, so do not block on it).
async function serverLive() {
  try {
    const res = await fetch('https://ro-survivors.com/api/lobbies', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return 'unknown';
    const j = await res.json();
    const list = Array.isArray(j && j.lobbies) ? j.lobbies : [];
    if (!list.length) return 'unknown';
    return list.some(l => l && l.up !== false && (!l.state || l.state === 'ok')) ? 'up' : 'down';
  } catch { return 'unknown'; }
}
// A persistent profile keeps the game's HTTP cache and the account session
// between runs, so an instance starts warm instead of downloading the whole
// art pack again (that was ~80s per start).
const PROFILE_DIR = argv.profile || '';
async function launchPersistentContext() {
  const dir = PROFILE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  // Seed a fresh profile from a warm one: the game assets are the same for
  // every account, only the login differs.
  const seed = argv['cache-seed'];
  if (seed && fs.existsSync(seed) && !fs.existsSync(path.join(dir, 'Cache'))) {
    try { fs.cpSync(seed, path.join(dir, 'Cache'), { recursive: true, force: false }); log({ msg: `cache seeded from ${seed}` }); } catch {}
  }
  const GPU = argv.gpu === 'true';
  const cacheDir = argv['cache-dir'] || '';
  return await chromium.launchPersistentContext(dir, {
    headless: HEADLESS,
    viewport: { width: VIEWPORT[0], height: VIEWPORT[1] },
    deviceScaleFactor: DSF,
    ignoreHTTPSErrors: true,
    args: [
      ...(GPU ? ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan,SkiaGraphite'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']),
      ...(cacheDir ? [`--disk-cache-dir=${cacheDir}`] : []),
      '--disable-gpu-sandbox', '--no-sandbox',
      `--window-size=${VIEWPORT[0]},${VIEWPORT[1]}`,
      ...(NEED_PROXY ? ['--proxy-server=http://127.0.0.1:18080'] : []),
      '--ignore-certificate-errors', '--disable-dev-shm-usage', '--mute-audio',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    ],
  });
}
async function safeRunOnePage(page, runNo, job, stageKey) {
  try { return await runOneWithPage(page, runNo, job, stageKey); }
  catch (e) {
    log({ run: runNo, msg: `ERROR run ${runNo} (outside runOne): ${String(e).slice(0, 300)}` });
    return [{ run: runNo, job, stage: stageKey, cause: 'error: ' + String(e).slice(0, 200) }];
  }
}
async function runPersistent() {
  const results = [];
  await runPersistentRuns({
    runs: RUNS,
    launchContext: async () => {
      const ctx = await launchPersistentContext();
      camoufoxContext = ctx;
      return ctx;
    },
    runOne: async (page, runNo) => {
      const rs = await safeRunOnePage(page, runNo, JOB, STAGE);
      results.push(...rs);
      return rs;
    },
    sleep,
    betweenRunsMs: 3000,
    recoveryDelayMs: 2000,
    maxConsecutiveCrashes: 3,
  });
  camoufoxContext = null;
  const summary = { tag: RUN_TAG, bot: 'v6.2-persistent', job: JOB, stage: STAGE, runs: RUNS, maxSeconds: MAX_SECONDS, headless: HEADLESS, viewport: VIEWPORT.join('x'), dsf: DSF, patchedBundle: PATCHED ? path.relative(path.join(__dirname, '..'), PATCHED) : null, results };
  fs.writeFileSync(path.join(OUT, `summary-${RUN_TAG}.json`), JSON.stringify(summary, null, 2));
  log({ msg: `DONE. ${JSON.stringify(results.map(r => ({ run: r.run, job: r.job, stage: r.stage, s: r.survivedSeconds, gameS: r.gameSeconds, lv: r.level, kills: r.kills, cleared: !!r.cleared, cause: r.cause })))}` });
}
async function main() {
  await sleep(1500);
  log({ msg: `bot v6.2 PRE-BOSS THINNING start: recordVideo=${RECORD_VIDEO} headed=${!HEADLESS} job=${JOB} stage=${STAGE} compare=${COMPARE} ladder=${LADDER} maxLoot=${MAX_LOOT} runs=${RUNS} max ${MAX_SECONDS}s/run, headless=${HEADLESS}, viewport=${VIEWPORT.join('x')} dsf=${DSF}, probe=${PROBE}, out=${OUT}, patched=${PATCHED}` });
  if (!PATCHED || !fs.existsSync(PATCHED)) log({ msg: 'patched bundle unavailable — running the plain live bundle (the farm still works)' });
  if (!JOB_DEFS[JOB]) { console.error(`unknown job ${JOB} — use archer|mage|swordsman|acolyte`); process.exit(1); }
  const status = await serverStatus();
  if (status && status.state === 'down') {
    const when = status.at ? new Date(status.at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'soon';
    log({ msg: `server is down (${when}): ${status.message || 'maintenance'} — no runs until it reopens` });
    console.log(`[server] down: ${status.message || 'maintenance'} (${when})`);
    process.exit(0);
  }
  if (status && (status.state === 'maintenance' || status.state === 'warn') && status.message && /maintenance/i.test(status.message) && !process.env.RO_BOT_IGNORE_MAINTENANCE) {
    // Maintenance: the game cannot run, so do not burn a core waiting for it.
    // Poll the server and start the moment it is back. The game client reads
    // the very same status.json, so this flag is the truth.
    log({ msg: `server in maintenance — waiting (checked every 60s, starts automatically)` });
    for (;;) {
      await sleep(60000);
      const s = await serverStatus();
      if (s && s.state !== 'maintenance' && s.state !== 'down') { log({ msg: `server back (state=${s.state}) — starting` }); break; }
    }
  }
  if (CAMOUFOX) { await runCamoufox(); return; }
  if (PROFILE_DIR) { await runPersistent(); return; }
  if (ATTACH_EXISTING) { await runAttached(); return; }
  let browser = await launchBrowser();
  const results = [];
  let runNo = 0;
  if (COMPARE) {
    // One run per job, same config; pick the fastest clearer for the main runs.
    const compareResults = [];
    for (const job of ['archer', 'mage', 'swordsman']) {
      runNo++;
      browser = await ensureBrowser(browser);
      const rs = await safeRunOne(browser, runNo, job, 'prontera');
      compareResults.push(...rs);
      results.push(...rs);
      await sleep(3000);
    }
    const score = r => (r.cleared ? 100000 : 0) + (r.gameSeconds || 0) * 10 + (r.kills || 0);
    const best = [...compareResults].sort((a, b) => score(b) - score(a))[0];
    JOB = best.job;
    log({ msg: `COMPARE done: ${JSON.stringify(compareResults.map(r => ({ job: r.job, s: r.survivedSeconds, gameS: r.gameSeconds, lv: r.level, kills: r.kills, cleared: !!r.cleared, cause: r.cause })))} — BEST JOB: ${JOB}` });
  }
  for (let i = 0; i < RUNS; i++) {
    runNo++;
    browser = await ensureBrowser(browser);
    const rs = await safeRunOne(browser, runNo, JOB, STAGE);
    results.push(...rs);
    // v6: a state-lost abort is an environment failure (renderer died),
    // not a run — retry the slot once with a fresh attempt.
    if (rs.some(r => typeof r.cause === 'string' && r.cause.startsWith('state-lost'))) {
      log({ msg: `run ${runNo} aborted on state-lost — retrying the slot once with a fresh attempt` });
      runNo++;
      browser = await ensureBrowser(browser);
      const rs2 = await safeRunOne(browser, runNo, JOB, STAGE);
      results.push(...rs2);
      await sleep(3000);
    }
    if (i < RUNS - 1) await sleep(3000);
  }
  await browser.close().catch(() => {}); if (relay) relay.kill();
  const patchedSha = PATCHED ? require('crypto').createHash('sha256').update(fs.readFileSync(PATCHED)).digest('hex').slice(0, 16) : 'none';
  const summary = { tag: RUN_TAG, bot: 'v6.2-pre-boss-thinning', job: JOB, compare: COMPARE, ladder: LADDER, runs: RUNS, maxSeconds: MAX_SECONDS, headless: HEADLESS, viewport: VIEWPORT.join('x'), dsf: DSF, probe: PROBE, patchedBundle: PATCHED ? path.relative(path.join(__dirname, '..'), PATCHED) : null, patchedSha256: patchedSha, results };
  fs.writeFileSync(path.join(OUT, `summary-${RUN_TAG}.json`), JSON.stringify(summary, null, 2));
  log({ msg: `DONE. ${JSON.stringify(results.map(r => ({ run: r.run, job: r.job, stage: r.stage, s: r.survivedSeconds, gameS: r.gameSeconds, lv: r.level, kills: r.kills, cleared: !!r.cleared, cause: r.cause })))}` });
}
main().catch(e => { console.error(e); if (relay) relay.kill(); process.exit(1); });
