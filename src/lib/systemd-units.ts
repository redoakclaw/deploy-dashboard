import { execFile } from "child_process";
import { readFileSync, readdirSync, copyFileSync, mkdirSync, statSync, unlinkSync, existsSync } from "fs";
import { homedir } from "os";
import path from "path";
import type {
  AppConfig,
  SystemdUnit,
  UnitDriftStatus,
  UnitInstallResult,
  UnitsResponse,
} from "@/types/app";

function userUnitsDir(): string {
  return path.join(homedir(), ".config", "systemd", "user");
}

function repoUnitsDir(app: AppConfig): string | null {
  if (!app.systemdUnitsDir) return null;
  return path.join(app.workspaceDir, app.systemdUnitsDir);
}

function getSystemEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!env.XDG_RUNTIME_DIR) {
    const uid = process.getuid?.();
    if (uid !== undefined) {
      env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
    }
  }
  return env;
}

function runCommand(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(command, args, { env: getSystemEnv() }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() || "",
        stderr: stderr?.toString() || "",
        exitCode: error
          ? (error as NodeJS.ErrnoException & { code?: number }).code || 1
          : 0,
      });
    });
  });
}

function longestCommonPrefix(names: string[]): string {
  if (names.length === 0) return "";
  let prefix = names[0];
  for (let i = 1; i < names.length; i++) {
    while (names[i].indexOf(prefix) !== 0) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return "";
    }
  }
  return prefix;
}

function isUnitFile(filename: string): boolean {
  return filename.endsWith(".service") || filename.endsWith(".timer");
}

function unitKind(filename: string): "service" | "timer" {
  return filename.endsWith(".timer") ? "timer" : "service";
}

function parseUnitType(contents: string): SystemdUnit["unitType"] {
  const m = contents.match(/^\s*Type\s*=\s*(\w+)/im);
  if (!m) return "unknown";
  const t = m[1].toLowerCase();
  if (t === "simple" || t === "oneshot" || t === "forking" || t === "notify") {
    return t;
  }
  return "unknown";
}

function computeDiff(installed: string, repo: string): string {
  const installedLines = installed.split("\n");
  const repoLines = repo.split("\n");
  const out: string[] = [];

  // Simple line-by-line unified-ish diff. Good enough for side-by-side display.
  // We deliberately avoid a full LCS diff to keep this dependency-free —
  // systemd unit files are small and typically have trivial differences.
  const max = Math.max(installedLines.length, repoLines.length);
  let inChunk = false;
  let chunkLines: string[] = [];
  const flush = () => {
    if (chunkLines.length) out.push(...chunkLines);
    chunkLines = [];
    inChunk = false;
  };
  for (let i = 0; i < max; i++) {
    const a = installedLines[i];
    const b = repoLines[i];
    if (a === b) {
      if (inChunk) {
        chunkLines.push(`  ${a}`);
        if (chunkLines.length > 3) flush();
      }
      continue;
    }
    inChunk = true;
    if (a !== undefined) chunkLines.push(`- ${a}`);
    if (b !== undefined) chunkLines.push(`+ ${b}`);
  }
  flush();
  return out.join("\n");
}

async function isServiceActive(name: string, kind: "service" | "timer"): Promise<boolean> {
  const unit = kind === "timer" ? `${name}` : `${name}`;
  const r = await runCommand("systemctl", ["--user", "is-active", unit]);
  return r.stdout.trim() === "active";
}

export async function getUnitsForApp(app: AppConfig): Promise<UnitsResponse> {
  const repoDir = repoUnitsDir(app);
  if (!repoDir) {
    return {
      units: [],
      supported: false,
      reason: "No systemdUnitsDir configured for this app",
    };
  }

  if (!existsSync(repoDir)) {
    return {
      units: [],
      supported: false,
      reason: `Repo units dir does not exist: ${repoDir}`,
    };
  }

  const installedDir = userUnitsDir();

  const repoFiles = readdirSync(repoDir).filter(isUnitFile);
  const installedAll = existsSync(installedDir)
    ? readdirSync(installedDir).filter(isUnitFile)
    : [];

  // Scope orphan detection: only consider installed files that share the
  // longest common prefix of the repo file set. Prevents false-positives
  // from other apps' units living in the same user systemd dir.
  const prefix = longestCommonPrefix(repoFiles);
  const installedScoped = prefix
    ? installedAll.filter((f) => f.startsWith(prefix))
    : [];

  const allNames = new Set<string>([...repoFiles, ...installedScoped]);

  const units: SystemdUnit[] = [];
  for (const name of allNames) {
    const repoPath = repoFiles.includes(name) ? path.join(repoDir, name) : null;
    const installedPath = installedScoped.includes(name)
      ? path.join(installedDir, name)
      : null;

    let driftStatus: UnitDriftStatus;
    let diff: string | null = null;
    let unitTypeStr: SystemdUnit["unitType"] = "unknown";
    const kind = unitKind(name);

    if (repoPath && installedPath) {
      const repoContents = readFileSync(repoPath, "utf-8");
      const installedContents = readFileSync(installedPath, "utf-8");
      unitTypeStr = kind === "timer" ? "timer" : parseUnitType(repoContents);
      if (repoContents === installedContents) {
        driftStatus = "in-sync";
      } else {
        driftStatus = "drifted";
        diff = computeDiff(installedContents, repoContents);
      }
    } else if (repoPath && !installedPath) {
      const repoContents = readFileSync(repoPath, "utf-8");
      unitTypeStr = kind === "timer" ? "timer" : parseUnitType(repoContents);
      driftStatus = "missing-installed";
    } else {
      // installed only
      if (installedPath) {
        const installedContents = readFileSync(installedPath, "utf-8");
        unitTypeStr =
          kind === "timer" ? "timer" : parseUnitType(installedContents);
      }
      driftStatus = "orphan-installed";
    }

    const baseName = name.replace(/\.(service|timer)$/, "");
    const isActive = await isServiceActive(name, kind);

    units.push({
      name: baseName,
      kind,
      driftStatus,
      repoPath,
      installedPath,
      diff,
      isActive,
      unitType: unitTypeStr,
    });
  }

  units.sort((a, b) => {
    const order: Record<UnitDriftStatus, number> = {
      drifted: 0,
      "missing-installed": 1,
      "orphan-installed": 2,
      "in-sync": 3,
    };
    const da = order[a.driftStatus];
    const db = order[b.driftStatus];
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });

  return { units, supported: true };
}

async function daemonReload(): Promise<{ ok: boolean; error?: string }> {
  const r = await runCommand("systemctl", ["--user", "daemon-reload"]);
  if (r.exitCode === 0) return { ok: true };
  return { ok: false, error: r.stderr.trim() || `exit ${r.exitCode}` };
}

// Validate that a unit name is a bare systemd unit filename (no path traversal,
// no shell meta, only the expected chars). Anything else is rejected outright.
function validateUnitFilename(name: string): boolean {
  return /^[A-Za-z0-9_.@-]+\.(service|timer)$/.test(name);
}

export async function installUnits(
  app: AppConfig,
  unitFilenames: string[]
): Promise<{ results: UnitInstallResult[]; daemonReloaded: boolean; daemonReloadError?: string }> {
  const repoDir = repoUnitsDir(app);
  const installedDir = userUnitsDir();
  const results: UnitInstallResult[] = [];

  if (!repoDir) {
    return {
      results: unitFilenames.map((n) => ({
        name: n,
        success: false,
        error: "App has no systemdUnitsDir",
      })),
      daemonReloaded: false,
    };
  }

  if (!existsSync(installedDir)) {
    mkdirSync(installedDir, { recursive: true });
  }

  for (const name of unitFilenames) {
    if (!validateUnitFilename(name)) {
      results.push({ name, success: false, error: "Invalid unit filename" });
      continue;
    }
    const src = path.join(repoDir, name);
    const dest = path.join(installedDir, name);
    try {
      if (!existsSync(src)) {
        results.push({ name, success: false, error: "Source does not exist in repo" });
        continue;
      }
      // Resolve and verify src is still inside repoDir after realpath.
      const realSrc = path.resolve(src);
      if (!realSrc.startsWith(path.resolve(repoDir) + path.sep)) {
        results.push({ name, success: false, error: "Source escapes repo dir" });
        continue;
      }
      copyFileSync(src, dest);
      results.push({ name, success: true });
    } catch (e) {
      results.push({
        name,
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const anySuccess = results.some((r) => r.success);
  if (!anySuccess) {
    return { results, daemonReloaded: false };
  }

  const reload = await daemonReload();
  return {
    results,
    daemonReloaded: reload.ok,
    daemonReloadError: reload.error,
  };
}

export async function removeOrphanUnit(
  app: AppConfig,
  unitFilename: string
): Promise<{ success: boolean; error?: string; daemonReloaded?: boolean; daemonReloadError?: string }> {
  if (!validateUnitFilename(unitFilename)) {
    return { success: false, error: "Invalid unit filename" };
  }
  const repoDir = repoUnitsDir(app);
  if (!repoDir) {
    return { success: false, error: "App has no systemdUnitsDir" };
  }

  // Verify this is actually an orphan — not in repo, present in installed.
  const repoPath = path.join(repoDir, unitFilename);
  if (existsSync(repoPath)) {
    return {
      success: false,
      error: "Unit exists in repo; use deploy instead of remove",
    };
  }

  const installedPath = path.join(userUnitsDir(), unitFilename);
  if (!existsSync(installedPath)) {
    return { success: false, error: "Unit not installed" };
  }

  // Also scope: only remove units whose prefix matches the app's repo prefix,
  // to prevent a crafted request from deleting some unrelated user unit.
  const repoFiles = existsSync(repoDir)
    ? readdirSync(repoDir).filter(isUnitFile)
    : [];
  const prefix = longestCommonPrefix(repoFiles);
  if (!prefix || !unitFilename.startsWith(prefix)) {
    return {
      success: false,
      error: `Refusing to remove unit outside app prefix "${prefix}"`,
    };
  }

  // Make sure it's not currently active — stopping a live unit via the dash
  // is a separate operation with its own button.
  const kind = unitKind(unitFilename);
  if (await isServiceActive(unitFilename, kind)) {
    return {
      success: false,
      error: "Unit is active; stop it before removing",
    };
  }

  try {
    // Extra safety: require that the file is a regular file (not a symlink
    // pointing somewhere dangerous).
    const s = statSync(installedPath);
    if (!s.isFile()) {
      return { success: false, error: "Installed path is not a regular file" };
    }
    unlinkSync(installedPath);
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const reload = await daemonReload();
  return {
    success: true,
    daemonReloaded: reload.ok,
    daemonReloadError: reload.error,
  };
}
