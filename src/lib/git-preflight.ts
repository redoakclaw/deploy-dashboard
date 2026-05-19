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

// "Previously tracked" = paths that were added to the tree at some point
// in history (any branch) AND are currently gitignored-and-present on disk.
// The intersection is the state produced by `git rm --cached <path>`
// (or equivalent) followed by the file being covered by a gitignore rule.
// We intentionally exclude:
//   - files currently tracked (git ls-files --others leaves those out)
//   - files that merely happen to match an ignore rule without ever having
//     been committed (e.g. __pycache__/*.pyc that were never added)
// so the UI only surfaces the "expected after un-track commit" state, not
// arbitrary gitignored cruft.
async function getPreviouslyTrackedFiles(cwd: string): Promise<string[]> {
  const addedRes = await runGit(cwd, [
    "log",
    "--all",
    "--diff-filter=A",
    "--name-only",
    "--pretty=format:",
  ]);
  if (addedRes.exitCode !== 0) return [];
  const everAdded = new Set<string>();
  for (const raw of addedRes.stdout.split("\n")) {
    const path = raw.trim();
    if (path) everAdded.add(path);
  }
  if (everAdded.size === 0) return [];

  const ignoredRes = await runGit(cwd, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
  ]);
  if (ignoredRes.exitCode !== 0) return [];

  const result: string[] = [];
  for (const raw of ignoredRes.stdout.split("\n")) {
    const path = raw.trim();
    if (!path) continue;
    if (everAdded.has(path)) {
      result.push(path);
      if (result.length >= 50) break;
    }
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

// Cap on per-file diff size we send to the UI. Most real diffs are tiny;
// a generated file or vendor blob can be huge. 8KB lets us show a config
// flip or small code change in full, while keeping the JSON response
// reasonable.
const MAX_DIFF_BYTES = 8000;

function truncateDiff(s: string): string {
  if (s.length <= MAX_DIFF_BYTES) return s;
  return (
    s.slice(0, MAX_DIFF_BYTES) +
    `\n\n... (truncated; ${s.length - MAX_DIFF_BYTES} more chars not shown)`
  );
}

// Enrich a dirty tracked file with two extra signals for the UI:
//   diffVsHead         - what the user changed locally (vs local HEAD)
//   redundantWithRemote - working-tree content equals origin/<branch>'s
//                         content, so the local "modification" is purely
//                         the gap between local HEAD and origin/<branch>
//                         that the fast-forward will close
// Both are read-only git operations.
async function enrichDirtyFile(
  cwd: string,
  remoteRef: string,
  file: DirtyFile
): Promise<DirtyFile> {
  // Capture the user-visible patch. Works for M / A / D / R; for D the
  // diff shows the deleted content, which is exactly what the user wants
  // to see before force-discarding it.
  const diffRes = await runGit(cwd, [
    "diff",
    "HEAD",
    "--",
    file.path,
  ]);
  const diffVsHead =
    diffRes.exitCode === 0 && diffRes.stdout
      ? truncateDiff(diffRes.stdout)
      : undefined;

  // Redundancy check only meaningful for plain "modified" status — the
  // working tree has content AND origin should have the same path.
  // hash-object hashes the working-tree file; rev-parse gets the
  // origin/<branch> tree's hash for that path. Same hash → same bytes.
  let redundantWithRemote = false;
  const change = file.change.trim();
  if (change === "M") {
    const [wtRes, originRes] = await Promise.all([
      runGit(cwd, ["hash-object", file.path]),
      runGit(cwd, ["rev-parse", `${remoteRef}:${file.path}`]),
    ]);
    if (wtRes.exitCode === 0 && originRes.exitCode === 0) {
      const wtHash = wtRes.stdout.trim();
      const originHash = originRes.stdout.trim();
      if (wtHash && originHash && wtHash === originHash) {
        redundantWithRemote = true;
      }
    }
  }

  return { ...file, diffVsHead, redundantWithRemote };
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
  const { tracked: rawTracked, untracked: untrackedFiles } =
    parsePorcelain(statusRaw.stdout);
  const aheadCommits = await parseAheadCommits(logRaw.stdout);
  const previouslyTrackedFiles = await getPreviouslyTrackedFiles(cwd);

  // Enrich up to 50 dirty tracked files with their local diff + a
  // "matches origin" flag. Runs in parallel; each file does at most 3
  // git invocations (diff + hash-object + rev-parse), all read-only.
  const dirtyTrackedFiles = await Promise.all(
    rawTracked.slice(0, 50).map((f) => enrichDirtyFile(cwd, remoteRef, f))
  );

  const workspace: WorkspaceState = {
    branch: app.branch,
    head: head || null,
    remoteHead: remoteHead || null,
    ahead,
    behind,
    dirtyTrackedFiles,
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
