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
