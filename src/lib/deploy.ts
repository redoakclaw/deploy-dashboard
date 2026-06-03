import { spawn, execFileSync } from "child_process";
import { createWriteStream, readFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import type { AppConfig } from "@/types/app";
import {
  loadApps,
  setDeploying,
  setDeployComplete,
  readDeployStatus,
} from "./apps";

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

/**
 * Work out the URL to clone a brand-new app from. The host authenticates to
 * GitHub per-remote (there's no global credential helper for github.com — a
 * bare `https://github.com/...` clone prompts for a username and fails in this
 * non-interactive context). So instead of inventing a URL, we reuse the auth
 * scheme that already works on this host: read the `origin` URL from an
 * existing sibling workspace and swap its repo path for ours. This carries
 * over whatever the host uses (token-in-URL, SSH, etc.) without us ever
 * needing to know the secret. Falls back to plain HTTPS (fine for a public
 * repo, or a host that does have a credential helper) if no sibling exists.
 */
function deriveCloneUrl(
  app: AppConfig,
  env: NodeJS.ProcessEnv
): { url: string; basis: string } {
  for (const sibling of loadApps()) {
    if (sibling.id === app.id) continue;
    if (!existsSync(path.join(sibling.workspaceDir, ".git"))) continue;
    try {
      const originUrl = execFileSync(
        "git",
        ["remote", "get-url", "origin"],
        { cwd: sibling.workspaceDir, encoding: "utf-8", timeout: 10000, env }
      ).trim();
      // The sibling's repo slug (owner/name) appears verbatim in both SSH
      // (git@host:owner/name.git) and HTTPS (scheme://[auth@]host/owner/name)
      // forms, so a literal swap preserves scheme, host, auth, and suffix.
      if (originUrl && originUrl.includes(sibling.repo)) {
        return {
          url: originUrl.replace(sibling.repo, app.repo),
          basis: `derived from sibling workspace ${sibling.id}`,
        };
      }
    } catch {
      // Sibling's origin unreadable — try the next one.
    }
  }
  return { url: `https://github.com/${app.repo}.git`, basis: "default github.com HTTPS" };
}

/**
 * Bootstrap-clone the app's repo into its workspace dir when no checkout
 * exists yet. This is the first-deploy path for a freshly registered app:
 * the workspace has never been cloned, so there's nothing for `git fetch`
 * (or the deploy script's `git reset --hard`) to run against. Without this,
 * `git fetch` runs with a non-existent cwd and fails with the misleading
 * "spawnSync git ENOENT" (Node reports ENOENT against the command, not the
 * missing directory).
 */
function ensureWorkspaceClone(
  app: AppConfig,
  env: NodeJS.ProcessEnv,
  writeLog: (data: string) => void
): { ok: boolean; error?: string } {
  // A real checkout has a .git entry. If it's there, nothing to do.
  if (existsSync(path.join(app.workspaceDir, ".git"))) {
    return { ok: true };
  }

  const { url: cloneUrl, basis } = deriveCloneUrl(app, env);
  writeLog(
    `[${new Date().toISOString()}] No checkout at ${app.workspaceDir} — cloning ${app.repo} (branch ${app.branch}, ${basis})...\n`
  );

  // git clone creates the leaf dir but not missing parents.
  try {
    mkdirSync(path.dirname(app.workspaceDir), { recursive: true });
  } catch (err) {
    return { ok: false, error: `could not create workspace parent dir: ${err}` };
  }

  try {
    execFileSync(
      "git",
      ["clone", "--branch", app.branch, cloneUrl, app.workspaceDir],
      { encoding: "utf-8", timeout: 120000, env }
    );
  } catch (err) {
    // The error string echoes the full clone command, which may embed a
    // token in the URL. Redact the URL before it reaches the deploy log.
    const sanitized = String(err).split(cloneUrl).join(`<${app.repo}>`);
    return { ok: false, error: `git clone failed: ${sanitized}` };
  }

  return { ok: true };
}

/**
 * Ensure the deploy script exists on disk before we try to run it.
 * This handles the chicken-and-egg case where the deploy script was
 * just added or updated in the remote but hasn't been pulled yet.
 * We fetch from origin and checkout just the deploy script file from
 * the target branch, leaving everything else for the script itself
 * to handle via git reset --hard.
 */
function ensureDeployScript(
  app: AppConfig,
  writeLog: (data: string) => void
): { ok: boolean; error?: string } {
  const env = { ...process.env };
  if (!env.XDG_RUNTIME_DIR) {
    const uid = process.getuid?.();
    if (uid !== undefined) {
      env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
    }
  }

  // First-deploy bootstrap: clone the repo if the workspace is empty.
  const cloneResult = ensureWorkspaceClone(app, env, writeLog);
  if (!cloneResult.ok) {
    return cloneResult;
  }

  try {
    execFileSync("git", ["fetch", "origin", app.branch], {
      cwd: app.workspaceDir,
      encoding: "utf-8",
      timeout: 30000,
      env,
    });
  } catch (err) {
    return { ok: false, error: `git fetch failed: ${err}` };
  }

  try {
    execFileSync(
      "git",
      ["checkout", `origin/${app.branch}`, "--", app.deployScript],
      {
        cwd: app.workspaceDir,
        encoding: "utf-8",
        timeout: 10000,
        env,
      }
    );
  } catch (err) {
    return {
      ok: false,
      error: `git checkout of ${app.deployScript} failed: ${err}`,
    };
  }

  // Ensure it's executable
  try {
    execFileSync("chmod", ["+x", app.deployScript], {
      cwd: app.workspaceDir,
      timeout: 5000,
    });
  } catch {
    // Non-fatal — the script may already be executable
  }

  return { ok: true };
}

export function startDeploy(
  app: AppConfig,
  opts: { force?: boolean } = {}
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

  // Ensure the deploy script is on disk (fetch + checkout from remote)
  writeLog(`[${new Date().toISOString()}] Fetching deploy script from origin/${app.branch}...\n`);
  const ensureResult = ensureDeployScript(app, writeLog);
  if (!ensureResult.ok) {
    writeLog(`[${new Date().toISOString()}] ${ensureResult.error}\n`);
    writeLog(`\n---\n[${new Date().toISOString()}] Deploy failed (could not fetch deploy script)\n`);
    logStream.end();
    setDeployComplete(app.id, "failed");
    return { error: ensureResult.error! };
  }
  writeLog(`[${new Date().toISOString()}] Deploy script ready.\n`);
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

  // When the operator clicked Deploy anyway from the preflight modal,
  // signal that intent to the app's deploy script via FORCE_RESET=1.
  // Apps that care (e.g. scripts/deploy.sh with a local-changes guard)
  // use this; apps that don't just ignore the extra env var.
  if (opts.force) {
    env.FORCE_RESET = "1";
    writeLog(
      `[${new Date().toISOString()}] Deploy flagged FORCE_RESET=1 by operator\n`
    );
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
