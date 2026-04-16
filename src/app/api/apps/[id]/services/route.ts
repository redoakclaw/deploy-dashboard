import { NextResponse } from "next/server";
import { getApp } from "@/lib/apps";
import { getServiceStatus, getServiceRestartedAt } from "@/lib/system";
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

  // Build service list: use explicit services array if defined,
  // otherwise fall back to the single serviceName.
  const serviceConfigs = app.services ?? [
    {
      name: app.serviceName,
      label: app.serviceName,
      description: "",
    },
  ];

  const services: ServiceStatus[] = await Promise.all(
    serviceConfigs.map(async (svc) => {
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
      };
    })
  );

  return NextResponse.json({ services });
}
