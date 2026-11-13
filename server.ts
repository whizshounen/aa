import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as createViteServer } from 'vite';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = __dirname;

const buildPlanner = require('./bot/build-planner.js');
const steerPolicy = require('./bot/steer-policy.js');

const PATHS = {
  config: path.join(ROOT, 'gui', 'config.json'),
  configExample: path.join(ROOT, 'gui', 'config.example.json'),
  presets: path.join(ROOT, 'gui', 'presets.json'),
  accounts: path.join(ROOT, 'gui', 'accounts.json'),
  builds: path.join(ROOT, 'builds.json'),
  bundleManifest: path.join(ROOT, 'rea', 'patched', 'bundle.json'),
  reportV5: path.join(ROOT, 'docs', 'beast-v5-report.md'),
  reportV6: path.join(ROOT, 'docs', 'beast-v6-report.md'),
};

const KNOWN_STAGES = [
  { id: 'prontera', label: 'Prontera Fields', durationS: 900, finalBoss: 'Mastering' },
  { id: 'sewer', label: 'Prontera Culvert', durationS: 900, finalBoss: 'Golden Thief Bug' },
  { id: 'culvert', label: 'Culvert Depths', durationS: 900, finalBoss: 'Golden Thief Bug' },
  { id: 'sunken', label: 'Sunken Ship', durationS: 900, finalBoss: 'Drake' },
  { id: 'byalan', label: 'Byalan Island', durationS: 900, finalBoss: 'Strouf' },
  { id: 'payon_forest', label: 'Payon Forest', durationS: 900, finalBoss: 'Eddga' },
  { id: 'payon_cave', label: 'Payon Cave', durationS: 900, finalBoss: 'Moonlight Flower' },
];

const KNOWN_LOBBIES = ['Nidavellir', 'Valhalla', 'Midgard', 'Asgard'];

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function sha256File(filePath: string): { exists: boolean; sizeBytes: number; sha256: string | null } {
  try {
    if (!fs.existsSync(filePath)) return { exists: false, sizeBytes: 0, sha256: null };
    const buf = fs.readFileSync(filePath);
    return {
      exists: true,
      sizeBytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    };
  } catch {
    return { exists: false, sizeBytes: 0, sha256: null };
  }
}

function sanitizeConfig(raw: Record<string, unknown>) {
  const validJobs = Object.keys(buildPlanner.JOB_DEFS);
  const validStageIds = KNOWN_STAGES.map(s => s.id);
  const job = typeof raw.job === 'string' && validJobs.includes(raw.job) ? raw.job : 'mage';
  const stage = typeof raw.stage === 'string' && validStageIds.includes(raw.stage) ? raw.stage : 'prontera';
  const mode = raw.mode === 'account' ? 'account' : 'guest';
  const lobby = typeof raw.lobby === 'string' && raw.lobby.trim() ? raw.lobby.trim() : 'Nidavellir';
  const objectives = Array.isArray(raw.objectives)
    ? raw.objectives.map(v => String(v).trim()).filter(Boolean)
    : [];
  const runs = Math.min(999, Math.max(1, Number(raw.runs) || 1));
  const maxSeconds = Math.min(14400, Math.max(60, Number(raw.maxSeconds) || 3600));
  return {
    mode,
    username: typeof raw.username === 'string' ? raw.username.trim() : '',
    job,
    stage,
    lobby,
    objectives,
    runs,
    maxSeconds,
    maxLoot: raw.maxLoot !== false,
    ladder: Boolean(raw.ladder),
    out: typeof raw.out === 'string' && raw.out.trim() ? raw.out.trim() : 'logs',
    charName: typeof raw.charName === 'string' ? raw.charName.trim() : '',
  };
}

function readConfig() {
  const fallback = readJsonSafe(PATHS.configExample, {
    mode: 'guest',
    job: 'mage',
    stage: 'prontera',
    lobby: 'Nidavellir',
    objectives: [],
    runs: 1,
    maxSeconds: 3600,
    maxLoot: true,
    ladder: false,
    out: 'logs',
  });
  const current = readJsonSafe(PATHS.config, fallback);
  return sanitizeConfig({ ...fallback, ...current });
}

function readAccountsPublic() {
  const raw = readJsonSafe<Array<Record<string, unknown>>>(PATHS.accounts, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(a => a && typeof a.username === 'string' && a.username.trim())
    .map(a => ({
      username: String(a.username).trim(),
      hasPassword: Boolean(a.password),
      job: typeof a.job === 'string' ? a.job : 'mage',
      charName: typeof a.charName === 'string' ? a.charName : '',
      stage: typeof a.stage === 'string' ? a.stage : 'prontera',
      lobby: typeof a.lobby === 'string' ? a.lobby : 'Nidavellir',
      runs: Number(a.runs) || 1,
      maxSeconds: Number(a.maxSeconds) || 3600,
      maxLoot: a.maxLoot !== false,
      ladder: Boolean(a.ladder),
      addedAt: Number(a.addedAt) || Date.now(),
    }));
}

function readBuildsClean(): Record<string, { cards: string[]; items: string[] }> {
  const raw = readJsonSafe<Record<string, { cards?: string[]; items?: string[] }>>(PATHS.builds, {});
  const out: Record<string, { cards: string[]; items: string[] }> = {
    mage: { cards: [], items: [] },
    swordsman: { cards: [], items: [] },
    archer: { cards: [], items: [] },
    acolyte: { cards: [], items: [] },
  };
  for (const job of Object.keys(out)) {
    const entry = raw?.[job];
    if (entry && typeof entry === 'object') {
      out[job] = {
        cards: Array.isArray(entry.cards) ? entry.cards.map(s => String(s).trim()).filter(Boolean) : [],
        items: Array.isArray(entry.items) ? entry.items.map(s => String(s).trim()).filter(Boolean) : [],
      };
    }
  }
  return out;
}

function stripMd(text: string) {
  return text.replace(/\*\*/g, '').replace(/`/g, '').trim();
}

function parseReportBenchmarks() {
  const rows: Array<{
    botVersion: string;
    runLabel: string;
    job: string;
    gameTimeS: number;
    level: number;
    kills: number;
    killsPerMin: number;
    lootPerMin: number;
    bossDamage: string;
    diagnosis: 'PACK-CONTACT' | 'ECLIPSE-KILL' | 'SPAWN-BURST' | 'HORDE-CAP';
    summary: string;
  }> = [];

  if (fs.existsSync(PATHS.reportV5)) {
    const v5 = fs.readFileSync(PATHS.reportV5, 'utf8');
    const lines = v5.split('\n');
    for (const line of lines) {
      if (!line.startsWith('| ') || line.startsWith('| Run ') || line.startsWith('|---')) continue;
      const cells = line.split('|').slice(1, -1).map(c => stripMd(c));
      if (cells.length === 14 && /^\d+$/.test(cells[0])) {
        const gameTimeS = parseFloat(cells[2]) || 0;
        const level = parseInt(cells[4], 10) || 0;
        const killsMatch = cells[5].match(/^(\d+)\s*\(([\d.]+)\)/);
        const kills = killsMatch ? parseInt(killsMatch[1], 10) : 0;
        const killsPerMin = killsMatch ? parseFloat(killsMatch[2]) : 0;
        const lootPerMin = parseFloat(cells[7]) || 0;
        const runNum = parseInt(cells[0], 10);
        rows.push({
          botVersion: 'v5.1',
          runLabel: `Headed #${runNum}`,
          job: 'swordsman',
          gameTimeS,
          level,
          kills,
          killsPerMin,
          lootPerMin,
          bossDamage: cells[12],
          diagnosis: runNum === 1 ? 'SPAWN-BURST' : runNum === 2 ? 'PACK-CONTACT' : 'HORDE-CAP',
          summary: cells[13],
        });
      }
    }
  }

  if (fs.existsSync(PATHS.reportV6)) {
    const v6 = fs.readFileSync(PATHS.reportV6, 'utf8');
    const lines = v6.split('\n');
    for (const line of lines) {
      if (!line.startsWith('| ') || line.startsWith('| Slot ') || line.startsWith('|---')) continue;
      const cells = line.split('|').slice(1, -1).map(c => stripMd(c));
      if (cells.length === 9 && /^\d+$/.test(cells[0])) {
        const slot = cells[0];
        const run = cells[1];
        const gameTimeS = parseFloat(cells[2]) || 0;
        const level = parseInt(cells[3], 10) || 0;
        const kills = parseInt(cells[4], 10) || 0;
        const killsPerMin = parseFloat(cells[5]) || 0;
        const lootPerMin = parseFloat(cells[6]) || 0;
        const cause = cells[8];
        rows.push({
          botVersion: 'v6.1',
          runLabel: `Slot ${slot} (Run ${run})`,
          job: 'swordsman',
          gameTimeS,
          level,
          kills,
          killsPerMin,
          lootPerMin,
          bossDamage: slot === '1' ? '3,350 Eclipse (KILLED) + 331 Toad' : slot === '2' ? '1,815 Eclipse' : '580 Eclipse',
          diagnosis: 'PACK-CONTACT',
          summary: slot === '1'
            ? `${cause} · Eclipse killed at 211.9s; died at nearest 12px in Toad pack`
            : `${cause} · buried in pack (<25px contact)`,
        });
      }
    }
  }

  return rows;
}

function getBundleStatus() {
  const manifest = readJsonSafe<Record<string, unknown>>(PATHS.bundleManifest, { ok: false });
  const name = typeof manifest.name === 'string' ? manifest.name : '';
  const srcFile = name ? path.join(ROOT, 'build', name) : '';
  const patchedFile = name ? path.join(ROOT, 'rea', 'patched', name) : '';
  const srcCheck = srcFile ? sha256File(srcFile) : { exists: false, sizeBytes: 0, sha256: null };
  const patchedCheck = patchedFile ? sha256File(patchedFile) : { exists: false, sizeBytes: 0, sha256: null };

  return {
    manifest,
    files: {
      source: {
        relativePath: name ? `build/${name}` : null,
        ...srcCheck,
        matchesManifest: Boolean(srcCheck.sha256 && srcCheck.sha256 === manifest.srcSha),
      },
      patched: {
        relativePath: name ? `rea/patched/${name}` : null,
        ...patchedCheck,
        matchesManifest: Boolean(patchedCheck.sha256 && patchedCheck.sha256 === manifest.patchedSha),
      },
    },
    botEntryExists: fs.existsSync(path.join(ROOT, 'bot', 'bot6.2.js')),
  };
}

async function runSuiteCommand(label: string, cmd: string, args: string[]) {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: ROOT,
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return {
      label,
      command: `${cmd} ${args.join(' ')}`,
      ok: true,
      durationMs: Date.now() - started,
      output: (stdout + (stderr ? '\n' + stderr : '')).trim(),
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      label,
      command: `${cmd} ${args.join(' ')}`,
      ok: false,
      durationMs: Date.now() - started,
      output: ((e.stdout || '') + '\n' + (e.stderr || e.message || '')).trim(),
    };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/workspace', (_req, res) => {
    const skillPlan = buildPlanner.SKILL_PLAN.map((s: Record<string, unknown>) => ({
      id: s.id,
      job: s.job,
      dps: s.dps,
      aoe: s.aoe,
      role: s.role,
      phase: s.phase,
      prio: s.prio,
      note: s.note,
    }));
    res.json({
      config: readConfig(),
      presets: readJsonSafe<Array<Record<string, unknown>>>(PATHS.presets, []),
      accounts: readAccountsPublic(),
      builds: readBuildsClean(),
      bundle: getBundleStatus(),
      benchmarks: parseReportBenchmarks(),
      jobDefs: buildPlanner.JOB_DEFS,
      skillPlan,
      stages: KNOWN_STAGES,
      lobbies: KNOWN_LOBBIES,
    });
  });

  app.put('/api/config', (req, res) => {
    const next = sanitizeConfig(req.body || {});
    writeJsonSafe(PATHS.config, next);
    res.json({ ok: true, config: next });
  });

  app.get('/api/presets', (_req, res) => {
    res.json(readJsonSafe<Array<Record<string, unknown>>>(PATHS.presets, []));
  });

  app.post('/api/presets', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'Preset name is required' });
    const config = sanitizeConfig(req.body?.config || {});
    const presets = readJsonSafe<Array<{ name: string; config: ReturnType<typeof sanitizeConfig>; updatedAt: number }>>(PATHS.presets, []);
    const idx = presets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
    const entry = { name, config, updatedAt: Date.now() };
    if (idx >= 0) presets[idx] = entry;
    else presets.push(entry);
    writeJsonSafe(PATHS.presets, presets);
    res.json({ ok: true, presets });
  });

  app.delete('/api/presets/:name', (req, res) => {
    const target = decodeURIComponent(req.params.name).trim().toLowerCase();
    const presets = readJsonSafe<Array<{ name: string }>>(PATHS.presets, []);
    const next = presets.filter(p => p.name.toLowerCase() !== target);
    writeJsonSafe(PATHS.presets, next);
    res.json({ ok: true, presets: next });
  });

  app.get('/api/accounts', (_req, res) => {
    res.json(readAccountsPublic());
  });

  app.post('/api/accounts', (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (!username) return res.status(400).json({ error: 'Username is required' });
    const raw = readJsonSafe<Array<Record<string, unknown>>>(PATHS.accounts, []);
    const idx = raw.findIndex(a => String(a.username || '').toLowerCase() === username.toLowerCase());
    const existing = idx >= 0 ? raw[idx] : {};
    const password = typeof req.body?.password === 'string' && req.body.password.length > 0
      ? req.body.password
      : existing.password || '';
    const record = {
      username,
      password,
      job: typeof req.body?.job === 'string' && req.body.job in buildPlanner.JOB_DEFS ? req.body.job : 'mage',
      charName: typeof req.body?.charName === 'string' ? req.body.charName.trim() : '',
      stage: typeof req.body?.stage === 'string' ? req.body.stage : 'prontera',
      lobby: typeof req.body?.lobby === 'string' && req.body.lobby.trim() ? req.body.lobby.trim() : 'Nidavellir',
      runs: Math.min(999, Math.max(1, Number(req.body?.runs) || 1)),
      maxSeconds: Math.min(14400, Math.max(60, Number(req.body?.maxSeconds) || 3600)),
      maxLoot: req.body?.maxLoot !== false,
      ladder: Boolean(req.body?.ladder),
      addedAt: Number(existing.addedAt) || Date.now(),
    };
    if (idx >= 0) raw[idx] = record;
    else raw.push(record);
    writeJsonSafe(PATHS.accounts, raw);
    res.json({ ok: true, accounts: readAccountsPublic() });
  });

  app.delete('/api/accounts/:username', (req, res) => {
    const target = decodeURIComponent(req.params.username).trim().toLowerCase();
    const raw = readJsonSafe<Array<Record<string, unknown>>>(PATHS.accounts, []);
    const next = raw.filter(a => String(a.username || '').trim().toLowerCase() !== target);
    writeJsonSafe(PATHS.accounts, next);
    res.json({ ok: true, accounts: readAccountsPublic() });
  });

  app.get('/api/builds', (_req, res) => {
    res.json(readBuildsClean());
  });

  app.put('/api/builds', (req, res) => {
    const incoming = req.body && typeof req.body === 'object' ? req.body : {};
    const sanitized: Record<string, { cards: string[]; items: string[] }> = {
      mage: { cards: [], items: [] },
      swordsman: { cards: [], items: [] },
      archer: { cards: [], items: [] },
      acolyte: { cards: [], items: [] },
    };
    for (const job of Object.keys(sanitized)) {
      const entry = incoming[job];
      if (entry && typeof entry === 'object') {
        sanitized[job] = {
          cards: Array.isArray(entry.cards) ? entry.cards.map((s: unknown) => String(s).trim()).filter(Boolean) : [],
          items: Array.isArray(entry.items) ? entry.items.map((s: unknown) => String(s).trim()).filter(Boolean) : [],
        };
      }
    }
    writeJsonSafe(PATHS.builds, sanitized);
    res.json({ ok: true, builds: sanitized });
  });

  app.post('/api/planner/score', (req, res) => {
    const ctx = {
      job: typeof req.body?.job === 'string' ? req.body.job : 'mage',
      elapsedS: Number(req.body?.elapsedS) || 0,
      liveEnemies: Number(req.body?.liveEnemies) || 0,
      hpFrac: req.body?.hpFrac != null ? Number(req.body.hpFrac) : 1,
      level: Number(req.body?.level) || 1,
      bossDueIn: req.body?.bossDueIn != null ? Number(req.body.bossDueIn) : null,
      bossActive: Boolean(req.body?.bossActive),
      timeToMastering: req.body?.timeToMastering != null ? Number(req.body.timeToMastering) : null,
      masteringActive: Boolean(req.body?.masteringActive),
      slotsFree: req.body?.slotsFree != null ? Number(req.body.slotsFree) : 4,
      ownedSkills: Array.isArray(req.body?.ownedSkills) ? req.body.ownedSkills : [],
      deterministic: true,
    };
    const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
    const userBuilds = buildPlanner.normalizeBuilds(req.body?.builds || readBuildsClean());

    const scored = candidates.map((cand: { title?: string; pickType?: string }, index: number) => {
      const title = String(cand?.title || '');
      const pickType = cand?.pickType === 'item' ? 'item' : 'skill';
      const result = buildPlanner.scoreCard(title, { ...ctx, pickType }, userBuilds);
      return {
        index,
        title,
        pickType,
        ...result,
      };
    });

    scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);
    res.json({ ok: true, ctx, ranked: scored });
  });

  app.post('/api/tactical/diagnose', (req, res) => {
    const state = req.body?.state;
    const st = req.body?.st || {};
    if (!state) return res.status(400).json({ error: 'State snapshot required' });
    const decision = steerPolicy.steer(state, st);
    const diag = Array.isArray(req.body?.deathBuf)
      ? steerPolicy.diagnoseDeath({ death: { buf: req.body.deathBuf } })
      : null;
    res.json({ ok: true, decision, diag });
  });

  app.get('/api/bundle/verify', (_req, res) => {
    res.json(getBundleStatus());
  });

  app.post('/api/tests/run', async (_req, res) => {
    const checks = await Promise.all([
      runSuiteCommand('Syntax Check (bot6.2 & gui)', 'node', [
        '--check',
        'bot/bot6.2.js',
      ]),
      runSuiteCommand('Syntax Check (GUI stack)', 'node', [
        '--check',
        'gui/engine.js',
      ]),
      runSuiteCommand('Bot & GUI Unit Suite (20 tests)', 'node', [
        '--test',
        'bot/movement-policy.test.js',
        'bot/persistent-runner.test.js',
        'bot/account-login-contract.test.js',
        'bot/build-planner.test.js',
        'bot/steer-policy.test.js',
        'gui/instance-restart-policy.test.js',
      ]),
      runSuiteCommand('REA Bundle Anchor Verification', 'python3', ['rea/patch_test.py']),
      runSuiteCommand('Tactical Parity Tests', 'npx', ['tsx', '--test', 'src/utils/tacticalEngine.test.ts']),
    ]);
    const allPassed = checks.every(c => c.ok);
    res.json({ ok: allPassed, ranAt: Date.now(), checks });
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(ROOT, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`RO Survivors Bot Control Center listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
