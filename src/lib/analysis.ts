import { spawn } from "child_process";
import path from "path";
import { existsSync } from "fs";
import type {
  AppConfig,
  AnalysisArgSpec,
  AnalysisScriptConfig,
  AnalysisRunResult,
} from "@/types/app";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 2_000_000; // 2 MB hard cap per stream

// Each arg type has a validator that returns the safe string (or
// null to omit the flag entirely, e.g. an unset toggle). Validation
// is per-character/regex — these values get passed to spawn() as
// array elements so there is no shell-quoting risk, but we still
// reject anything that doesn't match the declared type so a typo
// can't sneak --rm or a path traversal into the args list.
const VALIDATORS: Record<
  AnalysisArgSpec["type"],
  (raw: unknown) => { value?: string; omit?: boolean; error?: string }
> = {
  toggle: (raw) => {
    if (raw === true || raw === "true") return { omit: false, value: "" };
    return { omit: true };
  },
  date: (raw) => {
    if (raw == null || raw === "") return { omit: true };
    const s = String(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return { error: `expected YYYY-MM-DD, got "${s}"` };
    }
    return { value: s };
  },
  number: (raw) => {
    if (raw == null || raw === "") return { omit: true };
    const s = String(raw);
    if (!/^-?\d+$/.test(s)) {
      return { error: `expected integer, got "${s}"` };
    }
    return { value: s };
  },
  text: (raw) => {
    if (raw == null || raw === "") return { omit: true };
    const s = String(raw);
    // Conservative: letters, digits, dash, underscore, dot, slash, colon.
    // Covers paths and most identifier-like values. No spaces, no shell
    // metachars, no semicolons. spawn() with array form would still be
    // safe but we want a tight schema for the API contract too.
    if (!/^[A-Za-z0-9_\-./:]+$/.test(s)) {
      return { error: `text contains disallowed characters: "${s}"` };
    }
    if (s.length > 200) return { error: "text exceeds 200 chars" };
    return { value: s };
  },
};

export function getAnalysisScript(
  app: AppConfig,
  scriptId: string
): AnalysisScriptConfig | undefined {
  return app.analysisScripts?.find((s) => s.id === scriptId);
}

export function buildArgList(
  spec: AnalysisScriptConfig,
  userArgs: Record<string, unknown>
): { args: string[]; error?: string } {
  const args: string[] = [];
  for (const argSpec of spec.args ?? []) {
    if (!(argSpec.name in userArgs) && argSpec.default !== undefined) {
      userArgs[argSpec.name] = argSpec.default;
    }
    const raw = userArgs[argSpec.name];
    const v = VALIDATORS[argSpec.type](raw);
    if (v.error) {
      return { args: [], error: `${argSpec.name}: ${v.error}` };
    }
    if (v.omit) continue;
    args.push(argSpec.flag);
    if (argSpec.type !== "toggle") {
      args.push(v.value!);
    }
  }
  return { args };
}

export async function runAnalysisScript(
  app: AppConfig,
  scriptId: string,
  userArgs: Record<string, unknown>
): Promise<AnalysisRunResult | { error: string; status: number }> {
  const spec = getAnalysisScript(app, scriptId);
  if (!spec) {
    return { error: `Unknown analysis script: ${scriptId}`, status: 404 };
  }
  if (!existsSync(app.workspaceDir)) {
    return {
      error: `Workspace dir does not exist: ${app.workspaceDir}`,
      status: 500,
    };
  }

  const built = buildArgList(spec, userArgs);
  if (built.error) {
    return { error: built.error, status: 400 };
  }

  const [executable, ...baseArgs] = spec.command;
  const fullArgs = [...baseArgs, ...built.args];

  // For the UI: print a copy-pasteable command line that would
  // reproduce the run locally if someone wants to dig in further.
  const commandLine = [executable, ...fullArgs]
    .map((a) => (/[\s'"\\]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a))
    .join(" ");

  const start = Date.now();
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<AnalysisRunResult>((resolve) => {
    const child = spawn(executable, fullArgs, {
      cwd: app.workspaceDir,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let resolved = false;

    const truncate = (existing: string, chunk: string, bytes: number) => {
      const remaining = MAX_OUTPUT_BYTES - bytes;
      if (remaining <= 0) return { text: existing, bytes };
      if (chunk.length <= remaining) {
        return { text: existing + chunk, bytes: bytes + chunk.length };
      }
      return {
        text: existing + chunk.slice(0, remaining) + "\n…[output truncated]\n",
        bytes: MAX_OUTPUT_BYTES,
      };
    };

    child.stdout.on("data", (data) => {
      const chunk = data.toString("utf-8");
      const r = truncate(stdout, chunk, stdoutBytes);
      stdout = r.text;
      stdoutBytes = r.bytes;
    });
    child.stderr.on("data", (data) => {
      const chunk = data.toString("utf-8");
      const r = truncate(stderr, chunk, stderrBytes);
      stderr = r.text;
      stderrBytes = r.bytes;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (exitCode: number | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({
        scriptId,
        exitCode,
        durationMs: Date.now() - start,
        stdout,
        stderr,
        timedOut,
        commandLine,
      });
    };

    child.on("error", (err) => {
      stderr += `\n[spawn error] ${err.message}\n`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

// Used by the GET handler to surface the available scripts (and their
// arg schema) to the UI without exposing absolute paths.
export function publicAnalysisScripts(app: AppConfig): AnalysisScriptConfig[] {
  return (app.analysisScripts ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    description: s.description,
    // Hide the actual command argv from the API; UI doesn't need it
    // and it's nice to keep the impl detail server-side.
    command: [path.basename(s.command[s.command.length - 1] ?? "")],
    args: s.args,
    timeoutMs: s.timeoutMs,
  }));
}
