import { useState } from 'react';
import { Copy, Check, Plus, Trash2, ArrowUpRight } from 'lucide-react';
import type {
  BenchmarkRow,
  BundleStatus,
  FarmAccount,
  JobDef,
  JobId,
  RunConfig,
  StageInfo,
} from '../types';

interface ExpeditionViewProps {
  config: RunConfig;
  bundle: BundleStatus;
  accounts: FarmAccount[];
  benchmarks: BenchmarkRow[];
  jobDefs: Record<JobId, JobDef>;
  stages: StageInfo[];
  lobbies: string[];
  onLoadAccountIntoConfig: (acct: FarmAccount) => void;
  onSaveAccount: (payload: {
    username: string;
    password?: string;
    job: JobId;
    charName: string;
    stage: string;
    lobby: string;
    runs: number;
    maxSeconds: number;
  }) => Promise<void>;
  onDeleteAccount: (username: string) => Promise<void>;
}

export function ExpeditionView({
  config,
  bundle,
  accounts,
  benchmarks,
  jobDefs,
  stages,
  lobbies,
  onLoadAccountIntoConfig,
  onSaveAccount,
  onDeleteAccount,
}: ExpeditionViewProps) {
  const [copiedCli, setCopiedCli] = useState(false);
  const [benchFilter, setBenchFilter] = useState<'all' | 'v6.1' | 'v5.1'>('all');
  const [newUser, setNewUser] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newChar, setNewChar] = useState('');
  const [newJob, setNewJob] = useState<JobId>('acolyte');
  const [newStage, setNewStage] = useState(stages[0]?.id || 'prontera');
  const [newLobby, setNewLobby] = useState(lobbies[0] || 'Nidavellir');

  const activeJob = jobDefs[config.job];
  const cliCommand = [
    'node bot/bot6.2.js',
    `--mode=${config.mode}`,
    config.mode === 'account' && config.username ? `--username=${config.username}` : '',
    config.mode === 'account' && config.charName ? `--char=${config.charName}` : '',
    `--job=${config.job}`,
    `--stage=${config.stage}`,
    `--lobby=${config.lobby}`,
    `--objectives=${JSON.stringify(config.objectives)}`,
    `--runs=${config.runs}`,
    `--max-seconds=${config.maxSeconds}`,
    `--max-loot=${config.maxLoot}`,
    `--ladder=${config.ladder}`,
    '--builds=builds.json',
    `--out=${config.out || 'logs'}`,
  ]
    .filter(Boolean)
    .join(' ');

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(cliCommand);
      setCopiedCli(true);
      setTimeout(() => setCopiedCli(false), 1800);
    } catch {
      // Clipboard API may be unavailable in restricted contexts
    }
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.trim()) return;
    await onSaveAccount({
      username: newUser.trim(),
      password: newPass || undefined,
      job: newJob,
      charName: newChar.trim(),
      stage: newStage,
      lobby: newLobby,
      runs: config.runs,
      maxSeconds: config.maxSeconds,
    });
    setNewUser('');
    setNewPass('');
    setNewChar('');
  };

  const visibleBenchmarks =
    benchFilter === 'all' ? benchmarks : benchmarks.filter(b => b.botVersion === benchFilter);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-4">
          <div className="text-xs font-medium text-slate-400">Active Bundle</div>
          <div className="mt-1.5 font-mono text-base font-bold text-[#E6EDF3] truncate">
            {bundle.manifest?.name || 'Missing'}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {bundle.files.patched.matchesManifest ? 'SHA-256 verified · 6 anchors' : 'Manifest mismatch'}
          </div>
        </div>

        <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-4">
          <div className="text-xs font-medium text-slate-400">Selected Combat Profile</div>
          <div className="mt-1.5 font-display text-base font-bold capitalize text-[#F59E0B]">
            {config.job}
          </div>
          <div className="mt-1 font-mono text-xs text-slate-400 tabular-nums">
            {activeJob ? `${activeJob.start} · ${activeJob.basicRange}px range · ${activeJob.basicDps} DPS` : '—'}
          </div>
        </div>

        <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-4">
          <div className="text-xs font-medium text-slate-400">Multi-Account Roster</div>
          <div className="mt-1.5 font-mono text-base font-bold tabular-nums text-[#E6EDF3]">
            {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Credentials write-only · masked in API
          </div>
        </div>

        <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-4">
          <div className="text-xs font-medium text-slate-400">Peak Recorded Loot Rate</div>
          <div className="mt-1.5 font-mono text-base font-bold tabular-nums text-[#10B981]">
            654.2 / min
          </div>
          <div className="mt-1 text-xs text-slate-400">
            v6.1 Slot 1 · 134.1 kills/min · Eclipse killed
          </div>
        </div>
      </div>

      <section className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-sm font-bold text-[#E6EDF3]">
              Controller CLI Command Preview
            </h2>
            <p className="text-xs text-slate-400">
              Exact runtime arguments passed to <code className="font-mono text-slate-300">bot/bot6.2.js</code> by <code className="font-mono text-slate-300">gui/engine.js</code>
            </p>
          </div>
          <button
            type="button"
            onClick={copyCommand}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#374151] bg-[#0B0F17] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-[#F59E0B] whitespace-nowrap cursor-pointer"
          >
            {copiedCli ? <Check className="h-3.5 w-3.5 text-[#10B981]" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
            {copiedCli ? 'Copied' : 'Copy Command'}
          </button>
        </div>
        <pre className="whitespace-pre-wrap break-words rounded-md border border-[#1F2937] bg-[#0B0F17] p-3 font-mono text-xs leading-relaxed text-[#FBBF24]">
          {cliCommand}
        </pre>
      </section>

      <section className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] pb-3">
          <div>
            <h2 className="font-display text-sm font-bold text-[#E6EDF3]">
              Farm Accounts Roster
            </h2>
            <p className="text-xs text-slate-400">
              Multi-slot execution list stored locally in <code className="font-mono text-slate-300">gui/accounts.json</code> (write-only secrets).
            </p>
          </div>
        </div>

        <form onSubmit={handleAddAccount} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-7 items-end">
          <label className="block">
            <span className="block text-[11px] font-medium text-slate-400 mb-1">Username</span>
            <input
              type="text"
              required
              value={newUser}
              onChange={e => setNewUser(e.target.value)}
              placeholder="farmer_01"
              className="w-full rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-slate-400 mb-1">Password (optional)</span>
            <input
              type="password"
              value={newPass}
              onChange={e => setNewPass(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-slate-400 mb-1">Character</span>
            <input
              type="text"
              value={newChar}
              onChange={e => setNewChar(e.target.value)}
              placeholder="SuraPrime"
              className="w-full rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-slate-400 mb-1">Job</span>
            <select
              value={newJob}
              onChange={e => setNewJob(e.target.value as JobId)}
              className="w-full rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
            >
              <option value="mage">Mage</option>
              <option value="swordsman">Swordsman</option>
              <option value="archer">Archer</option>
              <option value="acolyte">Acolyte</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-slate-400 mb-1">Stage</span>
            <select
              value={newStage}
              onChange={e => setNewStage(e.target.value)}
              className="w-full rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
            >
              {stages.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-slate-400 mb-1">Lobby</span>
            <select
              value={newLobby}
              onChange={e => setNewLobby(e.target.value)}
              className="w-full rounded-md border border-[#374151] bg-[#0B0F17] px-2.5 py-1.5 text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
            >
              {lobbies.map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#F59E0B] px-3 py-1.5 text-xs font-bold text-[#0B0F17] hover:bg-[#FBBF24] whitespace-nowrap cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Slot
          </button>
        </form>

        {accounts.length === 0 ? (
          <p className="rounded-md border border-dashed border-[#1F2937] bg-[#0B0F17] p-4 text-xs text-slate-400">
            No farm accounts configured yet. Add an account slot above to queue multi-instance orchestration.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#1F2937] text-slate-400">
                  <th className="py-2 pr-3 font-medium">Account</th>
                  <th className="py-2 pr-3 font-medium">Character</th>
                  <th className="py-2 pr-3 font-medium">Job</th>
                  <th className="py-2 pr-3 font-medium">Stage / Lobby</th>
                  <th className="py-2 pr-3 font-medium">Password</th>
                  <th className="py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F2937]/70">
                {accounts.map(acct => (
                  <tr key={acct.username} className="hover:bg-[#161E2E]/60">
                    <td className="py-2.5 pr-3 font-mono font-semibold text-[#E6EDF3]">
                      {acct.username}
                    </td>
                    <td className="py-2.5 pr-3 text-slate-300">
                      {acct.charName || 'Auto-detect'}
                    </td>
                    <td className="py-2.5 pr-3 capitalize text-[#F59E0B] font-medium">
                      {acct.job}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-slate-400">
                      {acct.stage} · {acct.lobby}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-slate-400">
                      {acct.hasPassword ? 'Stored' : 'None'}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => onLoadAccountIntoConfig(acct)}
                        className="inline-flex items-center gap-1 rounded border border-[#374151] bg-[#0B0F17] px-2 py-1 text-[11px] font-semibold text-slate-200 hover:border-[#F59E0B] cursor-pointer"
                      >
                        Load
                        <ArrowUpRight className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete account ${acct.username}`}
                        onClick={() => onDeleteAccount(acct.username)}
                        className="p-1 text-slate-500 hover:text-[#EF4444] cursor-pointer align-middle"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] pb-3">
          <div>
            <h2 className="font-display text-sm font-bold text-[#E6EDF3]">
              Field Benchmarks (Beast v5.1 & v6.1 Logs)
            </h2>
            <p className="text-xs text-slate-400">
              Parsed directly from <code className="font-mono text-slate-300">docs/beast-v5-report.md</code> and <code className="font-mono text-slate-300">docs/beast-v6-report.md</code>
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-md bg-[#0B0F17] p-1 border border-[#1F2937]">
            {(['all', 'v6.1', 'v5.1'] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setBenchFilter(f)}
                className={`px-2.5 py-1 rounded text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  benchFilter === f ? 'bg-[#1F2937] text-[#F59E0B]' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {f === 'all' ? 'All Batches' : f}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#1F2937] text-slate-400">
                <th className="py-2 pr-3 font-medium">Bot</th>
                <th className="py-2 pr-3 font-medium">Run</th>
                <th className="py-2 pr-3 font-medium text-right">Time</th>
                <th className="py-2 pr-3 font-medium text-right">Lv</th>
                <th className="py-2 pr-3 font-medium text-right">Kills/m</th>
                <th className="py-2 pr-3 font-medium text-right">Loot/m</th>
                <th className="py-2 pr-3 font-medium">Boss Damage</th>
                <th className="py-2 font-medium">Diagnosis & Telemetry Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F2937]/70">
              {visibleBenchmarks.map((row, idx) => (
                <tr key={`${row.botVersion}-${row.runLabel}-${idx}`} className="hover:bg-[#161E2E]/50">
                  <td className="py-2.5 pr-3 font-mono font-semibold text-[#F59E0B]">{row.botVersion}</td>
                  <td className="py-2.5 pr-3 text-[#E6EDF3] font-medium whitespace-nowrap">{row.runLabel}</td>
                  <td className="py-2.5 pr-3 font-mono tabular-nums text-right text-slate-200">
                    {row.gameTimeS.toFixed(1)}s
                  </td>
                  <td className="py-2.5 pr-3 font-mono tabular-nums text-right text-slate-200">
                    {row.level}
                  </td>
                  <td className="py-2.5 pr-3 font-mono tabular-nums text-right text-slate-200">
                    {row.killsPerMin.toFixed(1)}
                  </td>
                  <td className="py-2.5 pr-3 font-mono tabular-nums text-right font-semibold text-[#10B981]">
                    {row.lootPerMin.toFixed(1)}
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-slate-300">{row.bossDamage}</td>
                  <td className="py-2.5 text-slate-400 max-w-md">
                    <span className="font-mono font-semibold text-[#EF4444]">[{row.diagnosis}]</span>{' '}
                    <span>{row.summary}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
