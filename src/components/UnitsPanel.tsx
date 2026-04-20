"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  SystemdUnit,
  UnitDriftStatus,
  UnitInstallResult,
  UnitsResponse,
} from "@/types/app";

const driftStyles: Record<
  UnitDriftStatus,
  { bg: string; text: string; label: string }
> = {
  drifted: {
    bg: "bg-yellow-500/15",
    text: "text-yellow-400",
    label: "Drifted",
  },
  "missing-installed": {
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    label: "Not installed",
  },
  "orphan-installed": {
    bg: "bg-purple-500/15",
    text: "text-purple-400",
    label: "Orphan",
  },
  "in-sync": {
    bg: "bg-green-500/15",
    text: "text-green-400",
    label: "In sync",
  },
};

function DriftBadge({ status }: { status: UnitDriftStatus }) {
  const s = driftStyles[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}
    >
      {s.label}
    </span>
  );
}

function DiffBlock({ diff }: { diff: string }) {
  return (
    <pre className="mt-2 max-h-80 overflow-auto rounded border border-border bg-bg p-3 font-mono text-xs leading-5">
      {diff.split("\n").map((line, i) => {
        let color = "text-text-muted";
        if (line.startsWith("+ ")) color = "text-green-400";
        else if (line.startsWith("- ")) color = "text-red-400";
        return (
          <div key={i} className={color}>
            {line || "\u00a0"}
          </div>
        );
      })}
    </pre>
  );
}

function UnitRow({
  unit,
  appId,
  onChanged,
}: {
  unit: SystemdUnit;
  appId: string;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState<"install" | "remove" | null>(null);

  const fullName = `${unit.name}.${unit.kind}`;
  const needsInstall =
    unit.driftStatus === "drifted" || unit.driftStatus === "missing-installed";
  const isOrphan = unit.driftStatus === "orphan-installed";

  const install = useCallback(async () => {
    if (acting) return;
    setActing("install");
    try {
      const res = await fetch(`/api/apps/${appId}/units/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: [fullName] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("Install failed:", data.error);
      }
      onChanged();
    } finally {
      setActing(null);
    }
  }, [acting, appId, fullName, onChanged]);

  const remove = useCallback(async () => {
    if (acting) return;
    if (
      !confirm(
        `Delete orphan unit ${fullName} from ~/.config/systemd/user/?\n\n` +
          `This will also run daemon-reload. It will NOT stop the unit if it is running.`
      )
    ) {
      return;
    }
    setActing("remove");
    try {
      const res = await fetch(`/api/apps/${appId}/units/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unit: fullName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Remove failed: ${data.error || "unknown error"}`);
      }
      onChanged();
    } finally {
      setActing(null);
    }
  }, [acting, appId, fullName, onChanged]);

  const hasDiff = unit.diff && unit.diff.length > 0;

  return (
    <div className="rounded-lg border border-border bg-bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <DriftBadge status={unit.driftStatus} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-text">{fullName}</span>
            <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] font-mono text-text-muted border border-border">
              {unit.kind}
            </span>
            {unit.unitType !== "unknown" && unit.unitType !== "timer" && (
              <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] font-mono text-text-muted border border-border">
                {unit.unitType}
              </span>
            )}
            {unit.isActive && (
              <span className="text-[10px] font-mono text-green-400">
                ● active
              </span>
            )}
          </div>
        </div>

        {hasDiff && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded px-2.5 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
          >
            {expanded ? "Hide diff" : "View diff"}
          </button>
        )}

        {needsInstall && (
          <button
            onClick={install}
            disabled={acting !== null}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              acting === "install"
                ? "bg-yellow-600/80 text-yellow-100 cursor-not-allowed"
                : acting
                  ? "bg-gray-600/50 text-gray-400 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-500 text-white"
            }`}
          >
            {acting === "install" ? "Installing…" : "Install"}
          </button>
        )}

        {isOrphan && (
          <button
            onClick={remove}
            disabled={acting !== null}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              acting === "remove"
                ? "bg-red-800/80 text-red-200 cursor-not-allowed"
                : acting
                  ? "bg-gray-600/50 text-gray-400 cursor-not-allowed"
                  : "bg-red-600 hover:bg-red-500 text-white"
            }`}
          >
            {acting === "remove" ? "Removing…" : "Remove"}
          </button>
        )}
      </div>

      {expanded && hasDiff && (
        <div className="border-t border-border px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">
            <span className="text-red-400">- installed</span>
            <span className="mx-2">vs</span>
            <span className="text-green-400">+ repo</span>
          </div>
          <DiffBlock diff={unit.diff!} />
        </div>
      )}
    </div>
  );
}

function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  danger,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-bg-card shadow-2xl">
        <div className="border-b border-border px-5 py-3">
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <div className="px-5 py-4 text-sm text-text-muted">{children}</div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded px-3 py-1.5 text-xs font-medium text-white transition-colors ${
              danger
                ? "bg-red-600 hover:bg-red-500"
                : "bg-blue-600 hover:bg-blue-500"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function UnitsPanel({ appId }: { appId: string }) {
  const [state, setState] = useState<UnitsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInSync, setShowInSync] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkInstalling, setBulkInstalling] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<UnitInstallResult[] | null>(null);

  const fetchUnits = useCallback(async () => {
    try {
      const res = await fetch(`/api/apps/${appId}/units`);
      if (res.ok) {
        const data: UnitsResponse = await res.json();
        setState(data);
      }
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    fetchUnits();
    const timer = setInterval(fetchUnits, 30000);
    return () => clearInterval(timer);
  }, [fetchUnits]);

  const drifted = useMemo(
    () => state?.units.filter((u) => u.driftStatus === "drifted") ?? [],
    [state]
  );
  const missing = useMemo(
    () => state?.units.filter((u) => u.driftStatus === "missing-installed") ?? [],
    [state]
  );
  const orphans = useMemo(
    () => state?.units.filter((u) => u.driftStatus === "orphan-installed") ?? [],
    [state]
  );
  const inSync = useMemo(
    () => state?.units.filter((u) => u.driftStatus === "in-sync") ?? [],
    [state]
  );

  const needsAction = drifted.length + missing.length;
  const installTargets = useMemo(
    () =>
      [...drifted, ...missing].map((u) => `${u.name}.${u.kind}`),
    [drifted, missing]
  );

  const runBulkInstall = useCallback(async () => {
    setBulkInstalling(true);
    setBulkSummary(null);
    try {
      const res = await fetch(`/api/apps/${appId}/units/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json();
      setBulkSummary(data.results || []);
      await fetchUnits();
    } finally {
      setBulkInstalling(false);
      setBulkConfirmOpen(false);
    }
  }, [appId, fetchUnits]);

  if (loading) {
    return <div className="text-sm text-text-muted py-4">Loading units…</div>;
  }

  if (!state) return null;

  if (!state.supported) {
    return (
      <div className="rounded-lg border border-border bg-bg-card p-4 text-sm text-text-muted">
        {state.reason || "Unit drift tracking is not configured for this app."}
      </div>
    );
  }

  if (state.units.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-card p-4 text-sm text-text-muted">
        No systemd units found in the configured directory.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Summary bar */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-card px-4 py-3">
        <div className="flex items-center gap-3 text-xs">
          {needsAction === 0 && orphans.length === 0 ? (
            <span className="text-green-400">
              ● All {inSync.length} units in sync with repo
            </span>
          ) : (
            <>
              {drifted.length > 0 && (
                <span className="text-yellow-400">
                  {drifted.length} drifted
                </span>
              )}
              {missing.length > 0 && (
                <span className="text-blue-400">
                  {missing.length} not installed
                </span>
              )}
              {orphans.length > 0 && (
                <span className="text-purple-400">
                  {orphans.length} orphan{orphans.length === 1 ? "" : "s"}
                </span>
              )}
              {inSync.length > 0 && (
                <span className="text-text-muted">
                  {inSync.length} in sync
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInSync((v) => !v)}
            className="rounded px-2.5 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
          >
            {showInSync ? "Hide in-sync" : `Show in-sync (${inSync.length})`}
          </button>
          <button
            onClick={fetchUnits}
            className="rounded px-2.5 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
          >
            Refresh
          </button>
          {needsAction > 0 && (
            <button
              onClick={() => setBulkConfirmOpen(true)}
              disabled={bulkInstalling}
              className="rounded px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors disabled:opacity-50"
            >
              Install all ({needsAction})
            </button>
          )}
        </div>
      </div>

      {bulkSummary && (
        <div className="rounded-lg border border-border bg-bg-card p-3 text-xs">
          <div className="mb-1 font-medium text-text">Bulk install result:</div>
          <ul className="space-y-0.5 font-mono">
            {bulkSummary.map((r) => (
              <li
                key={r.name}
                className={r.success ? "text-green-400" : "text-red-400"}
              >
                {r.success ? "✓" : "✗"} {r.name}
                {r.error ? ` — ${r.error}` : ""}
              </li>
            ))}
          </ul>
          <div className="mt-2 text-text-muted">
            Remember: Install only copies unit files and runs daemon-reload.
            Long-running daemons still need a Restart in the Services panel to
            pick up the new definition.
          </div>
        </div>
      )}

      {/* Unit list */}
      <div className="flex flex-col gap-2">
        {[...drifted, ...missing, ...orphans].map((u) => (
          <UnitRow
            key={`${u.name}.${u.kind}`}
            unit={u}
            appId={appId}
            onChanged={fetchUnits}
          />
        ))}
        {showInSync &&
          inSync.map((u) => (
            <UnitRow
              key={`${u.name}.${u.kind}`}
              unit={u}
              appId={appId}
              onChanged={fetchUnits}
            />
          ))}
      </div>

      <ConfirmModal
        open={bulkConfirmOpen}
        title={`Install ${installTargets.length} unit${installTargets.length === 1 ? "" : "s"}?`}
        confirmLabel={bulkInstalling ? "Installing…" : "Install all"}
        onConfirm={runBulkInstall}
        onCancel={() => setBulkConfirmOpen(false)}
      >
        <p className="mb-2">
          This will copy the following unit files from the repo into{" "}
          <code className="font-mono text-text">~/.config/systemd/user/</code>,
          then run{" "}
          <code className="font-mono text-text">
            systemctl --user daemon-reload
          </code>
          .
        </p>
        <p className="mb-2 text-xs">
          <span className="text-text">Important:</span> Install does{" "}
          <span className="text-yellow-400">not</span> restart any running
          service. Long-running daemons will keep running their previous
          definition until you hit Restart in the Services panel — safe to do
          mid-day.
        </p>
        <ul className="mt-3 max-h-48 overflow-auto rounded border border-border bg-bg p-2 font-mono text-xs">
          {installTargets.map((n) => (
            <li key={n} className="text-text-muted">
              {n}
            </li>
          ))}
        </ul>
      </ConfirmModal>
    </div>
  );
}
