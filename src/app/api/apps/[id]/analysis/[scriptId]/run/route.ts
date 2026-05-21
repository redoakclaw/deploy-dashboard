import { NextResponse } from "next/server";
import { getApp } from "@/lib/apps";
import { runAnalysisScript } from "@/lib/analysis";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; scriptId: string }> }
) {
  const { id, scriptId } = await params;
  const app = getApp(id);
  if (!app) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine — all script args have validators that
    // treat missing values as omit-the-flag.
  }

  const result = await runAnalysisScript(app, scriptId, body.args as Record<string, unknown> ?? {});
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
