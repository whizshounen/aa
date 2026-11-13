// Control panel. Everything here maps 1:1 onto a CLI flag of bot6.2.js:
//   session  -> --attach-existing (+ which profile to use)
//   job      -> --job          stage   -> --stage      lobby -> --lobby
//   objectives -> --objectives runs    -> --runs       max   -> --max-seconds
//   max loot -> --max-loot     ladder  -> --ladder
const $ = id => document.getElementById(id);
const logEl = $('log');
let running = false, sessionMode = 'account', ctx = null, autoLoginTried = false;
let runStart = null, tickTimer = null;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Autoscroll only when the reader is at the bottom — scrolling up to read
// must not be yanked back down by the next line.
function log(line, cls = '') {
  const stick = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.innerHTML = esc(line).replace(/^(\[\d{2}:\d{2}:\d{2}\])/, '<span class="t">$1</span>');
  logEl.appendChild(d);
  while (logEl.children.length > 600) logEl.firstChild.remove();
  if (stick) logEl.scrollTop = logEl.scrollHeight;
}
const stamp = () => `[${new Date().toTimeString().slice(0, 8)}]`;
function status(text, cls = 'idle') { const s = $('status'); s.textContent = text; s.className = 'pill ' + cls; }

// One switch for everything that must be locked while the bot plays:
// start/stop/kill, detect, game reload and the profile segments (a profile
// switch would destroy the CDP page the bot is driving).
function setRunning(v) {
  running = v;
  $('btn-start').disabled = v;
  $('btn-stop').disabled = !v;
  $('btn-kill').disabled = !v;
  $('btn-detect').disabled = v;
  $('btn-reload').disabled = v;
  for (const b of $('seg-session').querySelectorAll('button')) b.disabled = v;
  if (v) {
    runStart = Date.now();
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 1000);
    tick();
  } else {
    clearInterval(tickTimer); tickTimer = null; runStart = null;
  }
}
function tick() {
  if (!runStart) return;
  const s = Math.floor((Date.now() - runStart) / 1000);
  status(`running · ${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`, 'busy');
}

// ---- form <-> config ---------------------------------------------------
function cfgFromForm() {
  const cfg = {
    mode: sessionMode,
    job: $('f-job').value,
    stage: $('f-stage').value,
    lobby: $('f-lobby').value,
    objectives: $('f-objectives').value.split(/[,\n;]/).map(s => s.trim()).filter(Boolean),
    runs: Math.min(999, Math.max(1, parseInt($('f-runs').value) || 1)),
    maxSeconds: Math.min(14400, Math.max(60, parseInt($('f-max').value) || 3600)),
    maxLoot: $('f-maxloot').checked,
    ladder: $('f-ladder').checked,
    out: 'logs',
  };
  if (runMode === 'multi') {
    const n = Math.min(10, Math.max(1, parseInt($('f-instances').value, 10) || 1));
    const same = $('f-same-area').checked;
    cfg.mode = 'multi';
    cfg.accounts = accounts.slice(0, n).map(a => ({
      username: a.username, password: a.password, job: a.job || '',
      character: a.character || '',
      // With "all bots use the panel's stage and lobby" ticked, the per
      // account area is ignored and the panel's values apply to everyone.
      stage: same ? '' : (a.stage || ''),
      lobby: same ? '' : (a.lobby || ''),
    }));
    cfg.party = $('f-party').checked;
    // Each instance runs the panel's run count (the farm loops per account).
    cfg.runs = Math.min(999, Math.max(1, parseInt($('f-runs').value, 10) || 1));
  }
  return cfg;
}
function cfgToForm(c) {
  if (!c) return;
  setSession(c.mode === 'guest' ? 'guest' : 'account');
  if (c.job) $('f-job').value = c.job;
  if (c.stage) $('f-stage').value = c.stage;
  if (c.lobby) $('f-lobby').value = c.lobby;
  $('f-objectives').value = Array.isArray(c.objectives) ? c.objectives.join(', ') : (c.objectives || '');
  if (c.runs) $('f-runs').value = c.runs;
  if (c.maxSeconds) $('f-max').value = c.maxSeconds;
  if (typeof c.maxLoot === 'boolean') $('f-maxloot').checked = c.maxLoot;
  if (typeof c.ladder === 'boolean') $('f-ladder').checked = c.ladder;
}
function setSession(mode) {
  sessionMode = mode;
  for (const b of $('seg-session').querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.mode === mode);
    b.disabled = running;
  }
  $('session-hint').textContent = mode === 'guest'
    ? 'Guest profile: a separate, empty game profile. Your signed-in account is untouched.'
    : 'Uses the account already signed in in the game window. Nothing is logged out.';
}
$('seg-session').onclick = async e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  setSession(b.dataset.mode);
  // Each mode has its own game profile, so switching reloads the game pane
  // into that profile instead of mixing sessions.
  const res = await window.app.setProfile(b.dataset.mode);
  if (res && res.ok === false) log(`${stamp()} ${res.reason || 'profile switch refused'}`, 'bad');
  else { log(`${stamp()} game profile: ${b.dataset.mode}`, 'dim'); updateFoot(); }
};

// ---- characters --------------------------------------------------------
function renderChars(chars, note) {
  const el = $('chars');
  el.innerHTML = '';
  if (note && (!chars || !chars.length)) { el.innerHTML = `<span class="empty">${esc(note)}</span>`; return; }
  if (!chars || !chars.length) { el.innerHTML = '<span class="empty">no characters found</span>'; return; }
  for (const c of chars) {
    const row = document.createElement('div');
    row.className = 'c';
    row.innerHTML = `<b>${esc(c.name || 'character')}</b><span>${esc((c.text || '').slice(0, 60))}</span>`;
    row.title = c.text || '';
    row.style.cursor = 'pointer';
    // Picking a character selects the job the bot must run as: the CLI matches
    // the character whose job line carries that job (--job), so this is the one
    // setting that decides which character the bot plays.
    row.onclick = () => {
      const m = (c.text || '').match(/swordsman|espadach|thief|ladr|mage|mago|wizard|archer|arquero|acolyte|acólito|priest|sacerdote|merchant|mercader/i);
      if (!m) { log(`${stamp()} could not read a job from "${c.name || 'character'}" — set the Job field manually`, 'warn'); return; }
      const job = /mage|mago|wizard/i.test(m[0]) ? 'mage' : /archer|arquero/i.test(m[0]) ? 'archer' : /acolyte|acólito|priest|sacerdote/i.test(m[0]) ? 'acolyte' : 'swordsman';
      $('f-job').value = job;
      log(`${stamp()} character ${c.name} → job ${job}`, 'good');
    };
    el.appendChild(row);
  }
}

// ---- log rendering -----------------------------------------------------
function addLogLine(rec) {
  const msg = rec.msg || JSON.stringify(rec);
  const bad = /error|failed|cannot|refus|warn/i.test(msg);
  const good = /confirmed|joined|created|cleared|ready|started/i.test(msg);
  log(`${rec && rec.stamp ? `[${rec.stamp}]` : stamp()} ${msg}`, bad ? 'warn' : good ? 'good' : '');
}

window.app.onEvent(ev => {
  switch (ev.type) {
    case 'engine-spawned': status('engine starting', 'busy'); break;
    case 'ready':
      log(`${stamp()} brain: ${ev.bot || 'NOT FOUND — set botPath in config.json'}`, ev.bot ? 'good' : 'bad');
      log(`${stamp()} patched bundle ${ev.patched ? 'ok' : 'MISSING'}`, ev.patched ? 'dim' : 'bad');
      if (!running) status('ready', 'ok');
      break;
    case 'batch-start':
      log(`${stamp()} ${ev.cfg.mode === 'multi' ? `multi: ${(ev.cfg.instances || []).length} account(s) headless` : `${ev.cfg.job} · ${ev.cfg.stage} · ${ev.cfg.lobby}`}${ev.cfg.maxLoot ? ' · loot ×2' : ''} · ${ev.cfg.runs} run(s) · ${ev.cfg.maxSeconds}s${ev.cfg.objectives.length ? ' · objectives ' + ev.cfg.objectives.join('/') : ''}`, 'good');
      if (ev.cfg.mode === 'multi' && ev.cfg.instances) {
        framePort = ev.cfg.framePort || 0;
        window.__framePort = framePort;
        renderInstanceCells(ev.cfg.instances);
      }
      break;
    case 'instance': {
      const c = instanceCells.find(c => c.index === ev.index);
      if (c) {
        const tag = c.el.querySelector('.label span');
        if (tag) tag.textContent = `${c.job || ''} · ${c.stage || ''} · ${ev.state || ''}`;
      }
      log(`${stamp()} instance ${ev.index + 1} (${ev.account}): ${ev.state}${ev.error ? ' — ' + ev.error : ''}`, ev.state === 'error' ? 'bad' : 'dim');
      break;
    }
    case 'link': log(`${stamp()} ${ev.msg}`, 'dim'); break;
    case 'console': log(`${stamp()} ${ev.line}`, 'dim'); break;
    case 'stderr': log(`${stamp()} ${ev.line}`, 'bad'); break;
    case 'log': case 'log-run': addLogLine(ev.rec || {}); break;
    case 'detect-progress': log(`${stamp()} ${ev.msg}`, 'dim'); break;
    case 'detect': {
      renderChars(ev.chars, ev.note);
      if (!running) status('ready', 'ok');
      log(`${stamp()} ${ev.atCharSelect ? 'character select' : 'not at character select'} — ${ev.chars && ev.chars.length ? ev.chars.length + ' character(s)' : (ev.note || 'none')}`, 'dim');
      break;
    }
    case 'login':
      log(`${stamp()} ${ev.already ? 'already signed in' : 'signed in as ' + ev.user}`, 'good');
      if (!running) status('ready', 'ok');
      break;
    case 'objectives': {
      const names = (ev.status || []).map(s => `${s.objective}${s.found ? ' ✓' : ''}`).join(', ');
      log(`${stamp()} objectives ${ev.found}/${ev.total}${ev.complete ? ' — COMPLETE' : ''}: ${names || 'none'}`, ev.complete ? 'good' : '');
      break;
    }
    case 'run-result': {
      const r = ev.result || {};
      log(`${stamp()} ${ev.account ? ev.account + ' ' : ''}run ${r.run} ${r.job || ''}/${r.stage || ''}: ${r.survivedSeconds || 0}s · lv ${r.level ?? '-'} · ${r.kills || 0} kills${r.cleared ? ' · CLEARED' : ''} — ${r.cause || ''}${ev.live ? ' · live' : ''}`, r.cleared ? 'good' : '');
      break;
    }
    case 'batch-done':
      setRunning(false);
      status(ev.stopped ? 'stopped' : 'finished', 'ok');
      log(`${stamp()} batch finished${ev.error ? ' — ' + ev.error : ''}${ev.count != null ? ` — ${ev.count} run(s)` : ''}`, ev.error ? 'bad' : 'good');
      break;
    case 'error': log(`${stamp()} ${ev.msg}`, 'bad'); break;
    case 'fatal':
      log(`${stamp()} fatal: ${ev.msg}`, 'bad');
      status('engine error', 'err');
      setRunning(false);
      break;
    case 'engine-exit':
      log(`${stamp()} engine exited (code=${ev.code} signal=${ev.signal})`, ev.code ? 'bad' : 'dim');
      setRunning(false);
      if (!running) status('idle', 'idle');
      break;
    case 'game-loaded':
      log(`${stamp()} game window loaded (${ev.profile})`, 'dim');
      updateFoot();
      // Auto sign-in: with a saved account, the app logs in by itself the
      // first time the game finishes loading. Never for the guest profile.
      if (!autoLoginTried && sessionMode === 'account') {
        autoLoginTried = true;
        window.app.creds().then(c => {
          if (c.username && c.hasPassword && c.remember) {
            status('signing in', 'busy');
            window.app.loginNow();
          }
        });
      }
      break;
    case 'game-load-failed': log(`${stamp()} game load failed: ${ev.desc} (${ev.code})`, 'bad'); break;
    case 'game-gone': log(`${stamp()} game renderer gone: ${ev.reason} — press ↻ to reload`, 'bad'); break;
  }
});

// ---- actions -----------------------------------------------------------
$('btn-detect').onclick = async () => {
  status('detecting', 'busy');
  log(`${stamp()} reading characters from the game window…`);
  const res = await window.app.setProfile(sessionMode);
  if (res && res.ok === false) { status('idle', 'idle'); log(`${stamp()} ${res.reason || 'profile switch refused'}`, 'bad'); return; }
  const ok = await window.app.detect();
  if (ok && ok.ok === false) status('idle', 'idle');
  updateFoot();
};
$('btn-reload').onclick = async () => {
  const res = await window.app.reloadGame();
  if (res && res.ok === false) log(`${stamp()} ${res.reason}`, 'bad');
};
$('btn-focus').onclick = () => window.app.focusGame();

$('btn-start').onclick = async () => {
  const fresh = await window.app.ctx();
  if (!fresh.patched) {
    status('blocked', 'err');
    log(`${stamp()} start blocked: the patched game bundle is missing (run rea/patch.py) — the bot cannot read the game without it`, 'bad');
    return;
  }
  const cfg = cfgFromForm();
  const res = await window.app.start(cfg);
  if (res && res.ok === false) {
    status('blocked', 'err');
    log(`${stamp()} start blocked: ${res.reason}`, 'bad');
    return;
  }
  setRunning(true);
  updateFoot();
};
$('btn-stop').onclick = async () => {
  log(`${stamp()} stop requested`, 'warn');
  status('stopping', 'busy');
  await window.app.stop();
};
$('btn-kill').onclick = async () => {
  log(`${stamp()} force kill — stopping engine and bot now`, 'warn');
  await window.app.kill();
  setRunning(false);
  status('idle', 'idle');
};
$('btn-clear').onclick = () => { logEl.innerHTML = ''; };

// ---- server status banner (maintenance etc.) ------------------------------
window.app.onServerStatus(st => {
  const b = $('srv-banner');
  if (!st || !st.state || st.state === 'ok' || st.state === 'up') { b.classList.add('hidden'); return; }
  const when = st.at ? new Date(st.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  b.innerHTML = `<b>Game server: ${esc(st.state)}</b>${when ? ' · ' + esc(when) : ''} — ${esc(st.message || 'the server is not taking runs right now')}`;
  b.classList.remove('hidden');
});

// ---- accounts (headless farm) -------------------------------------------
let accounts = [];
function renderAccounts() {
  const el = $('accounts');
  el.innerHTML = '';
  if (!accounts.length) { el.innerHTML = '<span class="empty">none saved</span>'; updateMultiHint(); return; }
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    const row = document.createElement('div');
    row.className = 'row-a';
    row.innerHTML = `<b>${esc(a.username)}</b><span class="tag">${esc(a.job || 'panel job')}${a.character ? ' · ' + esc(a.character) : ''}${a.lobby ? ' · ' + esc(a.lobby) : ''}${a.stage ? ' · ' + esc(a.stage) : ''}</span>`;
    const del = document.createElement('button');
    del.textContent = '✕';
    del.onclick = () => { accounts.splice(i, 1); renderAccounts(); };
    row.appendChild(del);
    el.appendChild(row);
  }
  updateMultiHint();
}
function updateMultiHint() {
  const n = Math.min(10, Math.max(1, parseInt($('f-instances').value, 10) || 1));
  const names = accounts.slice(0, n).map(a => a.username);
  const same = $('f-same-area').checked;
  $('multi-hint').textContent = accounts.length
    ? `Will run: ${names.length ? names.join(', ') : 'none'}${accounts.length > n ? ` (of ${accounts.length} saved)` : ''}${same ? ' · all in the panel\'s stage and lobby' : ' · per-account areas'}`
    : 'No accounts saved yet — add them in Settings → Accounts.';
  // Per-account area pickers only matter when the tick is off.
  $('acc-area-fields').classList.toggle('hidden', same);
  $('acc-area-hint').textContent = same
    ? 'Per-account areas are hidden: every bot uses the panel\'s stage and lobby.'
    : 'Tick "All bots use the panel\'s stage and lobby" in Expedition to hide these.';
}
$('btn-acc-add').onclick = async () => {
  const username = $('acc-user').value.trim();
  const password = $('acc-pass').value;
  if (!username) { $('accounts-hint').textContent = 'Enter a username first.'; return; }
  if (accounts.some(a => a.username.toLowerCase() === username.toLowerCase())) { $('accounts-hint').textContent = 'That username is already in the list.'; return; }
  accounts.push({ username, password, job: $('acc-job').value || '', lobby: $('acc-lobby').value || '', stage: $('acc-stage').value || '', character: $('acc-char').value.trim() });
  $('acc-user').value = ''; $('acc-pass').value = '';
  await window.app.saveAccounts(accounts);
  renderAccounts();
  $('accounts-hint').textContent = 'Saved. The sign-in is encrypted when this PC has a system keystore.';
};
$('btn-acc-save').onclick = async () => {
  await window.app.saveAccounts(accounts);
  $('accounts-hint').textContent = 'Saved.';
};

// ---- mode: game window vs headless accounts -----------------------------
let runMode = 'window';
function setRunMode(mode) {
  const changed = runMode !== mode;
  runMode = mode;
  for (const b of $('seg-mode').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === mode);
  $('multi-fields').classList.toggle('hidden', mode !== 'multi');
  $('mode-hint').textContent = mode === 'multi'
    ? 'Each account runs its own headless browser. The app shows a live preview of every instance.'
    : 'One bot drives the game window docked in this app (left side).';
  $('previews').classList.toggle('hidden', mode !== 'multi');
  $('previews').innerHTML = '';
  $('inventory').classList.toggle('hidden', mode !== 'multi');
  $('inventory').innerHTML = '';
  document.querySelector('.stage-note').style.display = mode === 'multi' ? 'none' : '';
  window.app.setGameViewVisible(mode !== 'multi');
  // Switching mode while a batch is running would leave a headless farm
  // running behind the panel (it looks like "the bot ran somewhere else").
  if (changed && running) {
    log(`${stamp()} mode changed — stopping the running batch`, 'warn');
    window.app.stop();
    setRunning(false);
    status('stopped', 'idle');
  }
  updateMultiHint();
}
$('seg-mode').onclick = e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  setRunMode(b.dataset.mode);
};
$('f-instances').oninput = updateMultiHint;
$('f-same-area').onchange = updateMultiHint;

// ---- live inventory of the headless instances ----------------------------
function prettyName(id) {
  return String(id || '')
    .replace(/[_.]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .slice(0, 34);
}
const ICON_BASE = 'https://ro-survivors.com/';
function iconUrl(icon) {
  if (!icon) return '';
  return /^https?:/.test(icon) ? icon : ICON_BASE + String(icon).replace(/^\//, '');
}
function itemChip(entry) {
  // Loot and cards carry a numeric item id (the game's own icon path) plus a
  // quality; skills and passives are plain ids.
  const id = entry && typeof entry === 'object' ? entry.id : entry;
  const q = entry && typeof entry === 'object' ? entry.quality : null;
  const name = prettyName(typeof entry === 'object' && entry.name ? entry.name : id);
  const icon = /^\d+$/.test(String(id)) ? `${ICON_BASE}assets/items/${id}.png` : '';
  const tip = typeof entry === 'object'
    ? `${name}${entry.ilvl ? ' · ilvl ' + entry.ilvl : ''}${entry.tier ? ' · tier ' + entry.tier : ''}`
    : name;
  return `<span class="chip${q ? ' q' + q : ''}" title="${esc(tip)}">${icon ? `<img src="${icon}" alt="">` : ''}${esc(name)}</span>`;
}
function chipsOf(list) {
  if (!list || !list.length) return '<span class="chip none">none</span>';
  return list.map(itemChip).join('');
}
// Equipment slots with the item's real name and icon.
function equipChips(equip) {
  if (!equip) return '<span class="chip none">none</span>';
  const out = [];
  for (const [slot, value] of Object.entries(equip)) {
    if (value == null) continue;
    const id = typeof value === 'object' ? value.id : value;
    const info = typeof value === 'object' ? value : null;
    if (id == null) continue;
    const icon = info && info.icon ? iconUrl(info.icon) : `${ICON_BASE}assets/items/${id}.png`;
    const label = (info && info.name) || prettyName(slot);
    out.push(`<span class="chip" title="${esc(prettyName(slot))}"><img src="${icon}" alt="">${esc(label)}</span>`);
  }
  return out.length ? out.join('') : '<span class="chip none">none</span>';
}
// Backpack items as the game stores them (uid, item id, count, ilvl).
function bagChips(items) {
  if (!items || !items.length) return '<span class="chip none">empty</span>';
  return items.map(it => {
    const icon = it.icon ? iconUrl(it.icon) : `${ICON_BASE}assets/items/${it.itemId}.png`;
    const label = it.name || prettyName(it.slot || it.itemId);
    const tip = `${label}${it.slot ? ' · ' + prettyName(it.slot) : ''}${it.ilvl ? ' · ilvl ' + it.ilvl : ''}${it.count > 1 ? ' · x' + it.count : ''}`;
    return `<span class="chip${it.quality ? ' q' + it.quality : ''}" title="${esc(tip)}"><img src="${icon}" alt="">${esc(label)}${it.count > 1 ? ' ×' + it.count : ''}</span>`;
  }).join('');
}
function renderInventory(instances) {
  const grid = $('inventory');
  grid.innerHTML = '';
  for (const inst of instances) {
    const card = document.createElement('div');
    card.className = 'inv-card';
    card.dataset.index = inst.index;
    grid.appendChild(card);
    updateInventoryCard(card, inst);
  }
}
function updateInventoryCard(card, inst) {
  const s = inst.snap;
  const inv = inst.inv;
  // Equipment: the run feed carries the worn gear (with names), the plaza
  // feed the same; the backpack only exists while the bot is in town.
  const equip = (s && s.equip) || (inv && inv.equipInfo) || null;
  // The backpack only exists while the bot is in town; an old town file is
  // worse than no backpack at all.
  const invAge = inv && inv.at ? Date.now() - inv.at : Infinity;
  const invFresh = invAge < 10 * 60 * 1000;
  const backpack = (s && s.backpack && s.backpack.length) ? s.backpack : (invFresh ? (inv && inv.inventory) || [] : []);
  const lvl = s && s.level != null ? `Lv ${s.level}` : 'Lv -';
  const hpPct = s && s.maxHp ? Math.max(0, Math.min(100, Math.round((s.hp / s.maxHp) * 100))) : 0;
  const vitals = s
    ? `<span>${lvl}</span><span class="hp" title="${s.hp}/${s.maxHp} hp"><i style="width:${hpPct}%"></i></span>` +
      `<span>${s.kills || 0} kills</span><span>${s.zeny || 0} zeny</span><span>${s.chestsOpened || 0} chests</span>` +
      (s.mvpsKilled ? `<span>${s.mvpsKilled} MVP</span>` : '')
    : '<span>waiting for the first frame…</span>';
  card.innerHTML = `
    <div class="inv-head">
      <b>${esc(inst.username)}</b>
      <span class="tag">${esc(inst.job || '')} · ${esc(inst.stage || '')}${s && s.t ? ` · ${Math.floor(s.t / 60)}m${String(Math.floor(s.t % 60)).padStart(2, '0')}s` : ''}</span>
      <div class="inv-vitals">${vitals}</div>
    </div>
    <div class="inv-rows">
      <div class="inv-row"><span class="lbl">Equipment</span><span class="inv-chips">${equipChips(equip)}</span></div>
      <div class="inv-row"><span class="lbl">Backpack</span><span class="inv-chips">${backpack.length ? bagChips(backpack) : '<span class="chip none">in town only</span>'}</span></div>
      <div class="inv-row"><span class="lbl">Weapon</span><span class="inv-chips">${chipsOf(s && s.weapons)}</span></div>
      <div class="inv-row"><span class="lbl">Skills</span><span class="inv-chips">${chipsOf(s && s.slots)}</span></div>
      <div class="inv-row"><span class="lbl">Passives</span><span class="inv-chips">${chipsOf(s && s.passives)}</span></div>
      <div class="inv-row"><span class="lbl">Cards</span><span class="inv-chips">${chipsOf(s && s.runCards)}</span></div>
      <div class="inv-row"><span class="lbl">Run loot</span><span class="inv-chips">${chipsOf(s && s.runLoot)}</span></div>
    </div>`;
}
async function refreshInventories() {
  for (const c of instanceCells) {
    if (!c.out) continue;
    const res = await window.app.snapshot(`${c.out}/snapshot.json`);
    if (res && res.ok) c.snap = res.data;
    const invRes = await window.app.snapshot(`${c.out}/inventory.json`);
    if (invRes && invRes.ok) c.inv = invRes.data;
    const card = document.querySelector(`.inv-card[data-index="${c.index}"]`);
    if (card) updateInventoryCard(card, c);
  }
}

// ---- preview grid (headless instances) -----------------------------------
let instanceCells = [];   // [{ index, account, shot, el, img }]
let shotTimer = null;
function renderInstanceCells(instances) {
  const grid = $('previews');
  grid.innerHTML = '';
  instanceCells = [];
  for (const inst of instances) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.innerHTML = `<div class="empty">starting…</div><div class="label"><b>${esc(inst.username)}</b><span>${esc(inst.job || '')} · ${esc(inst.stage || '')}</span>` +
      `<button class="mini" title="Reset this bot only" data-act="restart">↻</button>` +
      `<button class="mini" title="Stop this bot only" data-act="stop">■</button></div>`;
    grid.appendChild(cell);
    // The live frame stream fills this image; it exists from the start so the
    // first frame can land in it.
    const img = document.createElement('img');
    img.style.opacity = '0';
    cell.insertBefore(img, cell.firstChild);
    const buttons = cell.querySelectorAll('.mini');
    buttons.forEach(b => b.onclick = async (ev) => {
      ev.stopPropagation();
      const act = b.dataset.act;
      log(`${stamp()} ${inst.username}: ${act === 'restart' ? 'resetting' : 'stopping'} (that bot only)`);
      await window.app.instanceAction(inst.index, act);
    });
    instanceCells.push({ ...inst, el: cell, img, snap: null });
  }
  renderInventory(instances);
  // Smooth video preview: the engine keeps the newest frame of every instance
  // in memory and the panel pulls it directly (no disk, no base64 over IPC).
  framePort = (window.__framePort || 0);
  if (shotTimer) clearInterval(shotTimer);
  shotTimer = setInterval(refreshShots, 5000);
  refreshShots();
}

// The engine's frame server: newest frame per instance, straight from memory.
let framePort = 0;
function startFrameStream() {
  setInterval(() => {
    if (!framePort) return;
    for (const c of instanceCells) {
      if (!c.img || c.loadingFrame) continue;
      c.loadingFrame = true;
      const url = `http://127.0.0.1:${framePort}/frame/${c.index}?t=${Date.now()}`;
      c.img.onload = () => {
        c.loadingFrame = false;
        c.img.style.opacity = '1';
        const e = c.el.querySelector('.empty');
        if (e) e.remove();
      };
      c.img.onerror = () => { c.loadingFrame = false; };
      c.img.src = url;
    }
  }, 180);
}
startFrameStream();
async function refreshShots() {
  // With the live frame stream the cell image is always current, so the
  // file-based staleness check only applies to the fallback path.
  if (framePort) { await refreshInventories(); return; }
  for (const c of instanceCells) {
    if (!c.shot) continue;
    const res = await window.app.shot(c.shot);
    if (!res || !res.ok) { c.el.classList.add('stale'); continue; }
    if (!c.img) {
      const img = document.createElement('img');
      const empty = c.el.querySelector('.empty');
      if (empty) empty.remove();
      c.el.insertBefore(img, c.el.firstChild);
      c.img = img;
    }
    c.img.src = res.data;
    // No new frame for a while: the instance's bot is gone or stuck. Only
    // judged once at least one frame has been seen (the first capture can
    // take a while while the game loads).
    const age = Date.now() - (res.mtime || 0);
    if (!c.seenFrame) c.seenFrame = age < 60000;
    const stale = c.seenFrame && age > 40000;
    c.el.classList.toggle('stale', stale);
    const tag = c.el.querySelector('.label span');
    if (tag && stale && !/no signal/i.test(tag.textContent)) tag.textContent = `${c.job || ''} · ${c.stage || ''} · no signal`;
    else if (tag && !stale) tag.textContent = `${c.job || ''} · ${c.stage || ''}`;
  }
  await refreshInventories();
}
function clearInstanceCells() {
  instanceCells = [];
  if (shotTimer) { clearInterval(shotTimer); shotTimer = null; }
  $('previews').innerHTML = '';
}

// ---- build editor ------------------------------------------------------
// Per-job card/item priority lists. Saved into config.json as cfg.builds and
// handed to bot6.2.js as --builds: a listed pick is taken in the user's order;
// unlisted picks follow the bot's own planner. Lists boost, they never ban.
let buildJob = 'mage';
let buildCfg = {}; // { mage: { cards: [...], items: [...] }, ... }

function readBuildLists() {
  const split = v => v.split(/\n/).map(s => s.trim()).filter(Boolean);
  const cards = split($('f-build-cards').value);
  const items = split($('f-build-items').value);
  if (!cards.length && !items.length) delete buildCfg[buildJob];
  else buildCfg[buildJob] = { cards, items };
}
function buildUiSync() {
  const b = buildCfg[buildJob] || {};
  $('f-build-cards').value = (b.cards || []).join('\n');
  $('f-build-items').value = (b.items || []).join('\n');
  $('build-job-label').textContent = buildJob;
  for (const btn of $('seg-job').querySelectorAll('button')) btn.classList.toggle('on', btn.dataset.job === buildJob);
  const jobs = Object.keys(buildCfg).filter(j => (buildCfg[j].cards || []).length || (buildCfg[j].items || []).length);
  $('build-hint').textContent = jobs.length
    ? `Saved for: ${jobs.join(', ')}. Starts with the next run.`
    : 'No build saved — the bot uses its own planner for every pick.';
}
$('seg-job').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  readBuildLists(); // keep in-session edits when switching jobs (not saved yet)
  buildJob = b.dataset.job;
  buildUiSync();
};
$('btn-save-build').onclick = async () => {
  readBuildLists();
  const jobs = Object.keys(buildCfg).filter(j => (buildCfg[j].cards || []).length || (buildCfg[j].items || []).length);
  if (!jobs.length) { $('build-hint').textContent = 'Nothing to save — both lists are empty.'; return; }
  await window.app.savePrefs({ builds: buildCfg });
  buildUiSync();
  log(`${stamp()} build saved for ${jobs.join(', ')} — the bot gets it on the next start`, 'good');
};
$('btn-clear-build').onclick = async () => {
  delete buildCfg[buildJob];
  await window.app.savePrefs({ builds: buildCfg });
  buildUiSync();
  log(`${stamp()} build cleared for ${buildJob}`, 'warn');
};

// ---- presets -----------------------------------------------------------
async function refreshPresets() {
  const list = await window.app.presets();
  const el = $('presets');
  el.innerHTML = '';
  if (!list.length) { el.innerHTML = '<span class="empty">none saved</span>'; return; }
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'p';
    row.innerHTML = `<span>${esc(p.name)} — ${esc(p.job)}/${esc(p.stage)}</span>`;
    const load = document.createElement('button');
    load.textContent = 'load';
    load.onclick = () => { cfgToForm(p); log(`${stamp()} preset loaded: ${p.name}`, 'good'); };
    const del = document.createElement('button');
    del.textContent = '✕';
    del.onclick = async () => { await window.app.deletePreset(p.name); refreshPresets(); };
    row.appendChild(load); row.appendChild(del);
    el.appendChild(row);
  }
}
// ---- saved account -----------------------------------------------------
async function loadAccount() {
  const c = await window.app.creds();
  $('f-user').value = c.username || '';
  $('f-pass').value = '';
  $('f-remember').checked = c.remember !== false;
  const how = c.plain
    ? 'saved unencrypted in this app\'s config (file mode 600) — this PC has no system keyring'
    : c.encrypted ? 'saved via the OS keystore' : 'no password saved';
  $('acct-hint').textContent = c.username
    ? `Saved: ${c.username} — ${how}`
    : 'Nothing saved yet.';
  return c;
}

const openSettings = () => { $('settings').classList.remove('hidden'); loadAccount(); };
const closeSettings = () => $('settings').classList.add('hidden');
$('btn-settings').onclick = openSettings;
$('btn-settings-close').onclick = closeSettings;
$('settings').onclick = e => { if (e.target === $('settings')) closeSettings(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

$('btn-save-acct').onclick = async () => {
  const username = $('f-user').value.trim();
  const password = $('f-pass').value;
  if (!username) { $('acct-hint').textContent = 'Enter your username first.'; return; }
  const res = await window.app.saveCreds({ username, password, remember: $('f-remember').checked });
  if (!res.ok) { $('acct-hint').textContent = 'Could not save: ' + (res.reason || 'unknown error'); return; }
  $('f-pass').value = '';
  await loadAccount();
  if (password) {
    status('signing in', 'busy');
    $('acct-hint').textContent = 'Saved — signing in…';
    await window.app.loginNow();
  }
};

$('btn-forget').onclick = async () => {
  await window.app.clearCreds();
  $('f-user').value = ''; $('f-pass').value = '';
  await loadAccount();
  log(`${stamp()} saved account removed`, 'warn');
};

$('btn-save').onclick = async () => {
  const name = $('f-preset').value.trim();
  if (!name) { log(`${stamp()} give the preset a name first`, 'bad'); return; }
  await window.app.savePreset({ name, ...cfgFromForm() });
  $('f-preset').value = '';
  log(`${stamp()} preset saved: ${name}`, 'good');
  refreshPresets();
};

// ---- boot --------------------------------------------------------------
function updateFoot() {
  if (!ctx) return;
  $('foot').textContent = `game: ${ctx.profile || sessionMode} profile · cdp 127.0.0.1:${ctx.cdpPort} · patched bundle ${ctx.patched ? 'ok' : 'missing'}`;
}

(async () => {
  ctx = await window.app.ctx();
  cfgToForm(ctx.cfg);
  buildCfg = (ctx.cfg && ctx.cfg.builds && typeof ctx.cfg.builds === 'object') ? ctx.cfg.builds : {};
  buildUiSync();
  accounts = await window.app.accounts();
  renderAccounts();
  setRunMode('window');
  updateFoot();
  $('about').textContent = `electron ${ctx.versions.electron} · chromium ${ctx.versions.chrome} · engine port ${ctx.cdpPort} · bundle ${ctx.patched ? 'patched' : 'missing'}`;
  log(`${stamp()} app ready — patched bundle ${ctx.patched ? 'ok' : 'MISSING (run rea/patch.py)'}`, ctx.patched ? 'good' : 'bad');
  log(`${stamp()} game pane: loopback CDP ${ctx.cdpPort}`, 'dim');
  await loadAccount();
  refreshPresets();
  // A reloaded panel must not resurrect dead buttons: adopt the true state.
  if (ctx.running) setRunning(true);
})();
