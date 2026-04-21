"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { DeployPreflight } from "@/types/app";

type DeployState = "idle" | "checking" | "deploying" | "success" | "failed";

async function fetchPreflight(appId: string): Promise<DeployPreflight | null> {
  try {
    const res = await fetch(`/api/apps/${appId}/preflight`);
    if (!res.ok) return null;
    return (await res.json()) as DeployPreflight;
  } catch {
    return null;
  }
}

export function DeployButton({
  appId,
  isDeploying: externalDeploying,
  onDeployStarted,
}: {
  appId: string;
  isDeploying?: boolean;
  onDeployStarted?: () => void;
}) {
  const [state, setState] = useState<DeployState>("idle");
  const [preflight, setPreflight] = useState<DeployPreflight | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const prevDeploying = useRef(externalDeploying);

  useEffect(() => {
    if (prevDeploying.current && !externalDeploying) {
      setState("idle");
    }
    prevDeploying.current = externalDeploying;
  }, [externalDeploying]);

  const effectiveState = externalDeploying ? "deploying" : state;

  const runDeploy = useCallback(
    async (force: boolean) => {
      setState("deploying");
      try {
        const res = await fetch(`/api/apps/${appId}/deploy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Deploy failed");
        }
        onDeployStarted?.();
      } catch (err) {
        console.error("Deploy failed:", err);
        setState("failed");
        setTimeout(() => setState("idle"), 5000);
      }
    },
    [appId, onDeployStarted]
  );

  const handleClick = useCallback(async () => {
    if (effectiveState === "deploying" || effectiveState === "checking") return;

    setState("checking");
    const pf = await fetchPreflight(appId);
    setPreflight(pf);

    if (!pf || !pf.supported) {
      // Can't preflight (missing workspace, etc.) — proceed; the deploy
      // script itself will fail loudly if something is wrong.
      setState("idle");
      await runDeploy(false);
      return;
    }

    if (pf.clean) {
      setState("idle");
      await runDeploy(false);
      return;
    }

    setState("idle");
    setModalOpen(true);
  }, [appId, effectiveState, runDeploy]);

  const handleConfirm = useCallback(async () => {
    setModalOpen(false);
    await runDeploy(true);
  }, [runDeploy]);

  const styles: Record<DeployState, string> = {
    idle: "bg-blue-600 hover:bg-blue-500 text-white",
    checking: "bg-blue-700/80 text-blue-100 cursor-wait",
    deploying: "bg-yellow-600/80 text-yellow-100 cursor-not-allowed",
    success: "bg-green-600 text-white",
    failed: "bg-red-600 text-white",
  };

  const label =
    effectiveState === "deploying"
      ? "Deploying..."
      : effectiveState === "checking"
        ? "Checking..."
        : "Deploy";

  return (
    <>
      <button
        onClick={handleClick}
        disabled={
          effectiveState === "deploying" || effectiveState === "checking"
        }
        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${styles[effectiveState]}`}
      >
        {(effectiveState === "deploying" || effectiveState === "checking") && (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
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
        )}
        {label}
      </button>

      <PreflightModal
        open={modalOpen}
        preflight={preflight}
        onCancel={() => setModalOpen(false)}
        onConfirm={handleConfirm}
      />
    </>
  );
}

function PreflightModal({
  open,
  preflight,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  preflight: DeployPreflight | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [showPreviouslyTracked, setShowPreviouslyTracked] = useState(false);

  if (!open || !preflight || !preflight.workspace) return null;
  const w = preflight.workspace;

  const hasDirty = w.dirtyTrackedFiles.length > 0;
  const hasAhead = w.ahead > 0;
  const hasPrevTracked = w.previouslyTrackedFiles.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-2xl rounded-lg border border-border bg-bg-card shadow-2xl">
        <div className="border-b border-border px-5 py-3">
          <h3 className="text-base font-semibold">Review before deploy</h3>
          <p className="mt-1 text-xs text-text-muted">
            The default deploy performs{" "}
            <code className="font-mono text-text">git merge --ff-only</code> to{" "}
            <code className="font-mono text-text">origin/{w.branch}</code> —
            well-behaved deploy scripts will refuse while the workspace has
            the state below. Clicking <span className="text-text">Deploy anyway</span>{" "}
            sets <code className="font-mono text-text">FORCE_RESET=1</code>{" "}
            in the spawned script's env; scripts honoring this flag will
            discard local changes via{" "}
            <code className="font-mono text-text">git reset --hard</code>{" "}
            before deploying.
          </p>
        </div>

        <div className="max-h-[60vh] overflow-auto px-5 py-4 space-y-4 text-sm">
          {hasDirty && (
            <div>
              <div className="flex items-center gap-2 text-yellow-400 font-medium mb-1">
                <span>⚠</span>
                <span>
                  {w.dirtyTrackedFiles.length} modified tracked file
                  {w.dirtyTrackedFiles.length === 1 ? "" : "s"} — overwritten
                  if you force
                </span>
              </div>
              <ul className="rounded border border-border bg-bg p-2 font-mono text-xs max-h-40 overflow-auto">
                {w.dirtyTrackedFiles.map((f) => (
                  <li key={f.path} className="text-text-muted">
                    <span className="text-yellow-400 mr-2">{f.change}</span>
                    {f.path}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasAhead && (
            <div>
              <div className="flex items-center gap-2 text-yellow-400 font-medium mb-1">
                <span>⚠</span>
                <span>
                  Workspace is {w.ahead} commit{w.ahead === 1 ? "" : "s"} ahead
                  of{" "}
                  <code className="font-mono text-text">
                    origin/{w.branch}
                  </code>{" "}
                  — discarded if you force
                </span>
              </div>
              <ul className="rounded border border-border bg-bg p-2 font-mono text-xs max-h-40 overflow-auto">
                {w.aheadCommits.map((c) => (
                  <li key={c.sha} className="text-text-muted">
                    <span className="text-yellow-400 mr-2">{c.sha}</span>
                    {c.subject}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {w.behind > 0 && (
            <div className="text-xs text-text-muted">
              Workspace is behind{" "}
              <code className="font-mono text-text">origin/{w.branch}</code> by{" "}
              {w.behind} commit{w.behind === 1 ? "" : "s"} — these will be
              applied when the deploy fast-forwards.
            </div>
          )}

          {hasPrevTracked && (
            <div>
              <button
                onClick={() => setShowPreviouslyTracked((v) => !v)}
                className="flex items-center gap-2 text-blue-400 text-xs hover:text-blue-300"
              >
                <span>ℹ</span>
                <span>
                  {w.previouslyTrackedFiles.length} untracked file
                  {w.previouslyTrackedFiles.length === 1 ? "" : "s"} match
                  committed history (normal after an un-track commit)
                </span>
                <span className="text-text-muted">
                  {showPreviouslyTracked ? "hide" : "show"}
                </span>
              </button>
              {showPreviouslyTracked && (
                <ul className="mt-2 rounded border border-border bg-bg p-2 font-mono text-xs max-h-40 overflow-auto">
                  {w.previouslyTrackedFiles.map((p) => (
                    <li key={p} className="text-text-muted">
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {w.error && (
            <div className="text-xs text-red-400 font-mono">
              git fetch warning: {w.error}
            </div>
          )}

          <div className="flex gap-4 pt-2 text-[11px] text-text-muted font-mono border-t border-border">
            <span>HEAD {w.head?.slice(0, 7) ?? "unknown"}</span>
            <span>remote {w.remoteHead?.slice(0, 7) ?? "unknown"}</span>
            <span>
              +{w.ahead}/-{w.behind}
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 transition-colors"
          >
            Deploy anyway (force)
          </button>
        </div>
      </div>
    </div>
  );
}
