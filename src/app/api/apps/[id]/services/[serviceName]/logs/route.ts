import { NextResponse } from "next/server";
import { getApp } from "@/lib/apps";
import { getServiceLogs } from "@/lib/system";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; serviceName: string }> }
) {
  const { id, serviceName } = await params;

  const app = getApp(id);
  if (!app) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  // Validate that the service belongs to this app
  const validNames = app.services
    ? app.services.map((s) => s.name)
    : [app.serviceName];

  if (!validNames.includes(serviceName)) {
    return NextResponse.json(
      { error: `Service "${serviceName}" is not registered for app "${id}"` },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const lines = parseInt(url.searchParams.get("lines") || "80", 10);
  const clampedLines = Math.min(Math.max(lines, 10), 500);

  const logLines = await getServiceLogs(serviceName, clampedLines);
  return NextResponse.json({ lines: logLines, serviceName });
}
