import { useEffect, useRef, useState } from 'react';
import { Flame, Pause, Play, Plus, RotateCcw, SkipForward } from 'lucide-react';
import {
  TACTICAL_SCENARIOS,
  createRuntimeState,
  createScenarioState,
  steer,
  stepScenarioTick,
  type SimState,
  type SteerDecision,
  type SteerRuntimeState,
  type TacticalScenarioSpec,
} from '../utils/tacticalEngine';

const MODE_COLORS: Record<string, string> = {
  rescue: 'text-[#10B981]',
  breakout: 'text-[#F59E0B]',
  prethin: 'text-[#F59E0B]',
  emergency: 'text-[#EF4444]',
  'horde-avoid': 'text-[#EF4444]',
  'horde-prep': 'text-[#38BDF8]',
  boss: 'text-[#F59E0B]',
  mastering: 'text-[#FBBF24]',
  kite: 'text-[#38BDF8]',
  engage: 'text-slate-200',
  thin: 'text-[#38BDF8]',
  'spawn-leash': 'text-slate-300',
};

function drawTacticalCanvas(canvas: HTMLCanvasElement | null, sim: SimState, decision: SteerDecision, ranged: boolean) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(320, Math.round(rect.width));
  const h = Math.max(260, Math.round(rect.height));
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.save();
  ctx.scale(dpr, dpr);

  // Dark canvas backdrop
  ctx.fillStyle = '#070A10';
  ctx.fillRect(0, 0, w, h);

  const px = sim.player.x;
  const py = sim.player.y;
  const scale = 0.65;
  const toScreen = (wx: number, wy: number) => ({
    x: w / 2 + (wx - px) * scale,
    y: h / 2 + (wy - py) * scale,
  });

  // Subtle spatial grid
  ctx.strokeStyle = 'rgba(31, 41, 55, 0.55)';
  ctx.lineWidth = 1;
  const gridStep = 100 * scale;
  const offX = ((w / 2 - px * scale) % gridStep + gridStep) % gridStep;
  const offY = ((h / 2 - py * scale) % gridStep + gridStep) % gridStep;
  for (let gx = offX; gx < w; gx += gridStep) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }
  for (let gy = offY; gy < h; gy += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

  // Engagement range circle around player
  const center = toScreen(px, py);
  ctx.strokeStyle = ranged ? 'rgba(56, 189, 248, 0.25)' : 'rgba(245, 158, 11, 0.28)';
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(center.x, center.y, (ranged ? 340 : 95) * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Fire rings (AoE danger zones)
  for (const r of sim.fireRings) {
    const pos = toScreen(r.x, r.y);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.78)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r.r * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Pickups
  for (const p of sim.pickups) {
    const pos = toScreen(p.x, p.y);
    if (p.kind === 'meat') {
      ctx.fillStyle = '#10B981';
      ctx.fillRect(pos.x - 5, pos.y - 5, 10, 10);
      ctx.fillStyle = '#E6EDF3';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText('MEAT', pos.x + 8, pos.y + 3);
    } else if (p.kind === 'magnet' || p.kind === 'chest') {
      ctx.fillStyle = p.kind === 'magnet' ? '#38BDF8' : '#F59E0B';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#CBD5E1';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(p.kind.toUpperCase(), pos.x + 8, pos.y + 3);
    } else {
      ctx.fillStyle = '#60A5FA';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Projectiles
  for (const pr of sim.projectiles) {
    const pos = toScreen(pr.x, pr.y);
    ctx.fillStyle = '#F87171';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Enemies & Bosses
  for (const e of sim.enemies) {
    if (e.dead) continue;
    const pos = toScreen(e.x, e.y);
    if (e.boss) {
      ctx.fillStyle = '#F59E0B';
      ctx.strokeStyle = '#FEF3C7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FEF3C7';
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.fillText(`${e.id.replace('_boss', '').toUpperCase()} ${Math.round(e.hp)}HP`, pos.x + 15, pos.y + 4);
    } else {
      ctx.fillStyle = e.elite ? '#A78BFA' : '#EF4444';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, e.elite ? 6.5 : 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Steering vector arrow
  const vecLen = 68;
  const vx = center.x + decision.dx * vecLen;
  const vy = center.y + decision.dy * vecLen;
  ctx.strokeStyle = decision.dodge.hard ? '#38BDF8' : '#10B981';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(center.x, center.y);
  ctx.lineTo(vx, vy);
  ctx.stroke();

  const ang = Math.atan2(vy - center.y, vx - center.x);
  ctx.fillStyle = decision.dodge.hard ? '#38BDF8' : '#10B981';
  ctx.beginPath();
  ctx.moveTo(vx, vy);
  ctx.lineTo(vx - 8 * Math.cos(ang - 0.45), vy - 8 * Math.sin(ang - 0.45));
  ctx.lineTo(vx - 8 * Math.cos(ang + 0.45), vy - 8 * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();

  // Hero marker
  ctx.fillStyle = '#E6EDF3';
  ctx.strokeStyle = '#F59E0B';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(center.x, center.y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Legend overlay top-left
  ctx.fillStyle = 'rgba(11, 15, 23, 0.8)';
  ctx.fillRect(10, 10, 224, 24);
  ctx.fillStyle = '#CBD5E1';
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.fillText(`t=${sim.time.toFixed(1)}s  mode=${decision.mode}`, 18, 26);

  ctx.restore();
}

export function TacticalLabView() {
  const [scenarioId, setScenarioId] = useState<TacticalScenarioSpec['id']>('eclipse-contact');
  const [ranged, setRanged] = useState(false);
  const [enableThinning, setEnableThinning] = useState(true);
  const [playing, setPlaying] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<SimState>(createScenarioState('eclipse-contact'));
  const stRef = useRef<SteerRuntimeState>(createRuntimeState({ ranged: false, enableThinning: true }));

  const [snapshot, setSnapshot] = useState<{ sim: SimState; decision: SteerDecision }>(() => ({
    sim: structuredClone(simRef.current),
    decision: steer(simRef.current, stRef.current),
  }));

  const syncDraw = () => {
    const decision = steer(simRef.current, stRef.current);
    setSnapshot({ sim: structuredClone(simRef.current), decision });
    drawTacticalCanvas(canvasRef.current, simRef.current, decision, stRef.current.ranged);
  };

  const resetScenario = (nextId = scenarioId, nextRanged = ranged, nextThin = enableThinning) => {
    setPlaying(false);
    simRef.current = createScenarioState(nextId);
    stRef.current = createRuntimeState({ ranged: nextRanged, enableThinning: nextThin });
    const decision = steer(simRef.current, stRef.current);
    setSnapshot({ sim: structuredClone(simRef.current), decision });
    drawTacticalCanvas(canvasRef.current, simRef.current, decision, nextRanged);
  };

  useEffect(() => {
    drawTacticalCanvas(canvasRef.current, simRef.current, snapshot.decision, stRef.current.ranged);
  });

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      if (simRef.current.state === 'over') {
        setPlaying(false);
        return;
      }
      const decision = stepScenarioTick(simRef.current, stRef.current, 0.1);
      setSnapshot({ sim: structuredClone(simRef.current), decision });
      drawTacticalCanvas(canvasRef.current, simRef.current, decision, stRef.current.ranged);
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing]);

  const handleStep = () => {
    if (simRef.current.state === 'over') return;
    const decision = stepScenarioTick(simRef.current, stRef.current, 0.1);
    setSnapshot({ sim: structuredClone(simRef.current), decision });
    drawTacticalCanvas(canvasRef.current, simRef.current, decision, stRef.current.ranged);
  };

  const injectSwarm = () => {
    const baseCount = simRef.current.enemies.length;
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      simRef.current.enemies.push({
        id: `inj_${baseCount + i}`,
        x: simRef.current.player.x + Math.cos(ang) * 90,
        y: simRef.current.player.y + Math.sin(ang) * 90,
        hp: 90,
        maxHp: 90,
        speed: 68,
        damage: 5,
      });
    }
    syncDraw();
  };

  const injectFireRing = () => {
    simRef.current.fireRings.push({
      x: simRef.current.player.x + 20,
      y: simRef.current.player.y - 10,
      r: 95,
      ttl: 4,
    });
    syncDraw();
  };

  const injectMeat = () => {
    simRef.current.pickups.push({
      id: `meat_${Date.now()}`,
      x: simRef.current.player.x - 190,
      y: simRef.current.player.y + 85,
      kind: 'meat',
    });
    simRef.current.hp = Math.min(simRef.current.hp, Math.round(simRef.current.maxHp * 0.42));
    syncDraw();
  };

  const activeScenario = TACTICAL_SCENARIOS.find(s => s.id === scenarioId)!;
  const { sim, decision } = snapshot;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#1F2937] bg-[#111827] p-4">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-bold text-[#E6EDF3]">
            Tactical Steering Lab (Live <code className="font-mono text-[#F59E0B]">steer-policy.js</code> Parity)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">{activeScenario.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Tactical scenario"
            value={scenarioId}
            onChange={e => {
              const id = e.target.value as TacticalScenarioSpec['id'];
              setScenarioId(id);
              resetScenario(id, ranged, enableThinning);
            }}
            className="rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
          >
            {TACTICAL_SCENARIOS.map(sc => (
              <option key={sc.id} value={sc.id}>
                {sc.title}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setPlaying(p => !p)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#F59E0B] px-3 py-1.5 text-xs font-bold text-[#0B0F17] hover:bg-[#FBBF24] whitespace-nowrap cursor-pointer"
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
            {playing ? 'Pause' : 'Play'}
          </button>

          <button
            type="button"
            onClick={handleStep}
            className="inline-flex items-center gap-1 rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-[#F59E0B] whitespace-nowrap cursor-pointer"
          >
            <SkipForward className="h-3.5 w-3.5" />
            +100ms
          </button>

          <button
            type="button"
            onClick={() => resetScenario()}
            className="inline-flex items-center gap-1 rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-[#F59E0B] whitespace-nowrap cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-3">
          <div className="rounded-lg border border-[#1F2937] bg-[#070A10] p-2">
            <canvas
              ref={canvasRef}
              data-testid="tactical-canvas"
              className="block h-[400px] w-full rounded"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#1F2937] bg-[#111827] px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ranged}
                  onChange={e => {
                    const next = e.target.checked;
                    setRanged(next);
                    stRef.current.ranged = next;
                    syncDraw();
                  }}
                  className="accent-[#F59E0B]"
                />
                Ranged Kite Profile
              </label>

              <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableThinning}
                  onChange={e => {
                    const next = e.target.checked;
                    setEnableThinning(next);
                    stRef.current.enableThinning = next;
                    syncDraw();
                  }}
                  className="accent-[#F59E0B]"
                />
                v6.2 Pre-Boss Thinning & Breakout
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={injectSwarm}
                className="inline-flex items-center gap-1 rounded border border-[#374151] bg-[#0B0F17] px-2 py-1 text-[11px] font-semibold text-slate-200 hover:border-[#F59E0B] cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                +12 Pack
              </button>
              <button
                type="button"
                onClick={injectFireRing}
                className="inline-flex items-center gap-1 rounded border border-[#374151] bg-[#0B0F17] px-2 py-1 text-[11px] font-semibold text-slate-200 hover:border-[#EF4444] cursor-pointer"
              >
                <Flame className="h-3 w-3 text-[#EF4444]" />
                Fire Ring
              </button>
              <button
                type="button"
                onClick={injectMeat}
                className="inline-flex items-center gap-1 rounded border border-[#374151] bg-[#0B0F17] px-2 py-1 text-[11px] font-semibold text-slate-200 hover:border-[#10B981] cursor-pointer"
              >
                <Plus className="h-3 w-3 text-[#10B981]" />
                Drop Meat & 42% HP
              </button>
            </div>
          </div>
        </div>

        <aside className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-[#1F2937] pb-2.5">
            <h3 className="font-display text-sm font-bold text-[#E6EDF3]">Live Decision Output</h3>
            <span className={`font-mono text-xs font-bold uppercase ${MODE_COLORS[decision.mode] || 'text-slate-200'}`}>
              {decision.mode}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
            <div>
              <dt className="text-slate-400">Game Clock</dt>
              <dd className="font-mono font-semibold tabular-nums text-[#E6EDF3] mt-0.5">
                {sim.time.toFixed(1)} s
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Player HP</dt>
              <dd className="font-mono font-semibold tabular-nums text-[#E6EDF3] mt-0.5">
                {Math.round(sim.hp)} / {sim.maxHp} ({Math.round(decision.hpFrac * 100)}%)
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Live Enemies</dt>
              <dd className="font-mono font-semibold tabular-nums text-[#E6EDF3] mt-0.5">
                {decision.nEnemies} ({decision.nNear} in 260px)
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Nearest Add / Any</dt>
              <dd className="font-mono font-semibold tabular-nums text-[#E6EDF3] mt-0.5">
                {decision.nearestAdd ?? '—'} px / {decision.nearest ?? '—'} px
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Next Boss Window</dt>
              <dd className="font-mono font-semibold tabular-nums text-[#F59E0B] mt-0.5">
                {decision.timeToBoss != null ? `${decision.timeToBoss.toFixed(1)} s` : 'Active / Complete'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Heading Vector</dt>
              <dd className="font-mono font-semibold tabular-nums text-[#38BDF8] mt-0.5">
                ({decision.dx.toFixed(2)}, {decision.dy.toFixed(2)})
              </dd>
            </div>
          </dl>

          <div className="border-t border-[#1F2937] pt-3 space-y-2 text-xs">
            <div className="text-slate-400 font-medium">Dodge & Union Analysis</div>
            <div className="rounded-md border border-[#1F2937] bg-[#0B0F17] p-2.5 font-mono text-[11px] text-slate-300">
              {decision.dodge.reasons.length > 0
                ? `${decision.dodge.hard ? 'HARD DODGE' : 'PRECAST DRIFT'} · ${decision.dodge.reasons.join(', ')}`
                : 'Clear — holding optimal combat band / gap vector'}
            </div>
          </div>

          <div className="border-t border-[#1F2937] pt-3 space-y-2 text-xs">
            <div className="text-slate-400 font-medium">Meat Rescue Feasibility Gate</div>
            <div className="rounded-md border border-[#1F2937] bg-[#0B0F17] p-2.5 font-mono text-[11px] text-slate-300">
              {decision.rescue
                ? decision.rescue.denied
                  ? `DENIED (d=${decision.rescue.d}px, projected HP ${decision.rescue.projected} below safety floor)`
                  : `APPROVED (d=${decision.rescue.d}px, ETA ${decision.rescue.tReach}s, projected HP ${decision.rescue.projected})`
                : decision.nearestMeat != null
                  ? `Meat at ${decision.nearestMeat}px (HP above 50% threshold — holding pack control)`
                  : 'No meat pickup on field'}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
