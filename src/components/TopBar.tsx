import { CheckCircle2, Play, RotateCw, Save } from 'lucide-react';
import type { BundleStatus, TabId } from '../types';

interface TopBarProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  bundle: BundleStatus;
  savingConfig: boolean;
  configDirty: boolean;
  statusMessage: string | null;
  onSaveConfig: () => void;
  onRunVerification: () => void;
}

const NAV_ITEMS: Array<{ id: TabId; label: string }> = [
  { id: 'expedition', label: 'Expedition' },
  { id: 'tactical', label: 'Tactical Lab' },
  { id: 'planner', label: 'Build Planner' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

export function TopBar({
  activeTab,
  onSelectTab,
  bundle,
  savingConfig,
  configDirty,
  statusMessage,
  onSaveConfig,
  onRunVerification,
}: TopBarProps) {
  const bundleOk = Boolean(bundle.manifest?.ok && bundle.files.patched.matchesManifest);
  const bundleName = bundle.manifest?.name || 'unpatched';

  return (
    <header className="sticky top-0 z-30 border-b border-[#1F2937] bg-[#0B0F17]/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-4 gap-y-2.5 px-4 sm:px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#F59E0B] text-xs font-extrabold tracking-tight text-[#0B0F17]">
              RO
            </span>
            <span className="font-display text-base font-bold tracking-tight text-[#E6EDF3] whitespace-nowrap">
              RO Survivors Bot
            </span>
          </div>
          <span className="hidden text-xs font-mono text-slate-500 sm:inline whitespace-nowrap">
            · {bundleName} · {bundleOk ? 'REA Verified' : 'Check Bundle'}
          </span>
        </div>

        <nav aria-label="Primary sections" className="flex items-center gap-1 max-w-full">
          {NAV_ITEMS.map(item => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`px-2.5 sm:px-3.5 py-1.5 rounded-md text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#1F2937] text-[#F59E0B]'
                    : 'text-slate-400 hover:bg-[#111827] hover:text-[#E6EDF3]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          {statusMessage && (
            <span className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium text-[#10B981] whitespace-nowrap">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {statusMessage}
            </span>
          )}
          <button
            type="button"
            onClick={onSaveConfig}
            disabled={savingConfig}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              configDirty
                ? 'border-[#F59E0B]/60 bg-[#F59E0B]/15 text-[#FBBF24] hover:bg-[#F59E0B]/25'
                : 'border-[#374151] bg-[#111827] text-slate-200 hover:bg-[#1F2937]'
            }`}
          >
            {savingConfig ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {configDirty ? 'Save Config*' : 'Save Config'}
          </button>
          <button
            type="button"
            onClick={onRunVerification}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#F59E0B] px-3.5 py-1.5 text-xs font-bold text-[#0B0F17] whitespace-nowrap shrink-0 hover:bg-[#FBBF24] transition-colors cursor-pointer"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Verify Suite
          </button>
        </div>
      </div>
    </header>
  );
}
