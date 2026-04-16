import { NextResponse } from "next/server";
import { getApp } from "@/lib/apps";
import { stopService, stopTimer, getServiceStatus, getTimerStatus } from "@/lib/system";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; serviceName: string }> }
) {
  const { id, serviceName } = await params;

  const app = getApp(id);
  if (!app) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  const svcConfig = app.services?.find((s) => s.name === serviceName);
  if (!svcConfig && serviceName !== app.serviceName) {
    return NextResponse.json(
      { error: `Service "${serviceName}" is not registered for app "${id}"` },
      { status: 400 }
    );
  }

  const isTimer = (svcConfig as { type?: string } | undefined)?.type === "timer";

  // For timers: stop the .timer unit (disables scheduling).
  // For daemons: stop the .service unit.
  const ok = isTimer
    ? await stopTimer(serviceName)
    : await stopService(serviceName);

  if (!ok) {
    return NextResponse.json(
      { error: `Failed to stop ${serviceName}` },
      { status: 500 }
    );
  }

  await new Promise((r) => setTimeout(r, 1000));
  const status = isTimer
    ? await getTimerStatus(serviceName)
    : await getServiceStatus(serviceName);

  return NextResponse.json({ serviceName, status });
}
