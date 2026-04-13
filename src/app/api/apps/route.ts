import { NextResponse } from "next/server";
import { loadApps, readDeployStatus, getLastDeploy } from "@/lib/apps";
import { getServiceStatus } from "@/lib/system";
import type { AppWithStatus } from "@/types/app";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const apps = loadApps();

    const appsWithStatus: AppWithStatus[] = await Promise.all(
      apps.map(async (app) => {
        const serviceStatus = await getServiceStatus(app.serviceName);
        const deployStatusFile = readDeployStatus(app.id);
        const lastDeploy = getLastDeploy(app.id);

        return {
          ...app,
          serviceStatus,
          deployStatus: deployStatusFile.status,
          lastDeploy,
        };
      })
    );

    return NextResponse.json({ apps: appsWithStatus });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load apps", detail: String(error) },
      { status: 500 }
    );
  }
}
