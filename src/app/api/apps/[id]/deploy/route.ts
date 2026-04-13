import { NextResponse } from "next/server";
import { getApp } from "@/lib/apps";
import { startDeploy } from "@/lib/deploy";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const app = getApp(id);
  if (!app) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  const result = startDeploy(app);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({
    deployId: result.deployId,
    status: "started",
    logFile: result.logFile,
  });
}
