"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AnalysisArgSpec,
  AnalysisRunResult,
  AnalysisScriptConfig,
} from "@/types/app";

interface Props {
  appId: string;
}

function defaultArgs(spec: AnalysisScriptConfig): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const a of spec.args ?? []) {
    if (a.default === undefined) {
      out[a.name] = a.type === "toggle" ? false : "";
    } else if (a.type === "toggle") {
      out[a.name] = Boolean(a.default);
    } else {
      out[a.name] = String(a.default);
    }
  }
  return out;
}

export function AnalysisPanel({ appId }: Props) {
  const [scripts, setScripts] = useState<AnalysisScriptConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [args, setArgs] = useState<Record<string, string | boolean>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalysisRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/apps/${appId}/analysis`)
      .then((r) => r.json())
      .then((data) => {
        const list: AnalysisScriptConfig[] = data.scripts ?? [];
        setScripts(list);
        if (list.length > 0) {
          setSelectedId(list[0].id);
          setArgs(defaultArgs(list[0]));
        }
      })
      .catch(() => setError("Failed to load analysis scripts"));
  }, [appId]);

  const selected = scripts.find((s) => s.id === selectedId) ?? null;

  const handleSelectScript = (id: string) => {
    setSelectedId(id);
    const spec = scripts.find((s) => s.id === id);
    if (spec) setArgs(defaultArgs(spec));
    setResult(null);
    setError(null);
  };

  const handleRun = useCallback(async () => {
    if (!selected) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/apps/${appId}/analysis/${selected.id}/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Run failed (${res.status})`);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRunning(false);
    }
  }, [appId, selected, args]);

  const handleCopy = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.stdout);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [result]);

  if (scripts.length === 0 && !error) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border bg-bg-card p-5">
      {scripts.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {scripts.map((s) => (
            <button
              key={s.id}
              onClick={() => handleSelectScript(s.id)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                s.id === selectedId
                  ? "border-accent bg-accent text-white"
                  : "border-border text-text-muted hover:text-text"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          <div className="mb-4">
            <h3 className="text-sm font-semibold">{selected.label}</h3>
            <p className="mt-1 text-xs text-text-muted">{selected.description}</p>
          </div>

          {selected.args && selected.args.length > 0 && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              {selected.args.map((a) => (
                <ArgField
                  key={a.name}
                  spec={a}
                  value={args[a.name] ?? (a.type === "toggle" ? false : "")}
                  onChange={(v) =>
                    setArgs((prev) => ({ ...prev, [a.name]: v }))
                  }
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleRun}
              disabled={running}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? "Running..." : "Run analysis"}
            </button>
            {result && (
              <span className="text-xs text-text-muted">
                exit={result.exitCode ?? "—"} · {(result.durationMs / 1000).toFixed(1)}s
                {result.timedOut && " · timed out"}
              </span>
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {result && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
                <code
                  className="truncate font-mono"
                  title={result.commandLine}
                >
                  $ {result.commandLine}
                </code>
                <button
                  onClick={handleCopy}
                  className="shrink-0 rounded-md border border-border px-2 py-1 hover:text-text"
                >
                  {copied ? "Copied!" : "Copy output"}
                </button>
              </div>
              <pre className="max-h-[600px] overflow-auto rounded-lg border border-border bg-bg p-3 text-xs leading-snug">
{result.stdout || "(no stdout)"}
              </pre>
              {result.stderr && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-text-muted hover:text-text">
                    stderr ({result.stderr.length} chars)
                  </summary>
                  <pre className="mt-2 max-h-[300px] overflow-auto rounded-lg border border-red-500/40 bg-red-500/5 p-3 leading-snug">
{result.stderr}
                  </pre>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ArgField({
  spec,
  value,
  onChange,
}: {
  spec: AnalysisArgSpec;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
}) {
  if (spec.type === "toggle") {
    return (
      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-bg p-3 hover:bg-bg-hover">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm">
            {spec.label}{" "}
            <code className="text-xs text-text-muted">{spec.flag}</code>
          </div>
          {spec.description && (
            <div className="mt-0.5 text-xs text-text-muted">
              {spec.description}
            </div>
          )}
        </div>
      </label>
    );
  }

  return (
    <label className="block">
      <div className="mb-1 text-sm">
        {spec.label}{" "}
        <code className="text-xs text-text-muted">{spec.flag}</code>
      </div>
      <input
        type={spec.type === "date" ? "date" : spec.type === "number" ? "number" : "text"}
        value={typeof value === "string" ? value : ""}
        placeholder={spec.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
      />
      {spec.description && (
        <div className="mt-1 text-xs text-text-muted">{spec.description}</div>
      )}
    </label>
  );
}
