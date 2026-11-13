// RO Survivors bot GUI engine — THIN FRONT-END.
//
// The brain is bot6.2.js itself, not a copy of it. This process only:
//   • launches the real CLI bot with exactly the flags the panel shows
//     (--attach-existing / --start-existing / --job / --stage / --lobby /
//      --objectives / --runs / --max-seconds / --max-loot / --ladder /
//      --cdp-url / --headless=false / --out),
//   • streams the bot's own log lines into the panel,
//   • parses the bot's RESULT / RESULT-OBJECTIVES / DONE lines so each
//     finished run is reported live (and survives a Stop, which never
//     produces a summary file),
//   • falls back to the summary-*.json the bot writes at natural batch end,
//   • offers `detect` and `login`, which drive the docked game pane over CDP
//     (the CLI has no such one-shot commands; everything else is the CLI's).
//
// Nothing here re-implements play logic. If the CLI gains a fix, the GUI gains
// it too, because the GUI runs the CLI.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { shouldAutoRestartInstance } = require('./instance-restart-policy');

// The dashboard connection (daemon mode). The engine can run detached from the
// window so the farm survives a window crash.
// The dashboard connection (daemon mode). Declared here so send() can use it.
// There can be more than one dashboard (a second window, a script), so every
// connected client gets the events: a single "last client wins" variable lost
// the farm's event stream once when a stray socket came and went.
const clients = new Set();

function send(ev) {
  const line = '@EVT@' + JSON.stringify(ev) + '\n';
  if (clients.size) {
    for (const c of clients) { try { c.write(line); } catch {} }
    return;
  }
  try { process.stdout.write(line); } catch {}
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A stray Playwright rejection (for example a dialog that vanished between
// the event and the accept) must never take the engine down: the batch would
// disappear without a trace.
process.on('unhandledRejection', (err) => { try { log(`engine: unhandled rejection: ${String(err && err.message || err).slice(0, 200)}`); } catch {} });
process.on('uncaughtException', (err) => { try { log(`engine: uncaught exception: ${String(err && err.message || err).slice(0, 200)}`); } catch {} });

const CFG_PATH = process.argv[2] || path.join(__dirname, 'config.json');
let CFG = {
  mode: 'account', username: '', password: '', job: 'mage', stage: 'prontera',
  lobby: 'Nidavellir', objectives: [], runs: 1, maxSeconds: 3600,
  ladder: false, maxLoot: true, out: path.join(process.cwd(), 'logs'),
};
// The CDP port and bot token are launch-scoped: main.js injects the ones for
// THIS launch with every command. Values left on disk by an older app version
// (or a closed session) are stale and are discarded here.
try {
  const disk = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  delete disk.cdpPort; delete disk.botToken;
  Object.assign(CFG, disk);
} catch {}

// Where the real bot lives. Same script the terminal runs.
const BOT_PATH = CFG.botPath || process.env.RO_BOT_PATH ||
  path.join(os.homedir(), '.local', 'share', 'ro-survivors-bot', 'bot', 'bot6.2.js');

// `node` must be resolvable even when the app was launched from a desktop
// launcher whose PATH has no version-manager shims.
function resolveNode() {
  const candidates = [process.env.RO_BOT_NODE, 'node',
    '/usr/bin/node', '/usr/local/bin/node', '/bin/node',
    path.join(os.homedir(), '.local/share/mise/installs/node', 'current', 'bin/node'),
    path.join(os.homedir(), '.nvm/versions/node')];
  for (const c of candidates) {
    if (!c) continue;
    if (c === 'node') {
      // Only trust the bare name if it actually resolves on PATH.
      const dirs = (process.env.PATH || '').split(':');
      if (dirs.some(d => { try { return d && fs.existsSync(path.join(d, 'node')); } catch { return false; } })) return 'node';
      continue;
    }
    if (fs.existsSync(c)) {
      if (fs.statSync(c).isDirectory()) { // e.g. .nvm/versions/node → pick newest
        try {
          const newest = fs.readdirSync(c).sort().pop();
          const p = path.join(c, newest, 'bin/node');
          if (newest && fs.existsSync(p)) return p;
        } catch {}
        continue;
      }
      return c;
    }
  }
  return null;
}

function log(msg, extra = {}) {
  const rec = { t: new Date().toISOString(), ...extra, msg };
  console.log(`[${rec.t.slice(11, 19)}]`, msg);
  send({ type: extra.run ? 'log-run' : 'log', rec });
}

function cdpUrl() { return `http://127.0.0.1:${CFG.cdpPort || 9222}`; }
function outDir() { return path.resolve(CFG.out || path.join(process.cwd(), 'logs')); }

// ---------- CLI flags (the panel is a view onto these) -------------------
const KNOWN_JOBS = ['mage', 'swordsman', 'archer', 'acolyte'];
const KNOWN_STAGES = ['prontera', 'sewer', 'culvert', 'sunken', 'byalan', 'payon_forest', 'payon_cave'];

function objectivesOf(cfg) {
  const raw = cfg.objectives;
  const list = (Array.isArray(raw) ? raw : String(raw || '').split(/[,\n;]/))
    .map(v => String(v).trim()).filter(Boolean);
  // Dedupe case-insensitively, keep the first spelling.
  const seen = new Set();
  return list.filter(v => { const k = v.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
// ---------- user builds (--builds) ---------------------------------------
// cfg.builds: { "<job>": { cards: ["...", ...], items: ["...", ...] } }
// Order = pick priority. Written to builds.json next to the GUI; the bot reads
// it via --builds and boosts listed picks over its own planner. Lists boost,
// they never ban — unlisted picks still use the bot's normal scoring.
function buildsData(cfg) {
  const src = cfg && cfg.builds && typeof cfg.builds === 'object' ? cfg.builds : {};
  const out = {};
  for (const [job, v] of Object.entries(src)) {
    if (!v || typeof v !== 'object') continue;
    const cards = Array.isArray(v.cards) ? v.cards.map(s => String(s).trim()).filter(Boolean) : [];
    const items = Array.isArray(v.items) ? v.items.map(s => String(s).trim()).filter(Boolean) : [];
    if (cards.length || items.length) out[String(job).toLowerCase()] = { cards, items };
  }
  return Object.keys(out).length ? out : null;
}
function writeBuildsFile(cfg) {
  const data = buildsData(cfg);
  if (!data) return null;
  const p = path.join(process.cwd(), 'builds.json');
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

function cliArgs(cfg) {
  return [
    BOT_PATH,
    '--attach-existing=true',
    '--start-existing=true',
    '--headless=false',
    `--cdp-url=${cdpUrl()}`,
    `--job=${cfg.job || 'mage'}`,
    `--stage=${cfg.stage || 'prontera'}`,
    `--lobby=${cfg.lobby || 'Nidavellir'}`,
    `--objectives=${JSON.stringify(objectivesOf(cfg))}`,
    `--runs=${Math.max(1, parseInt(cfg.runs, 10) || 1)}`,
    `--max-seconds=${Math.min(14400, Math.max(60, parseInt(cfg.maxSeconds, 10) || 3600))}`,
    `--max-loot=${cfg.maxLoot === false ? 'false' : 'true'}`,
    `--ladder=${cfg.ladder ? 'true' : 'false'}`,
    `--out=${outDir()}`,
  ];
}

// ---------- run lifecycle ------------------------------------------------
let child = null;        // the real bot process
let childBuf = '';
let stopping = false;
let busy = false;
let batchStartedAt = 0;
let finalResults = null;         // from the bot's final DONE line
const emittedRuns = new Set();   // run numbers already reported live
let liveResults = new Map();     // run → result, parsed from RESULT lines

function summariesIn(dir) {
  try { return fs.readdirSync(dir).filter(n => /^summary-.*\.json$/.test(n)); } catch { return []; }
}
function newestSummary(dir, startedAt) {
  try {
    const files = summariesIn(dir)
      .map(n => { try { return { n, m: fs.statSync(path.join(dir, n)).mtimeMs }; } catch { return null; } })
      .filter(Boolean)
      .filter(f => f.m >= startedAt - 1500)
      .sort((a, b) => a.m - b.m);
    const last = files.pop();
    if (!last) return null;
    return JSON.parse(fs.readFileSync(path.join(dir, last.n), 'utf8'));
  } catch { return null; }
}

// Summary-file results (full objects) and DONE-line results (brief objects)
// are normalised into one shape for the panel.
const normResult = r => ({
  run: r.run, job: r.job || CFG.job, stage: r.stage || CFG.stage,
  survivedSeconds: r.survivedSeconds ?? r.s ?? 0,
  gameSeconds: r.gameSeconds ?? r.gameS ?? null,
  level: r.level ?? r.lv ?? null,
  kills: r.kills ?? 0,
  cleared: !!r.cleared,
  cause: r.cause || '',
});
function emitRunResult(r, live) {
  if (r.run != null) emittedRuns.add(r.run);
  send({ type: 'run-result', live: live || undefined, result: r });
}
function emitResults(list) {
  const results = Array.isArray(list) ? list : [];
  for (const raw of results) {
    const r = normResult(raw);
    if (r.run != null && emittedRuns.has(r.run)) continue; // already reported live
    emitRunResult(r, false);
  }
  return results;
}

// The bot prints per-run results to stdout as it goes:
//   "RESULT run 2: 214s, lv 31, 402 kills, 38 picks, stateSeen=true, cause: dead | LOOT ..."
//   "RESULT-OBJECTIVES: [{...}]; progress=1/2; complete=false; ..."
//   "DONE. [{run,job,stage,s,gameS,lv,kills,cleared,cause}, ...]"
// Parsing them means every finished run is reported immediately — including
// when the batch ends via Stop, which never reaches the summary write.
function parseResultLine(msg) {
  const m = msg.match(/^RESULT run (\d+): ([\d.]+)s, lv ([^,]+), (\d+) kills/);
  if (!m) return null;
  const causeM = msg.match(/cause: ([^|]+)/);
  return {
    run: +m[1], job: CFG.job, stage: CFG.stage,
    survivedSeconds: +m[2], level: m[3].trim(), kills: +m[4],
    cleared: /cleared/i.test(msg), cause: causeM ? causeM[1].trim() : '',
  };
}
function parseObjectivesLine(msg) {
  const m = msg.match(/^RESULT-OBJECTIVES: (\[.*?\]);\s*progress=(\d+)\/(\d+);\s*complete=(\w+)/);
  if (!m) return null;
  try { return { status: JSON.parse(m[1]), found: +m[2], total: +m[3], complete: m[4] === 'true' }; }
  catch { return null; }
}
function parseDoneLine(msg) {
  if (!/^DONE\. /.test(msg)) return null;
  try { const v = JSON.parse(msg.slice(6)); return Array.isArray(v) ? v : null; } catch { return null; }
}

function onLine(raw) {
  const line = raw.replace(/\s+$/, '');
  if (!line) return;
  // The bot prints "[HH:MM:SS] message" (and JSON for structured events).
  const m = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s?(.*)$/);
  const msg = m ? m[2] : line;
  if (!m) { send({ type: 'console', line: msg }); return; }
  const rec = { t: new Date().toISOString(), stamp: m[1], msg };
  const res = parseResultLine(msg);
  const obj = parseObjectivesLine(msg);
  const done = parseDoneLine(msg);
  if (res) { const r = normResult(res); liveResults.set(r.run, r); emitRunResult(r, true); send({ type: 'log', rec }); return; }
  if (obj) { send({ type: 'objectives', ...obj }); send({ type: 'log', rec }); return; }
  if (done) { finalResults = done; send({ type: 'log', rec }); return; }
  send({ type: 'log', rec });
}

function cmdStart(cfg) {
  if (busy) { send({ type: 'error', msg: 'the bot is already running — press Stop first' }); return; }
  Object.assign(CFG, cfg || {});
  if (!fs.existsSync(BOT_PATH)) {
    send({ type: 'fatal', msg: `the bot script is missing at ${BOT_PATH} — set botPath in config.json` });
    return;
  }
  // Multi-account mode: the instances run their own headless browsers, so
  // the app's game window is not involved (no CDP pre-flight).
  if (Array.isArray(cfg && cfg.accounts) && cfg.accounts.length) { cmdStartMulti(cfg); return; }
  if (!KNOWN_JOBS.includes(String(CFG.job || '').toLowerCase())) {
    send({ type: 'fatal', msg: `unknown job "${CFG.job}" — the bot knows ${KNOWN_JOBS.join(', ')}` });
    return;
  }
  if (!KNOWN_STAGES.includes(String(CFG.stage || '').toLowerCase())) {
    send({ type: 'error', msg: `unknown stage "${CFG.stage}" — the bot falls back to prontera; check the panel` });
  }
  // Pre-flight: the bot must attach to the app's game window. If the CDP
  // endpoint is not up, the CLI's fallback is to launch the user's default
  // browser on that port — wrong inside the GUI, so refuse with the real
  // reason instead of popping a random browser.
  cdpAlive().then(alive => {
    if (!alive) {
      send({ type: 'error', msg: `the game window is not reachable on ${cdpUrl()} yet — wait for the game pane to finish loading, then press Start again` });
      return;
    }
    startChild();
  });
}

async function cdpAlive() {
  try {
    const res = await fetch(`${cdpUrl().replace(/\/$/, '')}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

function startChild() {
  const nodeBin = resolveNode();
  if (!nodeBin) {
    send({ type: 'fatal', msg: 'node was not found on this machine — install Node.js or set RO_BOT_NODE' });
    return;
  }
  const args = cliArgs(CFG);
  const buildsFilePath = writeBuildsFile(CFG);
  if (buildsFilePath) args.push(`--builds=${buildsFilePath}`);
  const dir = outDir();
  fs.mkdirSync(dir, { recursive: true });
  busy = true; stopping = false; childBuf = '';
  finalResults = null; emittedRuns.clear(); liveResults = new Map();
  batchStartedAt = Date.now();
  log(`GUI → bot6.2.js: ${args.slice(1).join(' ')}`);
  send({ type: 'batch-start', cfg: {
    mode: CFG.mode, job: CFG.job, stage: CFG.stage, lobby: CFG.lobby,
    runs: CFG.runs, maxSeconds: CFG.maxSeconds, maxLoot: CFG.maxLoot,
    objectives: objectivesOf(CFG),
  } });
  child = spawn(nodeBin, args, { cwd: path.dirname(BOT_PATH), env: process.env });
  child.stdout.on('data', d => {
    childBuf += d.toString();
    let i;
    while ((i = childBuf.indexOf('\n')) >= 0) {
      const line = childBuf.slice(0, i);
      childBuf = childBuf.slice(i + 1);
      onLine(line);
    }
  });
  child.stderr.on('data', d => send({ type: 'stderr', line: d.toString().trim().slice(0, 400) }));
  // A failed spawn (missing node, bad cwd) otherwise leaves busy=true forever.
  child.on('error', e => {
    child = null; busy = false; stopping = false;
    send({ type: 'fatal', msg: 'could not start bot6.2.js: ' + String(e && e.message || e).slice(0, 300) });
    send({ type: 'batch-done', results: [], error: String(e && e.message || e).slice(0, 200) });
  });
  child.on('exit', (code, signal) => {
    const wasStopping = stopping;
    child = null; busy = false; stopping = false;
    const brief = resultsFromSources(dir);
    send({ type: 'batch-done', results: brief, stopped: wasStopping || undefined, count: brief.length });
    log(`bot6.2.js exited (code=${code}${signal ? ` signal=${signal}` : ''})${wasStopping ? ' — stopped by request' : ''}${brief.length ? ` · ${brief.length} run(s) reported` : ' · no completed runs'}`);
  });
}

// Authoritative order: the bot's DONE line → its summary file → the RESULT
// lines already parsed live. Sources are merged by run number so a batch
// ended by Stop (no DONE, no summary) still reports every completed run.
function resultsFromSources(dir, inst = null) {
  let source = inst ? inst.finalResults : finalResults;
  if (!source || !source.length) {
    const summary = newestSummary(dir, batchStartedAt);
    if (summary && Array.isArray(summary.results) && summary.results.length) source = summary.results;
  }
  const byRun = new Map();
  const liveSource = inst ? inst.liveResults : liveResults;
  for (const [run, r] of liveSource) byRun.set(run, r);
  for (const r of Array.isArray(source) ? source : []) {
    if (r && r.run != null) byRun.set(r.run, r);
  }
  const merged = [...byRun.values()];
  if (!inst) emitResults(merged);
  return merged.map(r => normResult(r));
}

// ---------- multi-account headless instances -----------------------------
// One bot process per account, each with its own headless browser, its own
// output folder and its own 5s preview screenshot. The engine is the
// controller: it spawns, watches, aggregates and stops them all.
let instances = [];   // [{ proc, index, account, buf, results, done }]

function multiOutDir(index, username) {
  const safe = String(username || 'account').replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(outDir(), `acct-${index}-${safe}`);
}
// ---------- live preview frames (in memory) -------------------------------
// The bot streams its screencast frames to this process over HTTP; they are
// kept in RAM and handed to the panel. Nothing is written to disk per frame
// (a farm would otherwise do ~20 writes per second per instance).
const http = require('http');
let frameServer = null;
let framePort = 0;
const frameStore = new Map();   // instance index -> { buf, at }
function startFrameServer() {
  frameServer = http.createServer((req, res) => {
    // Only the path matters: the panel appends a cache-busting query string.
    const pathname = String(req.url || '').split('?')[0];
    const m = pathname.match(/^\/frame\/(\d+)$/);
    if (!m) { res.writeHead(404); res.end(); return; }
    const idx = m[1];
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        frameStore.set(idx, { buf: Buffer.concat(chunks), at: Date.now() });
        res.writeHead(204); res.end();
      });
      return;
    }
    const f = frameStore.get(idx);
    if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'content-length': f.buf.length });
    res.end(f.buf);
  });
  frameServer.listen(0, '127.0.0.1', () => {
    framePort = frameServer.address().port;
    log(`preview frame server on http://127.0.0.1:${framePort}`);
  });
}
startFrameServer();

function multiArgs(cfg, index, account) {
  const out = multiOutDir(index, account.username);
  // A profile that has already played holds the game's cached art; new
  // accounts copy it instead of downloading everything again.
  const seedProfile = path.join(multiOutDir(0, (Array.isArray(cfg.accounts) && cfg.accounts[0] && cfg.accounts[0].username) || 'seed'), 'profile');
  const args = [
    BOT_PATH,
    '--attach-existing=false',
    '--headless=true',
    `--job=${account.job || cfg.job || 'mage'}`,
    `--stage=${account.stage || cfg.stage || 'prontera'}`,
    `--lobby=${account.lobby || cfg.lobby || 'Nidavellir'}`,    `--objectives=${JSON.stringify(objectivesOf(cfg))}`,
    `--runs=${Math.max(1, parseInt(cfg.runs, 10) || 1)}`,
    `--max-seconds=${Math.min(14400, Math.max(60, parseInt(cfg.maxSeconds, 10) || 3600))}`,
    `--max-loot=${cfg.maxLoot === false ? 'false' : 'true'}`,
    `--ladder=${cfg.ladder ? 'true' : 'false'}`,
    `--out=${out}`,
    `--shot=frame-${index}.jpg`,
    '--shot-every=5',
    // A persistent profile per account: the game's art stays cached and the
    // login survives, so a start is warm instead of a cold download.
    `--profile=${path.join(out, 'profile')}`,
    ...(seedProfile ? [`--cache-seed=${seedProfile}`] : []),
    // Native-scale rendering (sharp preview) but a modest canvas, a 20 fps cap
    // and the real GPU: the headless games must not eat the whole 4-core box.
    '--dsf=1',
    '--viewport=640x400',
    '--fps=20',
    '--gpu=true',
    '--loop-ms=400',
    // Live preview frames go to the engine over HTTP (kept in memory there).
    ...(framePort ? [`--frame-port=${framePort}`, `--frame-index=${index}`] : []),
  ];
  // Party play: the first instance leads and invites the next one; the rest
  // wait for the invitation and follow the leader's trip.
  if (cfg.party) {
    args.push('--party=true');
    const ally = (Array.isArray(cfg.accounts) ? cfg.accounts : []).find((a, i) => i > index && a && a.character);
    if (index === 0 && ally) args.push(`--ally=${ally.character}`);
  }
  const buildsFile = writeBuildsFile(cfg);
  if (buildsFile) args.push(`--builds=${buildsFile}`);
  return { args, out };
}
function cmdStartMulti(cfg) {
  const accounts = Array.isArray(cfg.accounts) ? cfg.accounts.filter(a => a && a.username) : [];
  if (!accounts.length) { send({ type: 'error', msg: 'no accounts configured — add one in Settings → Accounts' }); return; }
  const nodeBin = resolveNode();
  if (!nodeBin) { send({ type: 'fatal', msg: 'node was not found on this machine — install Node.js or set RO_BOT_NODE' }); return; }
  busy = true; stopping = false; finalResults = null; emittedRuns.clear(); liveResults = new Map();
  batchStartedAt = Date.now();
  instances = [];
  const started = [];
  accounts.forEach((account, index) => {
    const out = multiOutDir(index, account.username);
    started.push({ index, username: account.username, job: account.job || cfg.job, stage: account.stage || cfg.stage, out, shot: path.join(out, `frame-${index}.jpg`) });
  });
  send({ type: 'batch-start', cfg: {
    mode: 'multi', job: cfg.job, stage: cfg.stage, lobby: cfg.lobby,
    runs: cfg.runs, maxSeconds: cfg.maxSeconds, maxLoot: cfg.maxLoot,
    objectives: objectivesOf(cfg), instances: started, framePort,
  } });
  // Start the instances one after another: on a small box two cold game loads
  // at once fight for the CPU, and the first bot then plays sooner.
  let next = 0;
  const batchStart = Date.now();
  const spawnNext = () => {
    if (next >= accounts.length || stopping) return;
    const prev = next > 0 ? instances[next - 1] : null;
    const prevReady = prev && frameStore.has(String(next - 1));
    if (prev && !prevReady && Date.now() - batchStart < 150000) { setTimeout(spawnNext, 2000); return; }
    const index = next++;
    instances[index] = spawnInstance(index, accounts[index], cfg, accounts.length);
    setTimeout(spawnNext, 2000);
  };
  spawnNext();
}
function spawnInstance(index, account, cfg, total) {
  const { args, out } = multiArgs(cfg, index, account);
  fs.mkdirSync(out, { recursive: true });
  const env = { ...process.env };
  if (account.password) { env.RO_BOT_USER = account.username; env.RO_BOT_PASS = account.password; }
  log(`instance ${index + 1}/${total || '?'} (${account.username}) → ${args.slice(1).join(' ')}`);
  const proc = spawn(resolveNode(), args, { cwd: path.dirname(BOT_PATH), env });
  // The farm must never starve the desktop: run every instance at low
  // priority (children inherit it) so the browser, video and chat stay
  // smooth even when several games are rendering.
  try { os.setPriority(proc.pid, 15); } catch {}
  const inst = { proc, index, account, out, buf: '', results: [], liveResults: new Map(), finalResults: null, done: false, userStopped: false, restarting: false, error: null };
  instances[index] = inst;
  proc.stdout.on('data', d => {
    inst.buf += d.toString();
    let i;
    while ((i = inst.buf.indexOf('\n')) >= 0) {
      const line = inst.buf.slice(0, i);
      inst.buf = inst.buf.slice(i + 1);
      onMultiLine(inst, line);
    }
  });
  proc.stderr.on('data', d => send({ type: 'stderr', line: d.toString().trim().slice(0, 400), account: account.username }));
  proc.on('error', e => {
    inst.done = true; inst.error = String(e && e.message || e).slice(0, 200);
    send({ type: 'instance', index: inst.index, account: account.username, state: 'error', error: inst.error });
    checkMultiDone();
  });
  proc.on('exit', (code, signal) => {
    inst.done = true;
    const brief = resultsFromSources(out, inst);
    inst.results = brief;
    const wasStopping = stopping;
    send({ type: 'instance', index: inst.index, account: account.username, state: (wasStopping || inst.userStopped) ? 'stopped' : (code === 0 ? 'done' : 'ended'), code, signal, count: brief.length, error: inst.error });
    const finished = code === 0 && brief.length > 0;
    if (shouldAutoRestartInstance(inst, { stopping, wasStopping, finished })) {
      const tries = (inst.restarts || 0) + 1;
      if (tries <= 8) {
        log(`instance ${inst.index + 1} (${account.username}) ended unexpectedly (code=${code}) — restarting in 20s (try ${tries})`);
        inst.restarts = tries;
        setTimeout(() => {
          if (stopping || inst.userStopped) return;
          const fresh = spawnInstance(inst.index, account, cfg, total);
          fresh.restarts = tries;
          instances[inst.index] = fresh;
          send({ type: 'instance', index: inst.index, account: account.username, state: 'restarted' });
        }, 20000);
        return;
      }
      log(`instance ${inst.index + 1} (${account.username}) died too often — giving up on it`);
    }
    checkMultiDone();
  });
  return inst;
}
// Per-instance controls: stop one bot, or reset it (kill and respawn).
function cmdInstanceAction(index, action) {
  const inst = instances.find(i => i && i.index === index);
  if (!inst) { send({ type: 'error', msg: `instance ${index + 1} is not running` }); return; }
  if (action === 'restart') {
    log(`instance ${index + 1} (${inst.account.username}): resetting`);
    inst.restarting = true;
    inst.userStopped = false;
    try { inst.proc.kill('SIGTERM'); } catch {}
    const wait = setInterval(() => {
      if (!inst.done) return;
      clearInterval(wait);
      if (stopping) { inst.restarting = false; return; }
      const total = instances.length;
      const fresh = spawnInstance(index, inst.account, CFG, total);
      instances[index] = fresh;
      send({ type: 'instance', index, account: inst.account.username, state: 'restarted' });
    }, 400);
    return;
  }
  log(`instance ${index + 1} (${inst.account.username}): stopping on request`);
  inst.userStopped = true;
  try { inst.proc.kill('SIGTERM'); } catch {}
}
function onMultiLine(inst, raw) {
  const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
  if (!line) return;
  const rec = { t: new Date().toISOString(), stamp: (line.match(/^\[(\d{2}:\d{2}:\d{2})\]/) || [])[1], msg: line };
  const res = parseResultLine(line);
  const obj = parseObjectivesLine(line);
  const done = parseDoneLine(line);
  const tag = { account: inst.account.username, index: inst.index };
  if (res) {
    const r = normResult(res);
    inst.liveResults.set(r.run, r);
    liveResults.set(`${inst.index}:${r.run}`, r);
    send({ type: 'run-result', result: r, live: true, ...tag });
    send({ type: 'log', rec, ...tag });
    return;
  }
  if (obj) { send({ type: 'objectives', ...obj, ...tag }); send({ type: 'log', rec, ...tag }); return; }
  if (done) { inst.finalResults = done; finalResults = done; send({ type: 'log', rec, ...tag }); return; }
  send({ type: 'log', rec, ...tag });
}
function checkMultiDone() {
  if (!instances.length) return;
  if (!instances.every(i => i && i.done && !i.restarting)) return;
  const all = [];
  for (const i of instances) for (const r of i.results) all.push({ ...r, account: i.account.username });
  const wasStopping = stopping;
  busy = false; stopping = false;
  send({ type: 'batch-done', results: all, count: all.length, stopped: wasStopping || undefined });
  log(`all ${instances.length} instance(s) finished — ${all.length} run(s) reported`);
  instances = [];
}
function cmdStopMulti() {
  if (!instances.length) { log('stop: no instances are running'); return; }
  stopping = true;
  // Snapshot the list: the fallback timer must only ever kill THIS batch,
  // never the instances of a batch that started after the stop.
  const list = instances.slice();
  log(`stop requested — SIGTERM to ${list.length} instance(s)`);
  for (const i of list) { try { i.proc.kill('SIGTERM'); } catch {} }
  setTimeout(() => {
    for (const i of list) if (!i.done) { try { i.proc.kill('SIGKILL'); } catch {} }
  }, 10000);
}

function cmdStop() {
  if (!child) { log('stop: no bot is running'); return; }
  stopping = true;
  log('stop requested — SIGTERM to bot6.2.js; completed runs were already reported live above');
  try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => {
    if (child) { log('bot did not exit in 10s — killing it'); try { child.kill('SIGKILL'); } catch {} }
  }, 10000);
}

// ---------- detect / login (panel-only helpers on the docked pane) -------
// Refuse to drive the page while a run owns it: a second Playwright session
// clicking around mid-run would fight the bot.
function guardBusy() {
  if (!busy) return true;
  send({ type: 'error', msg: 'a run is in progress — wait for it or press Stop first' });
  return false;
}

async function connectPage() {
  const { chromium } = require('playwright-core');
  let browser = null;
  for (let i = 0; i < 30 && !browser; i++) {
    try { browser = await chromium.connectOverCDP(cdpUrl(), { timeout: 4000 }); }
    catch { await sleep(1000); }
  }
  if (!browser) throw new Error(`cannot reach the app's game window over CDP at ${cdpUrl()}`);
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if ((p.url() || '').includes('ro-survivors.com')) {
        // Swallow dialogs safely: a dialog that disappears mid-handle throws
        // "No dialog is showing", which must not crash the app.
        try { p.on('dialog', d => { d.dismiss().catch(() => {}); }); } catch {}
        // The app tags its game page with a per-launch token; refuse anything
        // else so the engine can never drive some other browser's tab.
        const tagged = await p.evaluate(t => localStorage.getItem('__ro_bot_token__') === t, String(CFG.botToken || '')).catch(() => false);
        if (!tagged) throw new Error('the game page is not tagged by this app — reload the game window (↻) and try again');
        return p;
      }
    }
  }
  throw new Error('the game window is not on ro-survivors.com yet — reload it (↻) and try again');
}

async function readWhere(page) {
  return page.evaluate(() => {
    const vis = s => { const el = document.querySelector(s); return !!el && !el.classList.contains('hidden'); };
    let plaza = false;
    try { plaza = typeof window.__RO_PLAZA_SNAPSHOT__ === 'function' && !!(window.__RO_PLAZA_SNAPSHOT__() || {}).ok; } catch {}
    return { splash: !!document.querySelector('#sp-play'), charselect: vis('#charselect'), hud: vis('#hud'), plaza, gameover: vis('#gameover') };
  }).catch(() => ({ splash: false, charselect: false, hud: false, plaza: false, gameover: false }));
}
// The splash loading bar takes ~25s; give it a bounded window (the old loop
// waited up to 10 minutes in silence) and tell the panel what is happening.
async function splashReady(page, maxMs = 120000) {
  const t0 = Date.now();
  let nextNotice = 0;
  while (Date.now() - t0 < maxMs) {
    const ok = await page.evaluate(() => { const b = document.querySelector('#sp-play'); return !!b && !b.disabled; }).catch(() => false);
    if (ok) return true;
    if (Date.now() >= nextNotice) {
      send({ type: 'detect-progress', msg: `waiting for the game splash to become ready… ${Math.round((Date.now() - t0) / 1000)}s` });
      nextNotice = Date.now() + 10000;
    }
    await page.waitForTimeout(1000);
  }
  return false;
}
async function readSlots(page) {
  const slots = await page.evaluate(() => [...document.querySelectorAll('#slots > *')].map(el => {
    const txt = el.textContent.replace(/\s+/g, ' ').trim().slice(0, 160);
    const empty = /empty slot|ranura vac/i.test(txt);
    const name = txt.split(/(?=swordsman|espadach|thief|ladr|mage|mago|wizard|archer|arquero|acolyte|acólito|merchant|mercader)/i)[0].trim().slice(0, 32);
    return { text: txt, name: name || txt.slice(0, 12), empty };
  })).catch(() => []);
  return slots.filter(s => !s.empty);
}
async function domClick(page, sel) {
  return page.evaluate(s => {
    const b = document.querySelector(s); if (!b) return null;
    const r = b.getBoundingClientRect();
    const st = { disabled: b.disabled, text: (b.textContent || '').trim().slice(0, 40), visible: r.width > 0 && r.height > 0 };
    b.click(); return st;
  }, sel).catch(() => null);
}

async function cmdDetect(cfg) {
  if (!guardBusy()) return null;
  Object.assign(CFG, cfg || {});
  const page = await connectPage();
  let where = await readWhere(page);
  let note = null;
  if (where.hud) note = 'the game is inside a run — the list is only readable from the character screen';
  if (where.splash) {
    if (!await splashReady(page)) note = 'the game window never finished loading — check the game pane and retry';
    else {
      log(`splash Play click: ${JSON.stringify(await domClick(page, '#sp-play'))}`);
      await page.waitForTimeout(3000);
      where = await readWhere(page);
    }
  }
  if (where.plaza) {
    const switched = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button, [data-act]')]
        .find(b => /switch\s+character/i.test(b.textContent || '') && b.getBoundingClientRect().width > 0);
      if (!el) return false;
      el.click(); return true;
    }).catch(() => false);
    if (switched) {
      for (let i = 0; i < 60; i++) {
        where = await readWhere(page);
        if (where.charselect) break;
        await page.waitForTimeout(250);
      }
    } else note = 'in town and no "Switch character" control is visible';
  }
  for (let i = 0; i < 10 && !where.charselect && !where.hud; i++) {
    await page.waitForTimeout(500);
    where = await readWhere(page);
  }
  const chars = where.charselect ? await readSlots(page) : [];
  if (!note && !chars.length) note = 'no characters on the select screen';
  send({ type: 'detect', chars, atCharSelect: where.charselect, note });
  return chars;
}

async function cmdLogin(cfg) {
  if (!guardBusy()) return false;
  Object.assign(CFG, cfg || {});
  const user = CFG.username || '', pass = CFG.password || '';
  const page = await connectPage();
  const where = await readWhere(page);
  if (where.hud || where.plaza || where.charselect) {
    log('already signed in — no login needed');
    send({ type: 'login', ok: true, user: user || 'session', already: true });
    return true;
  }
  if (!user || !pass) throw new Error('no saved account — add your username and password in Settings');
  if (!await splashReady(page)) throw new Error('the game window never became ready to sign in');
  log(`account login: user "${user}"`);
  // The splash puts a "You now need an account" modal over everything once
  // Play is pressed while signed out. It blocks the login tab.
  await page.evaluate(() => {
    const all = [...document.querySelectorAll('button, .ro-btn, [role=button]')];
    const b = all.find(x => /i have an account/i.test((x.textContent || '').trim()));
    if (b) b.click();
  }).catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => { const t = document.querySelector('[data-sp-tab="login"]'); if (t) t.click(); });
  await page.waitForTimeout(600);
  const fired = await page.evaluate(({ u, p }) => {
    const form = document.querySelector('#sp-login');
    if (!form) return { ok: false, err: '#sp-login form not found' };
    const ui = form.querySelector('input[name="username"]'), pi = form.querySelector('input[name="password"]');
    if (!ui || !pi) return { ok: false, err: 'username/password inputs not found' };
    ui.value = u; ui.dispatchEvent(new Event('input', { bubbles: true }));
    pi.value = p; pi.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = form.querySelector('button[type="submit"], .sp-submit');
    if (!btn) return { ok: false, err: 'submit button not found' };
    btn.click();
    return { ok: true };
  }, { u: user, p: pass }).catch(e => ({ ok: false, err: String(e) }));
  if (!fired.ok) throw new Error('login failed: ' + fired.err);
  for (let waited = 0; waited < 90000; waited += 2000) {
    const st = await page.evaluate(() => {
      const form = document.querySelector('#sp-login');
      const err = form ? form.querySelector('.sp-error') : null;
      const play = document.querySelector('#sp-play');
      const leave = document.querySelector('#sp-leave');
      return { err: err ? err.textContent.trim() : null, playEnabled: !!(play && !play.disabled), leaveVisible: !!(leave && !leave.classList.contains('hidden')) };
    }).catch(() => ({}));
    if (st.err) throw new Error('login rejected: ' + st.err);
    if (st.playEnabled && (st.leaveVisible || waited > 20000)) {
      log(`login OK after ~${waited / 1000}s`);
      send({ type: 'login', ok: true, user });
      return true;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error('login timed out after 90s (no error, no success)');
}

// ---------- shutdown -----------------------------------------------------
// SIGTERM (from the app's Force kill / window close) must also stop the bot
// child — killing only this process would orphan it.
function shutdown(graceMs = 3000) {
  let exiting = false;
  return signal => {
    if (exiting) return;
    exiting = true;
    if (child) {
      log(`shutting down (${signal}) — stopping bot6.2.js`);
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { if (child) child.kill('SIGKILL'); } catch {}; process.exit(143); }, graceMs);
    } else {
      process.exit(0);
    }
  };
}
const onSignal = shutdown();
process.on('SIGTERM', () => onSignal('SIGTERM'));
process.on('SIGINT', () => onSignal('SIGINT'));

// ---------- command loop -------------------------------------------------
// The engine can run as a daemon (a TCP server on 127.0.0.1) so the farm keeps
// farming even when the dashboard window dies or is closed. The window then
// just connects to it.
const net = require('net');
const DAEMON = process.argv.includes('--daemon');
const DAEMON_FILE = path.join(__dirname, 'engine.json');

function handleCommand(line) {
  const s = String(line || '').trim(); if (!s) return;
  let cmd; try { cmd = JSON.parse(s); } catch { return; }
  (async () => {
    try {
      if (cmd.cmd === 'start') cmdStart(cmd.cfg || {});
      else if (cmd.cmd === 'detect') await cmdDetect(cmd.cfg || {});
      else if (cmd.cmd === 'login') await cmdLogin(cmd.cfg || {});
      else if (cmd.cmd === 'stop') { if (instances.length) cmdStopMulti(); else cmdStop(); }
      else if (cmd.cmd === 'instance') cmdInstanceAction(
        (cmd.cfg && cmd.cfg.index != null ? cmd.cfg.index : cmd.index),
        (cmd.cfg && cmd.cfg.action ? cmd.cfg.action : cmd.action));
      else if (cmd.cmd === 'ping') send({ type: 'pong' });
      else if (cmd.cmd === 'state') send({ type: 'state', instances: instances.map(i => ({ index: i.index, username: i.account.username, done: !!i.done })), busy });
    } catch (e) { send({ type: 'error', msg: String(e && e.message || e).slice(0, 400) }); }
  })();
}

async function main() {
  const patchedDir = path.join(__dirname, '..', 'rea', 'patched');
  const patched = (() => {
    // bundle.json is the authority (the patch tool writes it for the current
    // live build); the folder also holds older builds.
    try {
      const m = JSON.parse(fs.readFileSync(path.join(patchedDir, 'bundle.json'), 'utf8'));
      if (m && m.ok && m.name) {
        const p = path.join(patchedDir, m.name);
        if (fs.existsSync(p)) return p;
      }
    } catch {}
    try { const f = fs.readdirSync(patchedDir).find(n => /^main-[A-Za-z0-9_-]+\.js$/.test(n)); return f ? path.join(patchedDir, f) : null; } catch { return null; }
  })();
  if (!fs.existsSync(BOT_PATH)) log(`WARN bot script not found at ${BOT_PATH} — set botPath in the app config`);
  else log(`brain: ${BOT_PATH} (same script as the terminal)`);
  const readyEvent = () => ({ type: 'ready', engine: 'front-end', bot: fs.existsSync(BOT_PATH) ? BOT_PATH : null, out: outDir(), patched });
  try { require('playwright-core'); send(readyEvent()); }
  catch (e) {
    send({ type: 'fatal', msg: 'playwright-core is missing in the app folder — run npm install in the gui directory' });
    send({ type: 'ready', engine: 'front-end', bot: fs.existsSync(BOT_PATH) ? BOT_PATH : null, out: outDir(), patched: null });
  }

  if (DAEMON) {
    const server = net.createServer(sock => {
      clients.add(sock);
      log(`dashboard connected (${sock.remoteAddress}:${sock.remotePort})`);
      sock.on('data', d => { for (const line of d.toString().split('\n')) if (line.trim()) handleCommand(line); });
      sock.on('error', () => {});
      sock.on('close', () => { clients.delete(sock); log(`dashboard disconnected (${sock.remoteAddress}:${sock.remotePort})`); });
      // A window that connects later must get the same "ready" handshake as the
      // first one, otherwise its first command would sit in the queue forever.
      send(readyEvent());
      if (instances.length) {
        send({ type: 'batch-start', cfg: {
          mode: 'multi', job: CFG.job, stage: CFG.stage, lobby: CFG.lobby,
          runs: CFG.runs, maxSeconds: CFG.maxSeconds, maxLoot: CFG.maxLoot,
          objectives: objectivesOf(CFG), framePort,
          instances: instances.map(i => ({
            index: i.index, username: i.account.username,
            job: i.account.job || CFG.job, stage: i.account.stage || CFG.stage,
            out: i.out, shot: path.join(i.out, `frame-${i.index}.jpg`),
          })),
        } });
      }
    });
    server.on('error', e => { console.error('engine daemon socket error:', e && e.message); });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      try { fs.writeFileSync(DAEMON_FILE, JSON.stringify({ port, pid: process.pid, started: Date.now() })); } catch {}
      log(`engine daemon listening on 127.0.0.1:${port} (pid ${process.pid})`);
    });
    // A daemon has no stdin to close: keep running until told to stop.
    return;
  }

  const rl = require('readline').createInterface({ input: process.stdin, terminal: false });
  rl.on('line', handleCommand);
  rl.on('close', () => onSignal('stdin-closed'));
}
main().catch(e => { send({ type: 'fatal', msg: String(e && e.message || e).slice(0, 400) }); console.error(e); process.exit(1); });
