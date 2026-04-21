import { execFile } from "child_process";

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
    const mergedEnv = getSystemEnv() as NodeJS.ProcessEnv;

    execFile(command, args, { env: mergedEnv }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() || "",
        stderr: stderr?.toString() || "",
        exitCode: error ? (error as NodeJS.ErrnoException & { code?: number }).code || 1 : 0,
      });
    });
  });
}

export async function getServiceStatus(
  serviceName: string
): Promise<"active" | "inactive" | "failed" | "unknown"> {
  try {
    const result = await runCommand("systemctl", [
      "--user",
      "is-active",
      `${serviceName}.service`,
    ]);
    const status = result.stdout.trim();
    if (status === "active") return "active";
    if (status === "inactive") return "inactive";
    if (status === "failed") return "failed";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function getTimerStatus(
  timerName: string
): Promise<"active" | "inactive" | "failed" | "unknown"> {
  try {
    const result = await runCommand("systemctl", [
      "--user",
      "is-active",
      `${timerName}.timer`,
    ]);
    const status = result.stdout.trim();
    if (status === "active") return "active";
    if (status === "inactive") return "inactive";
    if (status === "failed") return "failed";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function getServiceRestartedAt(
  serviceName: string
): Promise<string | null> {
  try {
    const result = await runCommand("systemctl", [
      "--user",
      "show",
      "-p",
      "ActiveEnterTimestamp",
      `${serviceName}.service`,
    ]);
    const line = result.stdout.trim();
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) return null;
    const value = line.slice(eqIdx + 1).trim();
    if (!value) return null;
    const date = new Date(value);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch {
    return null;
  }
}

// For oneshot services invoked by a timer, ActiveEnterTimestamp on the .service
// is often empty because the unit never settles into "active" — it transitions
// activating → inactive too fast. The timer itself tracks LastTriggerUSec
// (last fire) and NextElapseUSecRealtime (next fire), which is what we want
// for the "Last ran" display and for sorting scheduled jobs by time-of-day.
export async function getTimerTimings(
  timerName: string
): Promise<{ lastRun: string | null; nextRun: string | null }> {
  try {
    const result = await runCommand("systemctl", [
      "--user",
      "show",
      "-p",
      "LastTriggerUSec",
      "-p",
      "NextElapseUSecRealtime",
      `${timerName}.timer`,
    ]);
    const out = { lastRun: null as string | null, nextRun: null as string | null };
    for (const raw of result.stdout.split("\n")) {
      const line = raw.trim();
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx);
      const value = line.slice(eqIdx + 1).trim();
      if (!value || value === "n/a" || value === "0") continue;
      const date = new Date(value);
      if (isNaN(date.getTime())) continue;
      if (key === "LastTriggerUSec") out.lastRun = date.toISOString();
      else if (key === "NextElapseUSecRealtime") out.nextRun = date.toISOString();
    }
    return out;
  } catch {
    return { lastRun: null, nextRun: null };
  }
}

export async function getServiceLogs(
  serviceName: string,
  lines: number = 50
): Promise<string[]> {
  try {
    const result = await runCommand("journalctl", [
      "--user",
      "-u",
      `${serviceName}.service`,
      "-n",
      String(lines),
      "--no-pager",
    ]);
    return result.stdout.split("\n").filter(Boolean);
  } catch {
    return ["Failed to read service logs"];
  }
}

export async function restartService(serviceName: string): Promise<boolean> {
  try {
    const result = await runCommand("systemctl", [
      "--user",
      "restart",
      `${serviceName}.service`,
    ]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function stopService(serviceName: string): Promise<boolean> {
  try {
    const result = await runCommand("systemctl", [
      "--user",
      "stop",
      `${serviceName}.service`,
    ]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function startService(serviceName: string): Promise<boolean> {
  try {
    const result = await runCommand("systemctl", [
      "--user",
      "start",
      `${serviceName}.service`,
    ]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function stopTimer(timerName: string): Promise<boolean> {
  try {
    const result = await runCommand("systemctl", [
      "--user",
      "stop",
      `${timerName}.timer`,
    ]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function startTimer(timerName: string): Promise<boolean> {
  try {
    const result = await runCommand("systemctl", [
      "--user",
      "start",
      `${timerName}.timer`,
    ]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
