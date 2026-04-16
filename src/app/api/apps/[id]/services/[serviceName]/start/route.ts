import { NextResponse } from "next/server";
import { getApp } from "@/lib/apps";
import { startService, getServiceStatus } from "@/lib/system";

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

  const validNames = app.services
    ? app.services.map((s) => s.name)
    : [app.serviceName];

  if (!validNames.includes(serviceName)) {
    return NextResponse.json(
      { error: `Service "${serviceName}" is not registered for app "${id}"` },
      { status: 400 }
    );
  }

  const ok = await startService(serviceName);
  if (!ok) {
    return NextResponse.json(
      { error: `Failed to start ${serviceName}` },
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
