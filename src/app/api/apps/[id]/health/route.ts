import { NextResponse } from "next/server";
import { getApp } from "@/lib/apps";
import type {
  HealthPayload,
  HealthResponse,
  HealthCheck,
} from "@/types/app";

export const dynamic = "force-dynamic";

// Proxy to the target app's own /api/health endpoint. Lives server-side so
// the browser doesn't do cross-origin fetches and we can enforce a tight
// timeout per poll — a wedged upstream app should never hang dashboard
// polling. The response is shaped for the dashboard UI: it always comes
// back HTTP 200 with `supported` indicating whether health checking is
// configured, and `payload` / `error` for the actual result.
const FETCH_TIMEOUT_MS = 3000;

function isHealthCheck(v: unknown): v is HealthCheck {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.label === "string" &&
    (c.ok === null || typeof c.ok === "boolean") &&
    typeof c.detail === "string"
  );
}

function isHealthPayload(v: unknown): v is HealthPayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.ok === "boolean" &&
    typeof p.pass === "number" &&
    typeof p.fail === "number" &&
    typeof p.ts === "string" &&
    Array.isArray(p.checks) &&
    p.checks.every(isHealthCheck)
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const app = getApp(id);
  if (!app) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  const fetchedAt = new Date().toISOString();

  if (!app.healthUrl) {
    const res: HealthResponse = {
      supported: false,
      reason: "No healthUrl configured",
      fetchedAt,
    };
    return NextResponse.json(res);
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(app.healthUrl, {
      signal: controller.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    // Read the raw text first so we can show the operator exactly what
    // upstream returned when JSON parsing fails — a 404 HTML page and a
    // crashed handler's error page look identical in the UI otherwise.
    const rawText = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "";

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const snippet = rawText.slice(0, 200).replace(/\s+/g, " ").trim();
      const res: HealthResponse = {
        supported: true,
        fetchedAt,
        httpStatus: upstream.status,
        error:
          `HTTP ${upstream.status} · content-type ${contentType || "(none)"} · ` +
          `body: ${snippet || "(empty)"}`,
      };
      return NextResponse.json(res);
    }

    if (!isHealthPayload(parsed)) {
      const snippet = rawText.slice(0, 200).replace(/\s+/g, " ").trim();
      const res: HealthResponse = {
        supported: true,
        fetchedAt,
        httpStatus: upstream.status,
        error: `upstream JSON did not match expected health shape · body: ${snippet}`,
      };
      return NextResponse.json(res);
    }

    // Note: upstream returns 200 when healthy, 503 when any scored check fails.
    // We pass the payload through either way; the UI styles based on payload.ok.
    const res: HealthResponse = {
      supported: true,
      fetchedAt,
      httpStatus: upstream.status,
      payload: parsed,
    };
    return NextResponse.json(res);
  } catch (e) {
    const isAbort =
      e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
    const res: HealthResponse = {
      supported: true,
      fetchedAt,
      error: isAbort
        ? `timeout after ${FETCH_TIMEOUT_MS}ms`
        : e instanceof Error
          ? e.message
          : String(e),
    };
    return NextResponse.json(res);
  } finally {
    clearTimeout(t);
  }
}
