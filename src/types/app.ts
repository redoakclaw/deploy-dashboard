export interface ServiceConfig {
  name: string;
  label: string;
  description: string;
  type?: "service" | "timer";
}

export interface AppConfig {
  id: string;
  name: string;
  repo: string;
  branch: string;
  workspaceDir: string;
  deployScript: string;
  serviceName: string;
  port: number;
  description: string;
  services?: ServiceConfig[];
  systemdUnitsDir?: string;
  healthUrl?: string;
}

export interface DeployHistoryEntry {
  deployId: string;
  timestamp: string;
  result: "success" | "failed" | "running";
  duration: number | null;
  logFile: string;
  commitHash?: string;
  commitMessage?: string;
}

export interface DeployStatusFile {
  status: "idle" | "deploying";
  deployId: string | null;
  startedAt: string | null;
  logFile: string | null;
  history: DeployHistoryEntry[];
}

export interface ServiceStatus {
  name: string;
  label: string;
  description: string;
  status: "active" | "inactive" | "failed" | "unknown";
  restartedAt: string | null;
  nextRunAt?: string | null;
  type: "service" | "timer";
}

export interface AppWithStatus extends AppConfig {
  serviceStatus: "active" | "inactive" | "failed" | "unknown";
  deployStatus: "idle" | "deploying";
  lastDeploy: DeployHistoryEntry | null;
}

export interface StatusResponse {
  serviceStatus: "active" | "inactive" | "failed" | "unknown";
  deployStatus: "idle" | "deploying";
  lastDeploy: DeployHistoryEntry | null;
}

export interface LogsResponse {
  lines: string[];
  type: "deploy" | "service";
}

export type UnitDriftStatus =
  | "in-sync"
  | "drifted"
  | "missing-installed"
  | "orphan-installed";

export interface SystemdUnit {
  name: string;
  kind: "service" | "timer";
  driftStatus: UnitDriftStatus;
  repoPath: string | null;
  installedPath: string | null;
  diff: string | null;
  isActive: boolean;
  unitType: "simple" | "oneshot" | "forking" | "notify" | "timer" | "unknown";
}

export interface UnitsResponse {
  units: SystemdUnit[];
  supported: boolean;
  reason?: string;
}

export interface UnitInstallResult {
  name: string;
  success: boolean;
  error?: string;
}

export interface UnitInstallResponse {
  results: UnitInstallResult[];
  daemonReloaded: boolean;
  daemonReloadError?: string;
}

// Matches the contract of the app's own /api/health endpoint, e.g. scrooge's
// dashboard/src/app/api/health/route.ts. `ok: null` is informational (e.g.
// RTH-gated checks outside market hours) and doesn't score either way.
export interface HealthCheck {
  label: string;
  ok: boolean | null;
  detail: string;
  ageSec?: number;
}

export interface HealthPayload {
  ok: boolean;
  pass: number;
  fail: number;
  ts: string;
  checks: HealthCheck[];
}

export interface HealthResponse {
  supported: boolean;
  reason?: string;
  fetchedAt: string;
  payload?: HealthPayload;
  httpStatus?: number;
  error?: string;
}

export interface DirtyFile {
  path: string;
  change: string; // porcelain status letter: M, A, D, R, ??, etc.
}

export interface AheadCommit {
  sha: string;
  subject: string;
}

export interface WorkspaceState {
  branch: string;
  head: string | null;
  remoteHead: string | null;
  ahead: number;
  behind: number;
  dirtyTrackedFiles: DirtyFile[];
  untrackedFiles: DirtyFile[];
  previouslyTrackedFiles: string[];
  aheadCommits: AheadCommit[];
  error?: string;
}

export interface DeployPreflight {
  supported: boolean;
  reason?: string;
  workspace?: WorkspaceState;
  // Convenience flags for the UI:
  // clean = no work needed, safe to deploy without prompting
  clean?: boolean;
  // needsConfirmation = dirty tracked files or ahead of remote — operator
  // should see a modal before the git reset happens.
  needsConfirmation?: boolean;
}
