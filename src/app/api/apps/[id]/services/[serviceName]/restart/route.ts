import { NextResponse } from "next/server";
import { getApp } from "@/lib/apps";
import { restartService, startService, getServiceStatus } from "@/lib/system";

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

  // For timers: "restart" means "run the oneshot service now".
  // For daemons: restart the long-running service.
  const ok = isTimer
    ? await startService(serviceName)
    : await restartService(serviceName);

  if (!ok) {
    return NextResponse.json(
      { error: `Failed to ${isTimer ? "trigger" : "restart"} ${serviceName}` },
      { status: 500 }
    );
  }

  await new Promise((r) => setTimeout(r, 1500));
  const status = await getServiceStatus(serviceName);

  return NextResponse.json({
    serviceName,
    status,
    restartedAt: new Date().toISOString(),
  });
}
