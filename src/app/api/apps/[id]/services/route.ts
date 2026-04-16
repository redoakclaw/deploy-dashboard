import { NextResponse } from "next/server";
import { getApp } from "@/lib/apps";
import { getServiceStatus, getTimerStatus, getServiceRestartedAt } from "@/lib/system";
import type { ServiceStatus } from "@/types/app";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const app = getApp(id);
  if (!app) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  const serviceConfigs = app.services ?? [
    {
      name: app.serviceName,
      label: app.serviceName,
      description: "",
    },
  ];

  const services: ServiceStatus[] = await Promise.all(
    serviceConfigs.map(async (svc) => {
      const isTimer = (svc as { type?: string }).type === "timer";

      // For timers: status comes from the .timer unit (is it scheduled?),
      // last-run comes from the .service unit (when did it last fire?).
      // For daemons: both come from the .service unit.
      const [status, restartedAt] = await Promise.all([
        isTimer ? getTimerStatus(svc.name) : getServiceStatus(svc.name),
        getServiceRestartedAt(svc.name),
      ]);

      return {
        name: svc.name,
        label: svc.label,
        description: svc.description,
        status,
        restartedAt,
        type: isTimer ? "timer" as const : "service" as const,
      };
    })
  );

  return NextResponse.json({ services });
}
