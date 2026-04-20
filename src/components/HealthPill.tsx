"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HealthResponse, HealthCheck } from "@/types/app";

// Renders a compact status pill based on the app's /api/health payload,
// and optionally an expandable panel showing the per-check grid. Polls
// in the background at an adaptive interval.

function pillClasses(response: HealthResponse | null, loading: boolean): {
  bg: string;
  text: string;
  dot: string;
  label: string;
} {
  if (loading && !response) {
    return {
      bg: "bg-gray-500/15",
      text: "text-gray-400",
      dot: "bg-gray-400",
      label: "…",
    };
  }
  if (!response) {
    return {
      bg: "bg-gray-500/15",
      text: "text-gray-400",
      dot: "bg-gray-400",
      label: "Unknown",
    };
  }
  if (!response.supported) {
    // Caller should usually hide the pill in this case; render a muted
    // placeholder just so nothing explodes if it's shown anyway.
    return {
      bg: "bg-gray-500/15",
      text: "text-gray-500",
      dot: "bg-gray-500",
      label: "n/a",
    };
  }
  if (response.error) {
    return {
      bg: "bg-red-500/15",
      text: "text-red-400",
      dot: "bg-red-400",
      label: "Unreachable",
    };
  }
  if (!response.payload) {
    return {
      bg: "bg-gray-500/15",
      text: "text-gray-400",
      dot: "bg-gray-400",
      label: "Unknown",
    };
  }
  const { ok, pass, fail } = response.payload;
  if (!ok || fail > 0) {
    return {
      bg: "bg-red-500/15",
      text: "text-red-400",
      dot: "bg-red-400",
      label: `Unhealthy (${fail} fail)`,
    };
  }
  return {
    bg: "bg-green-500/15",
    text: "text-green-400",
    dot: "bg-green-400",
    label: `Healthy (${pass} ok)`,
  };
}

function CheckRow({ check }: { check: HealthCheck }) {
  const color =
    check.ok === null
      ? "text-text-muted"
      : check.ok
        ? "text-green-400"
        : "text-red-400";
  const icon =
    check.ok === null ? "\u25cb" : check.ok ? "\u2713" : "\u2717";
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 text-xs border-b border-border last:border-b-0">
      <span className={`font-mono ${color}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`font-medium ${color}`}>{check.label}</span>
          {typeof check.ageSec === "number" && (
            <span className="text-[10px] font-mono text-text-muted">
              {check.ageSec}s
            </span>
          )}
        </div>
        {check.detail && (
          <div className="text-text-muted text-[11px] leading-4">
            {check.detail}
          </div>
        )}
      </div>
    </div>
  );
}

export function HealthPill({
  appId,
  pollIntervalMs = 10000,
  compact = false,
  onClick,
}: {
  appId: string;
  pollIntervalMs?: number;
  compact?: boolean;
  onClick?: () => void;
}) {
  const [response, setResponse] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`/api/apps/${appId}/health`);
      if (!res.ok) return;
      const data: HealthResponse = await res.json();
      if (mounted.current) setResponse(data);
    } catch {
      // network blip — leave previous state in place
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    mounted.current = true;
    fetchHealth();
    const timer = setInterval(fetchHealth, pollIntervalMs);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [fetchHealth, pollIntervalMs]);

  // If the app doesn't support health checking, render nothing — keeps the
  // UI clean for apps that haven't opted in yet.
  if (response && !response.supported) return null;

  const c = pillClasses(response, loading);

  const pillContent = (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {compact ? c.label.split(" ")[0] : c.label}
    </span>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="inline-flex items-center focus:outline-none focus:ring-2 focus:ring-accent/50 rounded-full"
        title="Click to view details"
      >
        {pillContent}
      </button>
    );
  }
  return pillContent;
}

export function HealthPanel({
  appId,
  pollIntervalMs = 10000,
}: {
  appId: string;
  pollIntervalMs?: number;
}) {
  const [response, setResponse] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`/api/apps/${appId}/health`);
      if (!res.ok) return;
      const data: HealthResponse = await res.json();
      if (mounted.current) setResponse(data);
    } catch {
      // ignore
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    mounted.current = true;
    fetchHealth();
    const timer = setInterval(fetchHealth, pollIntervalMs);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [fetchHealth, pollIntervalMs]);

  if (loading && !response) {
    return (
      <div className="text-sm text-text-muted py-4">Loading health…</div>
    );
  }

  if (!response || !response.supported) {
    return (
      <div className="rounded-lg border border-border bg-bg-card p-4 text-sm text-text-muted">
        {response?.reason || "Health checks not configured for this app."}
      </div>
    );
  }

  if (response.error) {
    return (
      <div className="rounded-lg border border-border bg-bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-red-400">
          <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
          Health endpoint unreachable
          {typeof response.httpStatus === "number" && (
            <span className="ml-1 rounded bg-bg px-1.5 py-0.5 text-[10px] font-mono text-text-muted border border-border">
              HTTP {response.httpStatus}
            </span>
          )}
        </div>
        <div className="mt-2 max-h-40 overflow-auto rounded border border-border bg-bg p-2 font-mono text-[11px] leading-4 text-text-muted whitespace-pre-wrap break-all">
          {response.error}
        </div>
      </div>
    );
  }

  if (!response.payload) return null;

  const { payload } = response;
  const fetchedAt = new Date(response.fetchedAt);
  const payloadTs = new Date(payload.ts);

  return (
    <div className="rounded-lg border border-border bg-bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              payload.ok ? "bg-green-400" : "bg-red-400"
            }`}
          />
          <span
            className={
              payload.ok ? "text-green-400" : "text-red-400"
            }
          >
            {payload.ok ? "All checks passing" : "Checks failing"}
          </span>
          <span className="text-text-muted">
            · {payload.pass} pass, {payload.fail} fail
          </span>
        </div>
        <div className="text-[10px] text-text-muted font-mono">
          report {payloadTs.toLocaleTimeString()} · fetched{" "}
          {fetchedAt.toLocaleTimeString()}
        </div>
      </div>
      <div>
        {payload.checks.map((c, i) => (
          <CheckRow key={`${c.label}-${i}`} check={c} />
        ))}
        {payload.checks.length === 0 && (
          <div className="px-3 py-3 text-xs text-text-muted italic">
            No checks reported
          </div>
        )}
      </div>
    </div>
  );
}
