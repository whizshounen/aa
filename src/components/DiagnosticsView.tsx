import { useEffect, useState } from 'react';
import { CheckCircle2, Play, RefreshCw, XCircle } from 'lucide-react';
import type { BundleStatus, TestCheckResult } from '../types';

interface DiagnosticsViewProps {
  bundle: BundleStatus;
  onRefreshBundle: () => Promise<void>;
  externalTestTrigger?: number;
}

const ARCHITECTURAL_FIXES = [
  {
    module: 'bot/persistent-runner.js',
    status: 'FIXED',
    detail: 'Added missing crash-recovery runner cleanly relaunching crashed contexts with bounded consecutive-crash guard.',
  },
  {
    module: 'gui/instance-restart-policy.js',
    status: 'FIXED',
    detail: 'Extracted deterministic restart policy preventing auto-restarts on userStopped, stopping, wasStopping, or finished states.',
  },
  {
    module: 'gui/engine.js',
    status: 'FIXED',
    detail: 'Scoped multi-instance results, initialized batchStartedAt in cmdStartMulti, and preserved wasStopping before resetting stopping.',
  },
  {
    module: 'gui/ui.js & gui/index.html',
    status: 'FIXED',
    detail: 'Added Acolyte job detection/build tab and replaced unbounded 50ms frame polling with gated 180ms loading.',
  },
  {
    module: 'bot/build-planner.js & bot/steer-policy.js',
    status: 'REFACTORED',
    detail: 'Decoupled pure build scoring and tactical steering policies from bot6.2.js with full unit test coverage.',
  },
  {
    module: 'bot/bot6.2.js',
    status: 'FIXED',
    detail: 'Replaced hardcoded patchedBundle summary string with dynamic PATCHED manifest path resolution.',
  },
];

export function DiagnosticsView({ bundle, onRefreshBundle, externalTestTrigger }: DiagnosticsViewProps) {
  const [runningTests, setRunningTests] = useState(false);
  const [results, setResults] = useState<TestCheckResult[] | null>(null);
  const [suitePassed, setSuitePassed] = useState<boolean | null>(null);

  const runAllChecks = async () => {
    setRunningTests(true);
    try {
      const res = await fetch('/api/tests/run', { method: 'POST' });
      const data = await res.json();
      setResults(data.checks || []);
      setSuitePassed(Boolean(data.ok));
    } finally {
      setRunningTests(false);
    }
  };

  useEffect(() => {
    if (externalTestTrigger && externalTestTrigger > 0) {
      void runAllChecks();
    }
  }, [externalTestTrigger]);

  const anchors = Object.entries(bundle.manifest?.anchors || {});

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] pb-3">
          <div>
            <h2 className="font-display text-sm font-bold text-[#E6EDF3]">
              REA Bundle Manifest & Live SHA-256 Audit
            </h2>
            <p className="text-xs text-slate-400">
              Reads <code className="font-mono text-slate-300">rea/patched/bundle.json</code> and hashes <code className="font-mono text-slate-300">build/</code> vs <code className="font-mono text-slate-300">rea/patched/</code> live.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onRefreshBundle()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#374151] bg-[#0B0F17] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-[#F59E0B] cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Re-Verify Hashes
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-md border border-[#1F2937] bg-[#0B0F17] p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">Source Game Bundle</span>
              <span className={bundle.files.source.matchesManifest ? 'font-mono font-bold text-[#10B981]' : 'font-mono font-bold text-[#EF4444]'}>
                {bundle.files.source.matchesManifest ? 'SHA-256 MATCH' : 'MISMATCH'}
              </span>
            </div>
            <div className="font-mono text-xs text-slate-400">{bundle.files.source.relativePath || '—'}</div>
            <div className="font-mono text-[11px] text-slate-500 break-all">
              {bundle.files.source.sha256 || 'File missing'}
            </div>
          </div>

          <div className="rounded-md border border-[#1F2937] bg-[#0B0F17] p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">Patched Read-Only Bundle</span>
              <span className={bundle.files.patched.matchesManifest ? 'font-mono font-bold text-[#10B981]' : 'font-mono font-bold text-[#EF4444]'}>
                {bundle.files.patched.matchesManifest ? 'SHA-256 MATCH' : 'MISMATCH'}
              </span>
            </div>
            <div className="font-mono text-xs text-slate-400">{bundle.files.patched.relativePath || '—'}</div>
            <div className="font-mono text-[11px] text-slate-500 break-all">
              {bundle.files.patched.sha256 || 'File missing'}
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-400 mb-2">Discovered Minified Anchors</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
            {anchors.map(([k, v]) => (
              <div key={k} className="rounded border border-[#1F2937] bg-[#0B0F17] px-2.5 py-2">
                <div className="text-[11px] text-slate-400">{k}</div>
                <div className="font-mono text-xs font-bold text-[#F59E0B]">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] pb-3">
          <div>
            <h2 className="font-display text-sm font-bold text-[#E6EDF3]">
              Live Verification Suite Runner
            </h2>
            <p className="text-xs text-slate-400">
              Executes real <code className="font-mono text-slate-300">node --check</code>, <code className="font-mono text-slate-300">node --test</code>, <code className="font-mono text-slate-300">python3 rea/patch_test.py</code>, and TypeScript parity tests on the backend.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runAllChecks()}
            disabled={runningTests}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#F59E0B] px-3.5 py-1.5 text-xs font-bold text-[#0B0F17] hover:bg-[#FBBF24] whitespace-nowrap cursor-pointer"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            {runningTests ? 'Running Suite...' : 'Run All Checks'}
          </button>
        </div>

        {suitePassed != null && (
          <div className={`rounded-md border px-3 py-2 text-xs font-semibold ${
            suitePassed
              ? 'border-[#10B981]/50 bg-[#10B981]/10 text-[#10B981]'
              : 'border-[#EF4444]/50 bg-[#EF4444]/10 text-[#EF4444]'
          }`}>
            {suitePassed ? 'All verification checks passed with exit code 0.' : 'One or more verification checks failed — inspect command logs below.'}
          </div>
        )}

        {results && (
          <div className="space-y-3">
            {results.map(r => (
              <details
                key={r.label}
                open={!r.ok}
                className="rounded-md border border-[#1F2937] bg-[#0B0F17] p-3"
              >
                <summary className="flex items-center justify-between gap-2 text-xs cursor-pointer list-none">
                  <div className="flex items-center gap-2 min-w-0">
                    {r.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-[#10B981] shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-[#EF4444] shrink-0" />
                    )}
                    <span className="font-semibold text-[#E6EDF3] truncate">{r.label}</span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-400 shrink-0 tabular-nums">
                    {r.durationMs} ms · {r.ok ? 'PASS' : 'FAIL'}
                  </div>
                </summary>
                <div className="mt-2.5 border-t border-[#1F2937] pt-2 space-y-1.5">
                  <div className="font-mono text-[11px] text-[#F59E0B]">{r.command}</div>
                  {r.output && (
                    <pre className="max-h-48 overflow-auto rounded bg-[#070A10] p-2 font-mono text-[11px] text-slate-300">
                      {r.output}
                    </pre>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-3">
        <h2 className="font-display text-sm font-bold text-[#E6EDF3] border-b border-[#1F2937] pb-2.5">
          Codebase Decoupling & Repair Changelog
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#1F2937] text-slate-400">
                <th className="py-2 pr-3 font-medium">Module</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F2937]/70">
              {ARCHITECTURAL_FIXES.map(item => (
                <tr key={item.module}>
                  <td className="py-2 pr-3 font-mono text-[#E6EDF3] whitespace-nowrap">{item.module}</td>
                  <td className="py-2 pr-3 font-mono font-semibold text-[#10B981]">{item.status}</td>
                  <td className="py-2 text-slate-400">{item.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
