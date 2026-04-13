import { execFile } from "child_process";

function runCommand(
  command: string,
  args: string[],
  env?: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const mergedEnv = { ...process.env, ...env } as NodeJS.ProcessEnv;

    // Ensure XDG_RUNTIME_DIR is set for systemctl --user
    if (!mergedEnv.XDG_RUNTIME_DIR) {
      const uid = process.getuid?.();
      if (uid !== undefined) {
        mergedEnv.XDG_RUNTIME_DIR = `/run/user/${uid}`;
      }
    }

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
