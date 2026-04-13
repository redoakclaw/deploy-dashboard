"use client";

import { useState } from "react";
import type { DeployHistoryEntry } from "@/types/app";

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString();
}

const resultConfig = {
  success: { icon: "\u2705", label: "Success", cls: "text-green-400" },
  failed: { icon: "\u274c", label: "Failed", cls: "text-red-400" },
  running: { icon: "\u23f3", label: "Running", cls: "text-yellow-400" },
};

export function DeployHistory({
  history,
  appId,
}: {
  history: DeployHistoryEntry[];
  appId: string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<string[]>([]);

  const toggleExpand = async (entry: DeployHistoryEntry) => {
    if (expandedId === entry.deployId) {
      setExpandedId(null);
      setExpandedLogs([]);
      return;
    }

    setExpandedId(entry.deployId);
    try {
      const res = await fetch(`/api/apps/${appId}/logs?type=deploy`);
      if (res.ok) {
        const data = await res.json();
        setExpandedLogs(data.lines || []);
      }
    } catch {
      setExpandedLogs(["Failed to load logs"]);
    }
  };

  if (history.length === 0) {
    return (
      <p className="text-sm text-text-muted italic">No deploy history yet</p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm table-fixed">
        <colgroup>
          <col className="w-44" />
          <col />
          <col className="w-20" />
          <col className="w-24" />
        </colgroup>
        <thead>
          <tr className="border-b border-border bg-bg-card text-left text-xs text-text-muted">
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Commit</th>
            <th className="px-3 py-2 font-medium">Duration</th>
            <th className="px-3 py-2 font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {history.map((entry) => {
            const rc = resultConfig[entry.result] || resultConfig.failed;
            const isExpanded = expandedId === entry.deployId;
            return (
              <tr
                key={entry.deployId}
                onClick={() => toggleExpand(entry)}
                className="cursor-pointer border-b border-border hover:bg-bg-hover transition-colors"
              >
                <td className="px-3 py-2 text-text whitespace-nowrap">
                  {formatTimestamp(entry.timestamp)}
                </td>
                <td className="px-3 py-2">
                  {entry.commitHash ? (
                    <div>
                      <code className="text-[11px] font-mono text-accent">
                        {entry.commitHash}
                      </code>
                      {entry.commitMessage && (
                        <span className="ml-1.5 text-xs text-text-muted">
                          {entry.commitMessage}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-text-muted italic">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-text-muted whitespace-nowrap">
                  {formatDuration(entry.duration)}
                </td>
                <td className={`px-3 py-2 whitespace-nowrap ${rc.cls}`}>
                  {rc.icon} {rc.label}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {expandedId && (
        <div className="border-t border-border bg-bg p-3 font-mono text-xs leading-5 max-h-60 overflow-auto">
          {expandedLogs.length === 0 ? (
            <span className="text-text-muted italic">Loading logs...</span>
          ) : (
            expandedLogs.map((line, i) => (
              <div key={i} className="text-text-muted">
                {line || "\u00a0"}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
