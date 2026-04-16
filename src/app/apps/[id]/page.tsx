"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { DeployButton } from "@/components/DeployButton";
import { LogViewer } from "@/components/LogViewer";
import { DeployHistory } from "@/components/DeployHistory";
import { ServicePanel } from "@/components/ServicePanel";
import type { AppWithStatus, DeployHistoryEntry, StatusResponse } from "@/types/app";

const POLL_INTERVAL_IDLE = 10000;
const POLL_INTERVAL_DEPLOYING = 4000;

export default function AppDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [app, setApp] = useState<AppWithStatus | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [logType, setLogType] = useState<"deploy" | "service">("deploy");
  const [logRefreshKey, setLogRefreshKey] = useState(0);

  const fetchApp = useCallback(async () => {
    try {
      const [appsRes, statusRes] = await Promise.all([
        fetch("/api/apps"),
        fetch(`/api/apps/${id}/status`),
      ]);

      if (appsRes.ok) {
        const data = await appsRes.json();
        const found = data.apps.find((a: AppWithStatus) => a.id === id);
        if (found) setApp(found);
      }

      if (statusRes.ok) {
        const data = await statusRes.json();
        setStatus(data);
      }
    } catch {
      // Handle gracefully during service restarts
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchApp();
  }, [fetchApp]);

  // Adaptive polling
  useEffect(() => {
    const isDeploying = status?.deployStatus === "deploying";
    const interval = isDeploying ? POLL_INTERVAL_DEPLOYING : POLL_INTERVAL_IDLE;
    const timer = setInterval(fetchApp, interval);
    return () => clearInterval(timer);
  }, [status, fetchApp]);

  const handleDeployStarted = useCallback(() => {
    fetchApp();
    setLogType("deploy");
    setLogRefreshKey((k) => k + 1);
  }, [fetchApp]);

  if (loading || !app) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-text-muted">
          {loading ? "Loading..." : "App not found"}
        </div>
      </div>
    );
  }

  const isDeploying = status?.deployStatus === "deploying";
  const serviceStatus = status?.serviceStatus || app.serviceStatus;
  const displayStatus = isDeploying ? "deploying" : serviceStatus;
  const hasMultipleServices = (app.services?.length ?? 0) > 1;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4 text-sm text-text-muted">
        <Link href="/" className="hover:text-accent transition-colors">
          Dashboard
        </Link>
        <span className="mx-2">/</span>
        <span className="text-text">{app.name}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{app.name}</h1>
            <StatusBadge status={displayStatus} />
          </div>
          <p className="mt-1 text-sm text-text-muted">{app.description}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            <span>
              Port{" "}
              <a
                href={`http://100.64.0.1:${app.port}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {app.port}
              </a>
            </span>
            <span>
              <a
                href={`https://github.com/${app.repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {app.repo}
              </a>
            </span>
            {!hasMultipleServices && (
              <span>Service: {app.serviceName}</span>
            )}
          </div>
        </div>
        <DeployButton
          appId={app.id}
          isDeploying={isDeploying}
          onDeployStarted={handleDeployStarted}
        />
      </div>

      {/* Services — shown for multi-service apps like Scrooge */}
      {hasMultipleServices && (
        <div className="mb-6">
          <h2 className="mb-3 text-lg font-semibold">Services</h2>
          <ServicePanel appId={app.id} />
        </div>
      )}

      {/* Deploy Logs */}
      <div className="mb-6">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-semibold">Deploy Logs</h2>
          <div className="flex rounded-lg border border-border bg-bg-card text-xs">
            <button
              onClick={() => {
                setLogType("deploy");
                setLogRefreshKey((k) => k + 1);
              }}
              className={`rounded-l-lg px-3 py-1.5 transition-colors ${
                logType === "deploy"
                  ? "bg-accent text-white"
                  : "text-text-muted hover:text-text"
              }`}
            >
              Deploy
            </button>
            <button
              onClick={() => {
                setLogType("service");
                setLogRefreshKey((k) => k + 1);
              }}
              className={`rounded-r-lg px-3 py-1.5 transition-colors ${
                logType === "service"
                  ? "bg-accent text-white"
                  : "text-text-muted hover:text-text"
              }`}
            >
              Service
            </button>
          </div>
        </div>
        <LogViewer
          key={logRefreshKey}
          appId={app.id}
          type={logType}
          follow={isDeploying && logType === "deploy"}
        />
      </div>

      {/* Deploy History */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Deploy History</h2>
        <DeployHistoryWithData appId={app.id} />
      </div>
    </div>
  );
}

function DeployHistoryWithData({ appId }: { appId: string }) {
  const [history, setHistory] = useState<DeployHistoryEntry[]>([]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/apps/${appId}/status`);
        if (res.ok) {
          const data = await res.json();
          setHistory(data.history || []);
        }
      } catch {
        // Ignore during service restarts
      }
    };
    fetchHistory();
    const timer = setInterval(fetchHistory, 10000);
    return () => clearInterval(timer);
  }, [appId]);

  return <DeployHistory history={history} appId={appId} />;
}
