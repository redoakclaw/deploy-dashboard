import { execFile } from "child_process";
import { existsSync } from "fs";
import type {
  AppConfig,
  DeployPreflight,
  WorkspaceState,
  DirtyFile,
  AheadCommit,
} from "@/types/app";

// Server-side git-preflight for the Deploy button. Runs read-only git
// commands against the app's workspace to surface any state that would
// be clobbered by the deploy script's git reset — before we even spawn
// that script. The output drives a confirmation modal in the UI.

const GIT_TIMEOUT_MS = 15000;

function getEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!env.XDG_RUNTIME_DIR) {
    const uid = process.getuid?.();
    if (uid !== undefined) {
      env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
    }
  }
  return env;
}

function runGit(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, env: getEnv(), timeout: GIT_TIMEOUT_MS },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() || "",
          stderr: stderr?.toString() || "",
          exitCode: error
            ? (error as NodeJS.ErrnoException & { code?: number }).code || 1
            : 0,
        });
      }
    );
  });
}

// Parse `git status --porcelain=v1` output. Each line is "XY PATH" where
// XY is a two-char status code. We split tracked (modified, staged, etc.)
// from untracked ("??") so the UI can surface them differently.
function parsePorcelain(stdout: string): {
  tracked: DirtyFile[];
  untracked: DirtyFile[];
} {
  const tracked: DirtyFile[] = [];
  const untracked: DirtyFile[] = [];
  for (const rawLine of stdout.split("\n")) {
    if (!rawLine) continue;
    const xy = rawLine.slice(0, 2);
    // Porcelain path begins at column 3. For rename "R" there's an arrow
    // "orig -> new" — we just show the new path.
    let path = rawLine.slice(3).trim();
    if (path.includes(" -> ")) path = path.split(" -> ")[1];
    const entry: DirtyFile = { path, change: xy.trim() };
    if (xy === "??") untracked.push(entry);
    else tracked.push(entry);
  }
  return { tracked, untracked };
}

// "Previously tracked" = paths that git history shows as deleted at some
// point, and which still exist on disk. After `git rm --cached <path>`
// the file remains on disk but is removed from the index; if subsequently
// gitignored it won't appear in `status` at all, so it won't show up in
// either tracked or untracked lists. Surfacing it as an info row lets the
// operator confirm "yes, that's expected runtime state" and rules it out
// as the next weird-mystery cause.
async function getPreviouslyTrackedFiles(cwd: string): Promise<string[]> {
  const r = await runGit(cwd, [
    "log",
    "--diff-filter=D",
    "--name-only",
    "--pretty=format:",
    "HEAD",
  ]);
  if (r.exitCode !== 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of r.stdout.split("\n")) {
    const path = raw.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    // Only surface ones that still exist on disk.
    if (existsSync(`${cwd}/${path}`)) {
      result.push(path);
    }
    if (result.length >= 50) break; // hard cap to keep response small
  }
  return result;
}

async function parseAheadCommits(stdout: string): Promise<AheadCommit[]> {
  const out: AheadCommit[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    const sha = line.slice(0, sp);
    const subject = line.slice(sp + 1);
    out.push({ sha, subject });
    if (out.length >= 20) break;
  }
  return out;
}

export async function getPreflight(app: AppConfig): Promise<DeployPreflight> {
  const cwd = app.workspaceDir;

  if (!existsSync(cwd)) {
    return {
      supported: false,
      reason: `Workspace does not exist: ${cwd}`,
    };
  }

  if (!existsSync(`${cwd}/.git`)) {
    return {
      supported: false,
      reason: `Workspace is not a git checkout: ${cwd}`,
    };
  }

  // Fetch so ahead/behind counts are against latest origin. Safe — fetch
  // only updates remote-tracking refs, no working-tree changes.
  const fetchRes = await runGit(cwd, ["fetch", "origin", app.branch]);

  const remoteRef = `origin/${app.branch}`;
  const head = (await runGit(cwd, ["rev-parse", "HEAD"])).stdout.trim();
  const remoteHead = (
    await runGit(cwd, ["rev-parse", remoteRef])
  ).stdout.trim();

  const [aheadCountRaw, behindCountRaw, statusRaw, logRaw] = await Promise.all([
    runGit(cwd, ["rev-list", "--count", `${remoteRef}..HEAD`]),
    runGit(cwd, ["rev-list", "--count", `HEAD..${remoteRef}`]),
    runGit(cwd, ["status", "--porcelain=v1"]),
    runGit(cwd, ["log", "--format=%h %s", `${remoteRef}..HEAD`]),
  ]);

  const ahead = parseInt(aheadCountRaw.stdout.trim(), 10) || 0;
  const behind = parseInt(behindCountRaw.stdout.trim(), 10) || 0;
  const { tracked: dirtyTrackedFiles, untracked: untrackedFiles } =
    parsePorcelain(statusRaw.stdout);
  const aheadCommits = await parseAheadCommits(logRaw.stdout);
  const previouslyTrackedFiles = await getPreviouslyTrackedFiles(cwd);

  const workspace: WorkspaceState = {
    head: head || null,
    remoteHead: remoteHead || null,
    ahead,
    behind,
    dirtyTrackedFiles: dirtyTrackedFiles.slice(0, 50),
    untrackedFiles: untrackedFiles.slice(0, 50),
    previouslyTrackedFiles,
    aheadCommits,
    error: fetchRes.exitCode !== 0 ? fetchRes.stderr.trim() : undefined,
  };

  const needsConfirmation = ahead > 0 || dirtyTrackedFiles.length > 0;
  return {
    supported: true,
    workspace,
    clean: !needsConfirmation,
    needsConfirmation,
  };
}
