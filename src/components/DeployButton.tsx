"use client";

import { useState, useCallback, useEffect, useRef } from "react";

type DeployState = "idle" | "deploying" | "success" | "failed";

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
  const prevDeploying = useRef(externalDeploying);

  // When external deploying goes from true -> false, the deploy finished
  useEffect(() => {
    if (prevDeploying.current && !externalDeploying) {
      setState("idle");
    }
    prevDeploying.current = externalDeploying;
  }, [externalDeploying]);

  const effectiveState = externalDeploying ? "deploying" : state;

  const handleDeploy = useCallback(async () => {
    if (effectiveState === "deploying") return;

    setState("deploying");
    try {
      const res = await fetch(`/api/apps/${appId}/deploy`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Deploy failed");
      }
      onDeployStarted?.();
      // State will be managed by polling after this
    } catch (err) {
      console.error("Deploy failed:", err);
      setState("failed");
      setTimeout(() => setState("idle"), 5000);
    }
  }, [appId, effectiveState, onDeployStarted]);

  const styles: Record<DeployState, string> = {
    idle: "bg-blue-600 hover:bg-blue-500 text-white",
    deploying: "bg-yellow-600/80 text-yellow-100 cursor-not-allowed",
    success: "bg-green-600 text-white",
    failed: "bg-red-600 text-white",
  };

  return (
    <button
      onClick={handleDeploy}
      disabled={effectiveState === "deploying"}
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${styles[effectiveState]}`}
    >
      {effectiveState === "deploying" && (
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
      {effectiveState === "deploying" ? "Deploying..." : "Deploy"}
    </button>
  );
}
