import { NextResponse } from "next/server";
import { getApp } from "@/lib/apps";
import { installUnits, getUnitsForApp } from "@/lib/systemd-units";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const app = getApp(id);
  if (!app) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  let body: { units?: unknown; all?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let targets: string[] = [];

  if (body.all === true) {
    const state = await getUnitsForApp(app);
    if (!state.supported) {
      return NextResponse.json(
        { error: state.reason || "Unsupported" },
        { status: 400 }
      );
    }
    targets = state.units
      .filter(
        (u) =>
          u.driftStatus === "drifted" || u.driftStatus === "missing-installed"
      )
      .map((u) => `${u.name}.${u.kind}`);
  } else if (Array.isArray(body.units)) {
    targets = body.units.filter(
      (u): u is string => typeof u === "string" && u.length > 0
    );
  } else {
    return NextResponse.json(
      { error: "Expected { units: string[] } or { all: true }" },
      { status: 400 }
    );
  }

  if (targets.length === 0) {
    return NextResponse.json({
      results: [],
      daemonReloaded: false,
      message: "No units to install",
    });
  }

  const result = await installUnits(app, targets);
  return NextResponse.json(result);
}
