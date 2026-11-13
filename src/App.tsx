import { useEffect, useState } from 'react';
import type {
  BuildsMap,
  FarmAccount,
  JobId,
  PresetEntry,
  RunConfig,
  TabId,
  WorkspacePayload,
} from './types';
import { TopBar } from './components/TopBar';
import { SidebarConfig } from './components/SidebarConfig';
import { ExpeditionView } from './components/ExpeditionView';
import { TacticalLabView } from './components/TacticalLabView';
import { BuildPlannerView } from './components/BuildPlannerView';
import { DiagnosticsView } from './components/DiagnosticsView';

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [config, setConfig] = useState<RunConfig | null>(null);
  const [configDirty, setConfigDirty] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('expedition');
  const [verifyTrigger, setVerifyTrigger] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const flashStatus = (msg: string) => {
    setStatusMessage(msg);
    window.setTimeout(() => setStatusMessage(prev => (prev === msg ? null : prev)), 2600);
  };

  useEffect(() => {
    let alive = true;
    fetch('/api/workspace')
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<WorkspacePayload>;
      })
      .then(data => {
        if (!alive) return;
        setWorkspace(data);
        setConfig(data.config);
      })
      .catch(err => {
        if (!alive) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load workspace');
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleConfigChange = (next: RunConfig) => {
    setConfig(next);
    setConfigDirty(true);
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    setSavingConfig(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (res.ok && data.config) {
        setConfig(data.config);
        setConfigDirty(false);
        flashStatus('Config saved');
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSavePreset = async (name: string) => {
    if (!config) return;
    const res = await fetch('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, config }),
    });
    const data = await res.json();
    if (res.ok && workspace) {
      setWorkspace({ ...workspace, presets: data.presets });
      flashStatus(`Preset "${name}" saved`);
    }
  };

  const handleLoadPreset = (preset: PresetEntry) => {
    setConfig(preset.config);
    setConfigDirty(true);
    flashStatus(`Loaded "${preset.name}"`);
  };

  const handleDeletePreset = async (name: string) => {
    const res = await fetch(`/api/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && workspace) {
      setWorkspace({ ...workspace, presets: data.presets });
      flashStatus(`Deleted "${name}"`);
    }
  };

  const handleSaveAccount = async (payload: {
    username: string;
    password?: string;
    job: JobId;
    charName: string;
    stage: string;
    lobby: string;
    runs: number;
    maxSeconds: number;
  }) => {
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok && workspace) {
      setWorkspace({ ...workspace, accounts: data.accounts });
      flashStatus(`Saved slot "${payload.username}"`);
    }
  };

  const handleDeleteAccount = async (username: string) => {
    const res = await fetch(`/api/accounts/${encodeURIComponent(username)}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && workspace) {
      setWorkspace({ ...workspace, accounts: data.accounts });
      flashStatus(`Removed "${username}"`);
    }
  };

  const handleLoadAccountIntoConfig = (acct: FarmAccount) => {
    if (!config) return;
    setConfig({
      ...config,
      mode: 'account',
      username: acct.username,
      charName: acct.charName,
      job: acct.job,
      stage: acct.stage,
      lobby: acct.lobby,
      runs: acct.runs,
      maxSeconds: acct.maxSeconds,
      maxLoot: acct.maxLoot,
      ladder: acct.ladder,
    });
    setConfigDirty(true);
    flashStatus(`Loaded ${acct.username}`);
  };

  const handleSaveBuilds = async (next: BuildsMap) => {
    const res = await fetch('/api/builds', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    const data = await res.json();
    if (res.ok && workspace) {
      setWorkspace({ ...workspace, builds: data.builds });
      flashStatus('builds.json updated');
    }
  };

  const handleRefreshBundle = async () => {
    const res = await fetch('/api/bundle/verify');
    if (res.ok && workspace) {
      const bundle = await res.json();
      setWorkspace({ ...workspace, bundle });
      flashStatus('Bundle checksums verified');
    }
  };

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-[#EF4444]/40 bg-[#111827] p-5 text-sm text-[#E6EDF3]">
          <div className="font-display font-bold text-[#EF4444]">Workspace Connection Error</div>
          <p className="mt-1 text-slate-400">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!workspace || !config) {
    return (
      <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center p-6">
        <div className="font-mono text-xs text-slate-400">Loading RO Survivors workspace...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0F17] text-[#E6EDF3]">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        bundle={workspace.bundle}
        savingConfig={savingConfig}
        configDirty={configDirty}
        statusMessage={statusMessage}
        onSaveConfig={handleSaveConfig}
        onRunVerification={() => {
          setActiveTab('diagnostics');
          setVerifyTrigger(v => v + 1);
        }}
      />

      <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-5 py-6 lg:flex-row lg:items-start">
        <SidebarConfig
          config={config}
          jobDefs={workspace.jobDefs}
          stages={workspace.stages}
          lobbies={workspace.lobbies}
          presets={workspace.presets}
          onChange={handleConfigChange}
          onSavePreset={handleSavePreset}
          onLoadPreset={handleLoadPreset}
          onDeletePreset={handleDeletePreset}
        />

        <div className="min-w-0 flex-1">
          {activeTab === 'expedition' && (
            <ExpeditionView
              config={config}
              bundle={workspace.bundle}
              accounts={workspace.accounts}
              benchmarks={workspace.benchmarks}
              jobDefs={workspace.jobDefs}
              stages={workspace.stages}
              lobbies={workspace.lobbies}
              onLoadAccountIntoConfig={handleLoadAccountIntoConfig}
              onSaveAccount={handleSaveAccount}
              onDeleteAccount={handleDeleteAccount}
            />
          )}

          {activeTab === 'tactical' && <TacticalLabView />}

          {activeTab === 'planner' && (
            <BuildPlannerView
              builds={workspace.builds}
              skillPlan={workspace.skillPlan}
              onSaveBuilds={handleSaveBuilds}
            />
          )}

          {activeTab === 'diagnostics' && (
            <DiagnosticsView
              bundle={workspace.bundle}
              onRefreshBundle={handleRefreshBundle}
              externalTestTrigger={verifyTrigger}
            />
          )}
        </div>
      </main>
    </div>
  );
}
