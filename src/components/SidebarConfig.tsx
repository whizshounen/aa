import { useState } from 'react';
import { BookmarkPlus, Trash2 } from 'lucide-react';
import type { JobDef, JobId, PresetEntry, RunConfig, StageInfo } from '../types';

interface SidebarConfigProps {
  config: RunConfig;
  jobDefs: Record<JobId, JobDef>;
  stages: StageInfo[];
  lobbies: string[];
  presets: PresetEntry[];
  onChange: (next: RunConfig) => void;
  onSavePreset: (name: string) => Promise<void>;
  onLoadPreset: (preset: PresetEntry) => void;
  onDeletePreset: (name: string) => Promise<void>;
}

const JOB_LABELS: Record<JobId, string> = {
  mage: 'Mage',
  swordsman: 'Swordsman',
  archer: 'Archer',
  acolyte: 'Acolyte',
};

export function SidebarConfig({
  config,
  jobDefs,
  stages,
  lobbies,
  presets,
  onChange,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
}: SidebarConfigProps) {
  const [presetName, setPresetName] = useState('');
  const [objectivesDraft, setObjectivesDraft] = useState(config.objectives.join(', '));
  const activeJob = jobDefs[config.job];

  const handleObjectivesBlur = () => {
    const parsed = objectivesDraft
      .split(/[,;\n]/)
      .map(s => s.trim())
      .filter(Boolean);
    onChange({ ...config, objectives: parsed });
  };

  const handleSavePresetClick = async () => {
    const trimmed = presetName.trim();
    if (!trimmed) return;
    await onSavePreset(trimmed);
    setPresetName('');
  };

  return (
    <aside className="w-full lg:w-[340px] shrink-0 space-y-5">
      <section className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-[#1F2937] pb-3">
          <h2 className="font-display text-sm font-bold tracking-tight text-[#E6EDF3]">
            Expedition Config
          </h2>
          <span className="font-mono text-xs text-slate-400">
            gui/config.json
          </span>
        </div>

        <div>
          <span className="block text-xs font-medium text-slate-400 mb-1.5">Session Mode</span>
          <div className="grid grid-cols-2 gap-1.5 rounded-md bg-[#0B0F17] p-1 border border-[#1F2937]">
            {(['guest', 'account'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => onChange({ ...config, mode })}
                className={`py-1.5 rounded text-xs font-semibold capitalize whitespace-nowrap transition-colors cursor-pointer ${
                  config.mode === mode
                    ? 'bg-[#1F2937] text-[#F59E0B]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {config.mode === 'account' && (
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1">Username</span>
              <input
                type="text"
                value={config.username}
                onChange={e => onChange({ ...config, username: e.target.value })}
                placeholder="account name"
                className="w-full rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1">Character</span>
              <input
                type="text"
                value={config.charName}
                onChange={e => onChange({ ...config, charName: e.target.value })}
                placeholder="slot name"
                className="w-full rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
              />
            </label>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-400">Combat Job</span>
            {activeJob && (
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                HP {activeJob.hp} · Spd {activeJob.speed} · {activeJob.ranged ? 'Ranged' : 'Melee'}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(JOB_LABELS) as JobId[]).map(job => (
              <button
                key={job}
                type="button"
                onClick={() => onChange({ ...config, job })}
                className={`px-2.5 py-2 rounded-md border text-xs font-semibold text-left transition-colors cursor-pointer whitespace-nowrap ${
                  config.job === job
                    ? 'border-[#F59E0B] bg-[#F59E0B]/12 text-[#FBBF24]'
                    : 'border-[#1F2937] bg-[#0B0F17] text-slate-300 hover:border-[#374151]'
                }`}
              >
                {JOB_LABELS[job]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1">Stage</span>
            <select
              value={config.stage}
              onChange={e => onChange({ ...config, stage: e.target.value })}
              className="w-full rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
            >
              {stages.map(s => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1">Lobby</span>
            <select
              value={config.lobby}
              onChange={e => onChange({ ...config, lobby: e.target.value })}
              className="w-full rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
            >
              {lobbies.map(l => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1">Runs</span>
            <input
              type="number"
              min={1}
              max={999}
              value={config.runs}
              onChange={e => onChange({ ...config, runs: Math.max(1, Number(e.target.value) || 1) })}
              className="w-full rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs tabular-nums text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1">Max Seconds</span>
            <input
              type="number"
              min={60}
              max={14400}
              step={60}
              value={config.maxSeconds}
              onChange={e => onChange({ ...config, maxSeconds: Math.max(60, Number(e.target.value) || 3600) })}
              className="w-full rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs tabular-nums text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
            />
          </label>
        </div>

        <label className="block">
          <span className="block text-xs font-medium text-slate-400 mb-1">
            Loot / Boss Objectives
          </span>
          <input
            type="text"
            value={objectivesDraft}
            onChange={e => setObjectivesDraft(e.target.value)}
            onBlur={handleObjectivesBlur}
            placeholder="zeny>=300, eclipse_kill"
            className="w-full rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
          />
        </label>

        <div className="flex items-center justify-between pt-1">
          <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={config.maxLoot}
              onChange={e => onChange({ ...config, maxLoot: e.target.checked })}
              className="rounded border-[#374151] bg-[#0B0F17] accent-[#F59E0B]"
            />
            Max LootSweep
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={config.ladder}
              onChange={e => onChange({ ...config, ladder: e.target.checked })}
              className="rounded border-[#374151] bg-[#0B0F17] accent-[#F59E0B]"
            />
            Endless Ladder
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-[#E6EDF3]">Saved Presets</h3>
          <span className="font-mono text-xs text-slate-400 tabular-nums">{presets.length}</span>
        </div>

        <div className="flex gap-1.5">
          <input
            type="text"
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            placeholder="Preset name..."
            className="min-w-0 flex-1 rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSavePresetClick}
            className="inline-flex items-center gap-1 rounded-md border border-[#374151] bg-[#161E2E] px-2.5 py-1.5 text-xs font-semibold text-[#E6EDF3] hover:border-[#F59E0B] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BookmarkPlus className="h-3.5 w-3.5 text-[#F59E0B]" />
            Save
          </button>
        </div>

        {presets.length === 0 ? (
          <p className="text-xs text-slate-500">
            No saved presets yet. Save the current run configuration above.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {presets.map(p => (
              <li
                key={p.name}
                className="flex items-center justify-between gap-2 rounded-md border border-[#1F2937] bg-[#0B0F17] px-2.5 py-1.5"
              >
                <button
                  type="button"
                  onClick={() => {
                    onLoadPreset(p);
                    setObjectivesDraft(p.config.objectives.join(', '));
                  }}
                  className="min-w-0 flex-1 text-left cursor-pointer"
                >
                  <div className="truncate text-xs font-semibold text-[#E6EDF3] hover:text-[#F59E0B]">
                    {p.name}
                  </div>
                  <div className="truncate font-mono text-[11px] text-slate-500">
                    {p.config.job} · {p.config.stage} · {p.config.runs}r
                  </div>
                </button>
                <button
                  type="button"
                  aria-label={`Delete preset ${p.name}`}
                  onClick={() => onDeletePreset(p.name)}
                  className="p-1 text-slate-500 hover:text-[#EF4444] cursor-pointer shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
