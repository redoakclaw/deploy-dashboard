import { NextResponse } from "next/server";
import { getApp } from "@/lib/apps";
import { startDeploy } from "@/lib/deploy";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const app = getApp(id);
  if (!app) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  // Optional { force: true } body bypasses the app deploy script's
  // local-changes guard (convention: FORCE_RESET=1 env var). Used when
  // the operator reviews the preflight warnings and chooses to proceed
  // with the reset anyway.
  let force = false;
  try {
    const body = await request.json();
    if (body && body.force === true) force = true;
  } catch {
    // No body / non-JSON — treat as non-force.
  }

  const result = startDeploy(app, { force });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({
    deployId: result.deployId,
    status: "started",
    logFile: result.logFile,
    force,
  });
}
