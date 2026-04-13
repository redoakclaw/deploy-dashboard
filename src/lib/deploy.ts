import { spawn, execFileSync } from "child_process";
import { createWriteStream, readFileSync, existsSync } from "fs";
import path from "path";
import type { AppConfig } from "@/types/app";
import { setDeploying, setDeployComplete, readDeployStatus } from "./apps";

const MAX_CONCURRENT_DEPLOYS = 3;
const DEPLOY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Track running deploy PIDs in memory (survives within the process)
const runningDeploys = new Map<string, number>();

export function isDeploying(appId: string): boolean {
  // Check both in-memory tracking and status file
  if (runningDeploys.has(appId)) return true;
  const status = readDeployStatus(appId);
  return status.status === "deploying";
}

export function getRunningDeployCount(): number {
  return runningDeploys.size;
}

export function startDeploy(
  app: AppConfig
): { deployId: string; logFile: string } | { error: string } {
  // Check if already deploying
  if (isDeploying(app.id)) {
    return { error: "Deploy already in progress for this app" };
  }

  // Check concurrent deploy limit
  if (getRunningDeployCount() >= MAX_CONCURRENT_DEPLOYS) {
    return { error: "Maximum concurrent deploys reached" };
  }

  const timestamp = Date.now();
  const deployId = `${app.id}-${timestamp}`;
  const logFile = `/tmp/deploy-${app.id}-${timestamp}.log`;

  // Set status to deploying
  setDeploying(app.id, deployId, logFile);

  // Create log file stream
  const logStream = createWriteStream(logFile, { flags: "a" });
  const writeLog = (data: string) => {
    logStream.write(data);
  };

  writeLog(`[${new Date().toISOString()}] Starting deploy: ${deployId}\n`);
  writeLog(`[${new Date().toISOString()}] App: ${app.name}\n`);
  writeLog(`[${new Date().toISOString()}] Script: ${app.deployScript}\n`);
  writeLog(`---\n`);

  const deployScriptPath = path.join(app.workspaceDir, app.deployScript);

  // Build environment with proper PATH and XDG_RUNTIME_DIR
  const env = { ...process.env };
  if (!env.XDG_RUNTIME_DIR) {
    const uid = process.getuid?.();
    if (uid !== undefined) {
      env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
    }
  }

  // Spawn detached so the deploy survives if the dashboard restarts
  const child = spawn("bash", [deployScriptPath], {
    cwd: app.workspaceDir,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Track the PID
  if (child.pid) {
    runningDeploys.set(app.id, child.pid);
  }

  // Capture stdout
  child.stdout?.on("data", (data: Buffer) => {
    writeLog(data.toString());
  });

  // Capture stderr
  child.stderr?.on("data", (data: Buffer) => {
    writeLog(data.toString());
  });

  // Set timeout
  const timeout = setTimeout(() => {
    writeLog(
      `\n[${new Date().toISOString()}] Deploy timed out after 10 minutes. Killing process.\n`
    );
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      // Process may already be gone
    }
  }, DEPLOY_TIMEOUT_MS);

  // Handle completion
  child.on("close", (code) => {
    clearTimeout(timeout);
    runningDeploys.delete(app.id);
    const result = code === 0 ? "success" : "failed";

    // Read the current git HEAD from the app's workspace
    let commitInfo: { hash: string; message: string } | undefined;
    try {
      const gitLog = execFileSync("git", ["log", "-1", "--format=%H%n%s"], {
        cwd: app.workspaceDir,
        encoding: "utf-8",
        timeout: 5000,
      });
      const [hash, ...msgParts] = gitLog.trim().split("\n");
      if (hash) {
        commitInfo = { hash: hash.slice(0, 7), message: msgParts.join("\n") };
        writeLog(`[${new Date().toISOString()}] Commit: ${commitInfo.hash} - ${commitInfo.message}\n`);
      }
    } catch {
      // Not critical — skip if git isn't available or workspace doesn't exist
    }

    writeLog(
      `\n---\n[${new Date().toISOString()}] Deploy ${result} (exit code: ${code})\n`
    );
    logStream.end();
    setDeployComplete(app.id, result, commitInfo);
  });

  child.on("error", (err) => {
    clearTimeout(timeout);
    runningDeploys.delete(app.id);
    writeLog(
      `\n---\n[${new Date().toISOString()}] Deploy error: ${err.message}\n`
    );
    logStream.end();
    setDeployComplete(app.id, "failed");
  });

  // Unref so the parent process can exit independently
  child.unref();

  return { deployId, logFile };
}

export function readDeployLog(logFile: string, tailLines: number = 100): string[] {
  if (!logFile || !existsSync(logFile)) {
    return [];
  }
  try {
    const content = readFileSync(logFile, "utf-8");
    const lines = content.split("\n");
    return lines.slice(-tailLines);
  } catch {
    return ["Failed to read deploy log"];
  }
}
