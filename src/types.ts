export type JobId = 'mage' | 'swordsman' | 'archer' | 'acolyte';
export type TabId = 'expedition' | 'tactical' | 'planner' | 'diagnostics';

export interface RunConfig {
  mode: 'guest' | 'account';
  username: string;
  job: JobId;
  stage: string;
  lobby: string;
  objectives: string[];
  runs: number;
  maxSeconds: number;
  maxLoot: boolean;
  ladder: boolean;
  out: string;
  charName: string;
}

export interface PresetEntry {
  name: string;
  config: RunConfig;
  updatedAt: number;
}

export interface FarmAccount {
  username: string;
  hasPassword: boolean;
  job: JobId;
  charName: string;
  stage: string;
  lobby: string;
  runs: number;
  maxSeconds: number;
  maxLoot: boolean;
  ladder: boolean;
  addedAt: number;
}

export type BuildsMap = Record<JobId, { cards: string[]; items: string[] }>;

export interface JobDef {
  hp: number;
  speed: number;
  start: string;
  basic: string;
  basicRange: number;
  basicDps: number;
  ranged: boolean;
}

export interface SkillPlanEntry {
  id: string;
  job: JobId;
  dps: number;
  aoe: number;
  role: string;
  phase: string;
  prio: number;
  note: string;
}

export interface StageInfo {
  id: string;
  label: string;
  durationS: number;
  finalBoss: string;
}

export interface BenchmarkRow {
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
}

export interface BundleStatus {
  manifest: {
    ok?: boolean;
    name?: string;
    srcSha?: string;
    patchedSha?: string;
    anchors?: Record<string, string>;
    at?: number;
  };
  files: {
    source: {
      relativePath: string | null;
      exists: boolean;
      sizeBytes: number;
      sha256: string | null;
      matchesManifest: boolean;
    };
    patched: {
      relativePath: string | null;
      exists: boolean;
      sizeBytes: number;
      sha256: string | null;
      matchesManifest: boolean;
    };
  };
  botEntryExists: boolean;
}

export interface WorkspacePayload {
  config: RunConfig;
  presets: PresetEntry[];
  accounts: FarmAccount[];
  builds: BuildsMap;
  bundle: BundleStatus;
  benchmarks: BenchmarkRow[];
  jobDefs: Record<JobId, JobDef>;
  skillPlan: SkillPlanEntry[];
  stages: StageInfo[];
  lobbies: string[];
}

export interface ScoredCardResult {
  index: number;
  title: string;
  pickType: 'skill' | 'item';
  score: number;
  hits: string[];
  plan: string | null;
  isNew: boolean;
}

export interface TestCheckResult {
  label: string;
  command: string;
  ok: boolean;
  durationMs: number;
  output: string;
}
