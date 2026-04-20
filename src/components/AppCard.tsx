"use client";

import Link from "next/link";
import { StatusBadge } from "./StatusBadge";
import { DeployButton } from "./DeployButton";
import { HealthPill } from "./HealthPill";
import type { AppWithStatus } from "@/types/app";

function formatTime(timestamp: string | null | undefined): string {
  if (!timestamp) return "Never";
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function AppCard({
  app,
  onDeployStarted,
}: {
  app: AppWithStatus;
  onDeployStarted: () => void;
}) {
  const statusForBadge =
    app.deployStatus === "deploying"
      ? "deploying"
      : app.serviceStatus;

  return (
    <div className="rounded-xl border border-border bg-bg-card p-5 transition-colors hover:bg-bg-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href={`/apps/${app.id}`}
              className="text-lg font-semibold text-text hover:text-accent transition-colors truncate"
            >
              {app.name}
            </Link>
            <StatusBadge status={statusForBadge} />
            {app.healthUrl && <HealthPill appId={app.id} pollIntervalMs={30000} />}
          </div>
          <p className="mt-1 text-sm text-text-muted truncate">
            {app.description}
          </p>
        </div>
        <DeployButton
          appId={app.id}
          isDeploying={app.deployStatus === "deploying"}
          onDeployStarted={onDeployStarted}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-text-muted">
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
        <span>
          Last deploy:{" "}
          {app.lastDeploy ? (
            <span
              className={
                app.lastDeploy.result === "success"
                  ? "text-green-400"
                  : app.lastDeploy.result === "failed"
                    ? "text-red-400"
                    : "text-yellow-400"
              }
            >
              {app.lastDeploy.result === "success" ? "\u2713" : app.lastDeploy.result === "failed" ? "\u2717" : "\u23f3"}{" "}
              {formatTime(app.lastDeploy.timestamp)}
            </span>
          ) : (
            "Never"
          )}
        </span>
        {app.lastDeploy?.commitHash && (
          <span className="text-text-muted" title={app.lastDeploy.commitMessage || ""}>
            <code className="rounded bg-bg px-1.5 py-0.5 text-[10px] font-mono">
              {app.lastDeploy.commitHash}
            </code>
            {app.lastDeploy.commitMessage && (
              <span className="ml-1 truncate max-w-[200px] inline-block align-bottom">
                {app.lastDeploy.commitMessage}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
