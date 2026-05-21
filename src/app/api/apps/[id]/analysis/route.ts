import { NextResponse } from "next/server";
import { getApp } from "@/lib/apps";
import { publicAnalysisScripts } from "@/lib/analysis";

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
  return NextResponse.json({ scripts: publicAnalysisScripts(app) });
}
