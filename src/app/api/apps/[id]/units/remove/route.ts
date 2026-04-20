import { NextResponse } from "next/server";
import { getApp } from "@/lib/apps";
import { removeOrphanUnit } from "@/lib/systemd-units";

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

  let body: { unit?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.unit !== "string" || !body.unit) {
    return NextResponse.json(
      { error: "Expected { unit: string }" },
      { status: 400 }
    );
  }

  const result = await removeOrphanUnit(app, body.unit);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Remove failed" },
      { status: 400 }
    );
  }
  return NextResponse.json(result);
}
