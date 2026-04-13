"use client";

import { useEffect, useState, useCallback } from "react";
import { AppCard } from "@/components/AppCard";
import type { AppWithStatus } from "@/types/app";

const POLL_INTERVAL_IDLE = 10000;
const POLL_INTERVAL_DEPLOYING = 4000;

export default function DashboardPage() {
  const [apps, setApps] = useState<AppWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchApps = useCallback(async () => {
    try {
      const res = await fetch("/api/apps");
      if (res.ok) {
        const data = await res.json();
        setApps(data.apps);
        setError(null);
      }
    } catch {
      // Gracefully handle disconnects during service restarts
      setError("Dashboard reconnecting...");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  // Poll with adaptive interval
  useEffect(() => {
    const anyDeploying = apps.some((a) => a.deployStatus === "deploying");
    const interval = anyDeploying ? POLL_INTERVAL_DEPLOYING : POLL_INTERVAL_IDLE;

    const timer = setInterval(fetchApps, interval);
    return () => clearInterval(timer);
  }, [apps, fetchApps]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-text-muted">Loading apps...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Apps</h1>
          <p className="mt-1 text-sm text-text-muted">
            {apps.length} registered app{apps.length !== 1 ? "s" : ""}
          </p>
        </div>
        {error && (
          <span className="text-xs text-yellow-400">{error}</span>
        )}
      </div>
      <div className="flex flex-col gap-4">
        {apps.map((app) => (
          <AppCard key={app.id} app={app} onDeployStarted={fetchApps} />
        ))}
        {apps.length === 0 && (
          <p className="py-10 text-center text-text-muted">
            No apps registered. Add apps to{" "}
            <code className="rounded bg-bg-card px-1.5 py-0.5 text-xs">data/apps.json</code>
          </p>
        )}
      </div>
    </div>
  );
}
