import { NextResponse } from "next/server";
import { getApp } from "@/lib/apps";
import {
  getServiceStatus,
  getTimerStatus,
  getServiceRestartedAt,
  getTimerTimings,
} from "@/lib/system";
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

      if (isTimer) {
        // For timers: status comes from the .timer unit, last-run and next-run
        // come from the timer's own LastTriggerUSec / NextElapseUSecRealtime —
        // the service's ActiveEnterTimestamp is unreliable for quick oneshots.
        const [status, timings] = await Promise.all([
          getTimerStatus(svc.name),
          getTimerTimings(svc.name),
        ]);
        return {
          name: svc.name,
          label: svc.label,
          description: svc.description,
          status,
          restartedAt: timings.lastRun,
          nextRunAt: timings.nextRun,
          type: "timer" as const,
        };
      }

      // Daemons: both from the .service unit.
      const [status, restartedAt] = await Promise.all([
        getServiceStatus(svc.name),
        getServiceRestartedAt(svc.name),
      ]);
      return {
        name: svc.name,
        label: svc.label,
        description: svc.description,
        status,
        restartedAt,
        type: "service" as const,
      };
    })
  );

  return NextResponse.json({ services });
}
