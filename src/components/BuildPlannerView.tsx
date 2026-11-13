import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Play, Save, Trash2 } from 'lucide-react';
import type { BuildsMap, JobId, ScoredCardResult, SkillPlanEntry } from '../types';

interface BuildPlannerViewProps {
  builds: BuildsMap;
  skillPlan: SkillPlanEntry[];
  onSaveBuilds: (next: BuildsMap) => Promise<void>;
}

const JOBS: JobId[] = ['mage', 'swordsman', 'archer', 'acolyte'];

const PHASE_PRESETS = [
  { label: 'Early Pack (t=60s, Lv4)', elapsedS: 60, level: 4, liveEnemies: 44, hpFrac: 0.9, bossDueIn: 90, bossActive: false, masteringActive: false },
  { label: 'Mid Minis (t=295s, Lv12)', elapsedS: 295, level: 12, liveEnemies: 30, hpFrac: 0.72, bossDueIn: 5, bossActive: false, masteringActive: false },
  { label: 'Late Boss Prep (t=640s, Lv17)', elapsedS: 640, level: 17, liveEnemies: 18, hpFrac: 0.65, bossDueIn: 80, bossActive: true, masteringActive: false },
  { label: 'Mastering (t=740s, Lv19)', elapsedS: 740, level: 19, liveEnemies: 8, hpFrac: 0.42, bossDueIn: 0, bossActive: true, masteringActive: true },
];

const SAMPLE_OFFERS: Record<JobId, Array<{ title: string; pickType: 'skill' | 'item' }>> = {
  mage: [
    { title: 'Fire Bolt Deity · Scorching Barrage', pickType: 'skill' },
    { title: 'Lightning Bolt Lv 2 · +15% Area', pickType: 'skill' },
    { title: 'Firewall Lv 1 · defensive wall', pickType: 'skill' },
    { title: 'Bulwark Armor +12 Defense', pickType: 'item' },
  ],
  swordsman: [
    { title: 'Bash Lv 4 · Heavy Single-Target Strike', pickType: 'skill' },
    { title: 'Sword Dance Lv 2 · Wide AoE Slash', pickType: 'skill' },
    { title: 'Endure Lv 2 · -8% Damage Taken', pickType: 'skill' },
    { title: 'Shield Bash Lv 1 · +200% Damage', pickType: 'skill' },
  ],
  archer: [
    { title: 'Double Strafe Lv 3 · Single-Target DPS', pickType: 'skill' },
    { title: 'Arrow Shower Lv 2 · 60deg Cone AoE', pickType: 'skill' },
    { title: 'Elixir of Surprise · +15% Discovery', pickType: 'item' },
    { title: 'Retreat Lv 1 · Leap Escape', pickType: 'skill' },
  ],
  acolyte: [
    { title: 'Holy Light Lv 2 · Single-Target Beam', pickType: 'skill' },
    { title: 'Magnus Exorcismus Lv 1 · Ground Sigil AoE', pickType: 'skill' },
    { title: 'Kyrie Eleison · Barrier Shield', pickType: 'skill' },
    { title: 'Heal Lv 3 · Sustain +12% Regen', pickType: 'skill' },
  ],
};

export function BuildPlannerView({ builds, skillPlan, onSaveBuilds }: BuildPlannerViewProps) {
  const [activeJob, setActiveJob] = useState<JobId>('acolyte');
  const [draft, setDraft] = useState<BuildsMap>(builds);
  const [newCardInput, setNewCardInput] = useState('');
  const [newItemInput, setNewItemInput] = useState('');
  const [savingBuilds, setSavingBuilds] = useState(false);

  const [phaseIdx, setPhaseIdx] = useState(0);
  const [customOfferTitle, setCustomOfferTitle] = useState('');
  const [customPickType, setCustomPickType] = useState<'skill' | 'item'>('skill');
  const [offers, setOffers] = useState<Array<{ title: string; pickType: 'skill' | 'item' }>>(SAMPLE_OFFERS.acolyte);
  const [scored, setScored] = useState<ScoredCardResult[]>([]);
  const [scoring, setScoring] = useState(false);

  useEffect(() => {
    setDraft(builds);
  }, [builds]);

  useEffect(() => {
    setOffers(SAMPLE_OFFERS[activeJob]);
    setScored([]);
  }, [activeJob]);

  const runScoreSimulation = async (overrideOffers = offers, overrideDraft = draft, overridePhase = phaseIdx) => {
    setScoring(true);
    try {
      const phase = PHASE_PRESETS[overridePhase];
      const res = await fetch('/api/planner/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job: activeJob,
          ...phase,
          candidates: overrideOffers,
          builds: overrideDraft,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setScored(data.ranked || []);
      }
    } finally {
      setScoring(false);
    }
  };

  useEffect(() => {
    void runScoreSimulation(SAMPLE_OFFERS[activeJob], draft, phaseIdx);
  }, [activeJob, phaseIdx]);

  const addPriorityEntry = (kind: 'cards' | 'items', value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const current = draft[activeJob][kind];
    if (current.some(v => v.toLowerCase() === trimmed.toLowerCase())) return;
    const next: BuildsMap = {
      ...draft,
      [activeJob]: {
        ...draft[activeJob],
        [kind]: [...current, trimmed],
      },
    };
    setDraft(next);
    if (kind === 'cards') setNewCardInput('');
    else setNewItemInput('');
    void runScoreSimulation(offers, next, phaseIdx);
  };

  const movePriorityEntry = (kind: 'cards' | 'items', index: number, delta: -1 | 1) => {
    const list = [...draft[activeJob][kind]];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    const next: BuildsMap = {
      ...draft,
      [activeJob]: { ...draft[activeJob], [kind]: list },
    };
    setDraft(next);
    void runScoreSimulation(offers, next, phaseIdx);
  };

  const removePriorityEntry = (kind: 'cards' | 'items', index: number) => {
    const next: BuildsMap = {
      ...draft,
      [activeJob]: {
        ...draft[activeJob],
        [kind]: draft[activeJob][kind].filter((_, idx) => idx !== index),
      },
    };
    setDraft(next);
    void runScoreSimulation(offers, next, phaseIdx);
  };

  const handleSave = async () => {
    setSavingBuilds(true);
    try {
      await onSaveBuilds(draft);
    } finally {
      setSavingBuilds(false);
    }
  };

  const handleAddOffer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customOfferTitle.trim()) return;
    const nextOffers = [...offers, { title: customOfferTitle.trim(), pickType: customPickType }];
    setOffers(nextOffers);
    setCustomOfferTitle('');
    void runScoreSimulation(nextOffers, draft, phaseIdx);
  };

  const jobSkills = skillPlan.filter(s => s.job === activeJob);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#1F2937] bg-[#111827] p-4">
        <div className="flex items-center gap-1 rounded-md bg-[#0B0F17] p-1 border border-[#1F2937]">
          {JOBS.map(job => (
            <button
              key={job}
              type="button"
              onClick={() => setActiveJob(job)}
              className={`px-3.5 py-1.5 rounded text-xs font-bold capitalize whitespace-nowrap cursor-pointer ${
                activeJob === job
                  ? 'bg-[#1F2937] text-[#F59E0B]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {job}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={savingBuilds}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#F59E0B] px-3.5 py-1.5 text-xs font-bold text-[#0B0F17] hover:bg-[#FBBF24] whitespace-nowrap cursor-pointer"
        >
          <Save className="h-3.5 w-3.5" />
          {savingBuilds ? 'Saving builds.json...' : 'Save builds.json'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-4">
          <div className="border-b border-[#1F2937] pb-2.5">
            <h2 className="font-display text-sm font-bold text-[#E6EDF3] capitalize">
              {activeJob} User-Build Priority Overrides
            </h2>
            <p className="text-xs text-slate-400">
              Listed substrings boost matching cards or items ahead of heuristic scoring (<code className="font-mono text-slate-300">--builds=builds.json</code>).
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Skill & Deity Card Priority Order
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCardInput}
                  onChange={e => setNewCardInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPriorityEntry('cards', newCardInput); } }}
                  placeholder="e.g. Magnus Exorcismus"
                  className="min-w-0 flex-1 rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => addPriorityEntry('cards', newCardInput)}
                  className="inline-flex items-center gap-1 rounded-md border border-[#374151] bg-[#161E2E] px-2.5 py-1.5 text-xs font-semibold text-[#E6EDF3] hover:border-[#F59E0B] cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Card
                </button>
              </div>

              <ul className="mt-2 space-y-1.5">
                {draft[activeJob].cards.length === 0 ? (
                  <li className="text-xs text-slate-500">No custom card overrides — using phase-aware planner defaults.</li>
                ) : (
                  draft[activeJob].cards.map((entry, idx) => (
                    <li
                      key={`${entry}-${idx}`}
                      className="flex items-center justify-between gap-2 rounded border border-[#1F2937] bg-[#0B0F17] px-2.5 py-1.5 text-xs"
                    >
                      <span className="font-mono text-slate-200 truncate">
                        #{idx + 1} · {entry}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => movePriorityEntry('cards', idx, -1)} aria-label="Move up" className="p-1 text-slate-400 hover:text-[#F59E0B] cursor-pointer">
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => movePriorityEntry('cards', idx, 1)} aria-label="Move down" className="p-1 text-slate-400 hover:text-[#F59E0B] cursor-pointer">
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => removePriorityEntry('cards', idx)} aria-label={`Remove ${entry}`} className="p-1 text-slate-400 hover:text-[#EF4444] cursor-pointer">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="border-t border-[#1F2937] pt-3">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Chest / Item Priority Order
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newItemInput}
                  onChange={e => setNewItemInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPriorityEntry('items', newItemInput); } }}
                  placeholder="e.g. Elixir of Surprise"
                  className="min-w-0 flex-1 rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => addPriorityEntry('items', newItemInput)}
                  className="inline-flex items-center gap-1 rounded-md border border-[#374151] bg-[#161E2E] px-2.5 py-1.5 text-xs font-semibold text-[#E6EDF3] hover:border-[#F59E0B] cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Item
                </button>
              </div>

              <ul className="mt-2 space-y-1.5">
                {draft[activeJob].items.length === 0 ? (
                  <li className="text-xs text-slate-500">No custom item overrides.</li>
                ) : (
                  draft[activeJob].items.map((entry, idx) => (
                    <li
                      key={`${entry}-${idx}`}
                      className="flex items-center justify-between gap-2 rounded border border-[#1F2937] bg-[#0B0F17] px-2.5 py-1.5 text-xs"
                    >
                      <span className="font-mono text-slate-200 truncate">
                        #{idx + 1} · {entry}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => movePriorityEntry('items', idx, -1)} aria-label="Move up" className="p-1 text-slate-400 hover:text-[#F59E0B] cursor-pointer">
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => movePriorityEntry('items', idx, 1)} aria-label="Move down" className="p-1 text-slate-400 hover:text-[#F59E0B] cursor-pointer">
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => removePriorityEntry('items', idx)} aria-label={`Remove ${entry}`} className="p-1 text-slate-400 hover:text-[#EF4444] cursor-pointer">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>

          <div className="border-t border-[#1F2937] pt-3">
            <h3 className="text-xs font-semibold text-slate-300 mb-2 capitalize">
              Default {activeJob} Skill Weights (<code className="font-mono text-slate-400">SKILL_PLAN</code>)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#1F2937] text-slate-400">
                    <th className="py-1.5 pr-2 font-medium">Skill</th>
                    <th className="py-1.5 pr-2 font-medium">Role</th>
                    <th className="py-1.5 pr-2 font-medium text-right">DPS</th>
                    <th className="py-1.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F2937]/60">
                  {jobSkills.map(s => (
                    <tr key={s.id}>
                      <td className="py-1.5 pr-2 font-mono text-slate-200">{s.id}</td>
                      <td className="py-1.5 pr-2 font-mono text-[#F59E0B]">{s.role}</td>
                      <td className="py-1.5 pr-2 font-mono tabular-nums text-right text-slate-300">{s.dps}</td>
                      <td className="py-1.5 text-slate-400">{s.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] pb-2.5">
            <div>
              <h2 className="font-display text-sm font-bold text-[#E6EDF3]">
                Card Offer Simulator (<code className="font-mono text-[#F59E0B]">scoreCard()</code>)
              </h2>
              <p className="text-xs text-slate-400">
                Runs server-side <code className="font-mono text-slate-300">bot/build-planner.js</code> against real phase multipliers.
              </p>
            </div>
            <button
              type="button"
              onClick={() => runScoreSimulation()}
              disabled={scoring}
              className="inline-flex items-center gap-1 rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-[#F59E0B] cursor-pointer"
            >
              <Play className="h-3.5 w-3.5 text-[#F59E0B]" />
              {scoring ? 'Scoring...' : 'Re-Score'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {PHASE_PRESETS.map((p, idx) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setPhaseIdx(idx)}
                className={`px-2.5 py-1.5 rounded border text-left text-xs font-medium cursor-pointer ${
                  phaseIdx === idx
                    ? 'border-[#F59E0B] bg-[#F59E0B]/12 text-[#FBBF24]'
                    : 'border-[#1F2937] bg-[#0B0F17] text-slate-400 hover:text-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleAddOffer} className="flex gap-2">
            <input
              type="text"
              value={customOfferTitle}
              onChange={e => setCustomOfferTitle(e.target.value)}
              placeholder="Test custom card offer text..."
              className="min-w-0 flex-1 rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
            />
            <select
              value={customPickType}
              onChange={e => setCustomPickType(e.target.value as 'skill' | 'item')}
              className="rounded-md border border-[#374151] bg-[#0B0F17] px-2 py-1.5 text-xs text-[#E6EDF3]"
            >
              <option value="skill">Skill</option>
              <option value="item">Item</option>
            </select>
            <button
              type="submit"
              className="rounded-md border border-[#374151] bg-[#161E2E] px-2.5 py-1.5 text-xs font-semibold text-[#E6EDF3] hover:border-[#F59E0B] cursor-pointer"
            >
              Add Offer
            </button>
          </form>

          <div className="space-y-2.5">
            {scored.map((card, rank) => (
              <div
                key={`${card.title}-${card.index}`}
                className={`rounded-md border p-3 ${
                  rank === 0 && card.score > 0
                    ? 'border-[#10B981]/60 bg-[#10B981]/8'
                    : card.score < 0
                      ? 'border-[#EF4444]/40 bg-[#EF4444]/8'
                      : 'border-[#1F2937] bg-[#0B0F17]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#F59E0B]">
                        #{rank + 1}
                      </span>
                      <span className="text-xs font-semibold text-[#E6EDF3]">
                        {card.title}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-slate-400">
                      type={card.pickType} · hits: {card.hits.length ? card.hits.join(', ') : 'none'}
                    </div>
                  </div>
                  <div className="font-mono text-sm font-bold tabular-nums text-[#E6EDF3] shrink-0">
                    {card.score.toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
