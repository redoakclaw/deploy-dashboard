import { NextResponse } from "next/server";
import { getApp, readDeployStatus, getLastDeploy } from "@/lib/apps";
import { getServiceStatus } from "@/lib/system";

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

  const serviceStatus = await getServiceStatus(app.serviceName);
  const deployStatusFile = readDeployStatus(id);
  const lastDeploy = getLastDeploy(id);

  return NextResponse.json({
    serviceStatus,
    deployStatus: deployStatusFile.status,
    lastDeploy,
    history: deployStatusFile.history,
  });
}
