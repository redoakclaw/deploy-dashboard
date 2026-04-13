import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import type { AppConfig, DeployStatusFile, DeployHistoryEntry } from "@/types/app";

const DATA_DIR = path.join(process.cwd(), "data");
const APPS_FILE = path.join(DATA_DIR, "apps.json");

export function loadApps(): AppConfig[] {
  const raw = readFileSync(APPS_FILE, "utf-8");
  const data = JSON.parse(raw);
  return data.apps;
}

export function getApp(id: string): AppConfig | undefined {
  const apps = loadApps();
  return apps.find((a) => a.id === id);
}

function statusFilePath(appId: string): string {
  return path.join(DATA_DIR, `.deploy-status-${appId}.json`);
}

const DEFAULT_STATUS: DeployStatusFile = {
  status: "idle",
  deployId: null,
  startedAt: null,
  logFile: null,
  history: [],
};

export function readDeployStatus(appId: string): DeployStatusFile {
  const filePath = statusFilePath(appId);
  if (!existsSync(filePath)) {
    return { ...DEFAULT_STATUS, history: [] };
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { ...DEFAULT_STATUS, history: [] };
  }
}

export function writeDeployStatus(appId: string, status: DeployStatusFile): void {
  const filePath = statusFilePath(appId);
  writeFileSync(filePath, JSON.stringify(status, null, 2));
}

export function setDeploying(
  appId: string,
  deployId: string,
  logFile: string
): void {
  const current = readDeployStatus(appId);
  current.status = "deploying";
  current.deployId = deployId;
  current.startedAt = new Date().toISOString();
  current.logFile = logFile;
  writeDeployStatus(appId, current);
}

export function setDeployComplete(
  appId: string,
  result: "success" | "failed",
  commitInfo?: { hash: string; message: string }
): void {
  const current = readDeployStatus(appId);
  const startedAt = current.startedAt
    ? new Date(current.startedAt).getTime()
    : Date.now();
  const duration = Date.now() - startedAt;

  const entry: DeployHistoryEntry = {
    deployId: current.deployId || `${appId}-${Date.now()}`,
    timestamp: current.startedAt || new Date().toISOString(),
    result,
    duration,
    logFile: current.logFile || "",
    commitHash: commitInfo?.hash,
    commitMessage: commitInfo?.message,
  };

  // Keep last 10 entries
  current.history = [entry, ...current.history].slice(0, 10);
  current.status = "idle";
  current.deployId = null;
  current.startedAt = null;
  current.logFile = null;
  writeDeployStatus(appId, current);
}

export function getLastDeploy(appId: string): DeployHistoryEntry | null {
  const status = readDeployStatus(appId);
  return status.history[0] || null;
}
