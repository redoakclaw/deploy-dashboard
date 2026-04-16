"use client";

import { useEffect, useState, useCallback } from "react";
import { StatusBadge } from "./StatusBadge";
import { LogViewer } from "./LogViewer";
import type { ServiceStatus } from "@/types/app";

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Unknown";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "Just now";
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function ServiceRow({
  svc,
  appId,
  onRestarted,
}: {
  svc: ServiceStatus;
  appId: string;
  onRestarted: () => void;
}) {
  const [restarting, setRestarting] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logRefreshKey, setLogRefreshKey] = useState(0);

  const handleRestart = useCallback(async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      const res = await fetch(
        `/api/apps/${appId}/services/${svc.name}/restart`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json();
        console.error("Restart failed:", data.error);
      }
      onRestarted();
    } catch (err) {
      console.error("Restart failed:", err);
    } finally {
      setRestarting(false);
    }
  }, [appId, svc.name, restarting, onRestarted]);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch(
        `/api/apps/${appId}/services/${svc.name}/logs?lines=80`
      );
      if (res.ok) {
        const data = await res.json();
        setLogLines(data.lines || []);
      }
    } catch {
      setLogLines(["Failed to fetch logs"]);
    } finally {
      setLogsLoading(false);
    }
  }, [appId, svc.name]);

  const toggleLogs = useCallback(() => {
    const next = !logsOpen;
    setLogsOpen(next);
    if (next) {
      setLogRefreshKey((k) => k + 1);
      fetchLogs();
    }
  }, [logsOpen, fetchLogs]);

  return (
    <div className="border border-border rounded-lg bg-bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Status + name */}
        <StatusBadge status={svc.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-text">{svc.label}</span>
            <span className="text-xs text-text-muted font-mono">
              {svc.name}
            </span>
          </div>
          {svc.description && (
            <p className="text-xs text-text-muted mt-0.5">{svc.description}</p>
          )}
        </div>

        {/* Restarted-at */}
        <div className="text-xs text-text-muted whitespace-nowrap">
          Restarted{" "}
          <span
            className={
              svc.status === "active" ? "text-text" : "text-red-400"
            }
          >
            {formatRelativeTime(svc.restartedAt)}
          </span>
        </div>

        {/* Logs toggle */}
        <button
          onClick={toggleLogs}
          className="rounded px-2.5 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
        >
          {logsOpen ? "Hide Logs" : "Logs"}
        </button>

        {/* Restart button */}
        <button
          onClick={handleRestart}
          disabled={restarting}
          className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            restarting
              ? "bg-yellow-600/80 text-yellow-100 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-500 text-white"
          }`}
        >
          {restarting ? (
            <span className="flex items-center gap-1.5">
              <svg
                className="h-3 w-3 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Restarting
            </span>
          ) : (
            "Restart"
          )}
        </button>
      </div>

      {/* Collapsible log viewer */}
      {logsOpen && (
        <div className="border-t border-border">
          <ServiceLogViewer
            key={logRefreshKey}
            lines={logLines}
            loading={logsLoading}
            onRefresh={fetchLogs}
            serviceName={svc.name}
          />
        </div>
      )}
    </div>
  );
}

function classifyLine(line: string): string {
  const lower = line.toLowerCase();
  if (
    lower.includes("error") ||
    lower.includes("fatal") ||
    lower.includes("fail")
  ) {
    return "text-red-400";
  }
  if (lower.includes("warn")) {
    return "text-yellow-400";
  }
  if (
    lower.includes("success") ||
    lower.includes("done") ||
    lower.includes("complete")
  ) {
    return "text-green-400";
  }
  return "text-text";
}

function ServiceLogViewer({
  lines,
  loading,
  onRefresh,
  serviceName,
}: {
  lines: string[];
  loading: boolean;
  onRefresh: () => void;
  serviceName: string;
}) {
  const [copied, setCopied] = useState(false);

  const copyLogs = useCallback(() => {
    const text = lines.join("\n");
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [lines]);

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs text-text-muted font-medium uppercase">
          {serviceName} journal
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="rounded px-2 py-1 text-xs text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button
            onClick={copyLogs}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              copied
                ? "text-green-400"
                : "text-text-muted hover:text-text hover:bg-bg-hover"
            }`}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      <div className="max-h-64 overflow-auto p-3 font-mono text-xs leading-5">
        {lines.length === 0 ? (
          <p className="text-text-muted italic">No logs available</p>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={classifyLine(line)}>
              {line || "\u00a0"}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function ServicePanel({ appId }: { appId: string }) {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchServices = useCallback(async () => {
    try {
      const res = await fetch(`/api/apps/${appId}/services`);
      if (res.ok) {
        const data = await res.json();
        setServices(data.services || []);
      }
    } catch {
      // Ignore during service restarts
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    fetchServices();
    const timer = setInterval(fetchServices, 10000);
    return () => clearInterval(timer);
  }, [fetchServices]);

  if (loading) {
    return (
      <div className="text-sm text-text-muted py-4">Loading services...</div>
    );
  }

  if (services.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {services.map((svc) => (
        <ServiceRow
          key={svc.name}
          svc={svc}
          appId={appId}
          onRestarted={fetchServices}
        />
      ))}
    </div>
  );
}
