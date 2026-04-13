"use client";

import { useEffect, useRef, useState, useCallback } from "react";

function classifyLine(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("error") || lower.includes("fatal") || lower.includes("fail")) {
    return "text-red-400";
  }
  if (lower.includes("warn")) {
    return "text-yellow-400";
  }
  if (lower.includes("success") || lower.includes("done") || lower.includes("complete")) {
    return "text-green-400";
  }
  if (line.startsWith("[") || line.startsWith("---")) {
    return "text-text-muted";
  }
  return "text-text";
}

export function LogViewer({
  appId,
  type = "deploy",
  follow = false,
}: {
  appId: string;
  type?: "deploy" | "service";
  follow?: boolean;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  // Fetch logs (polling or SSE)
  useEffect(() => {
    if (follow) {
      // SSE streaming
      setConnected(true);
      const evtSource = new EventSource(
        `/api/apps/${appId}/logs?type=${type}&follow=true`
      );

      evtSource.onmessage = (event) => {
        if (event.data === "[DONE]") {
          evtSource.close();
          setConnected(false);
          return;
        }
        try {
          const newLines: string[] = JSON.parse(event.data);
          setLines((prev) => [...prev, ...newLines]);
        } catch {
          // Ignore parse errors
        }
      };

      evtSource.onerror = () => {
        // Reconnect handled by EventSource, or deploy finished
        setConnected(false);
        evtSource.close();
      };

      return () => {
        evtSource.close();
        setConnected(false);
      };
    } else {
      // One-time fetch
      const fetchLogs = async () => {
        try {
          const res = await fetch(`/api/apps/${appId}/logs?type=${type}`);
          if (res.ok) {
            const data = await res.json();
            setLines(data.lines || []);
          }
        } catch {
          // Ignore fetch errors during service restart
        }
      };
      fetchLogs();
    }
  }, [appId, type, follow]);

  const [copied, setCopied] = useState(false);

  const copyLogs = useCallback(() => {
    const text = lines.join("\n");
    // navigator.clipboard requires HTTPS — use fallback for HTTP/Tailscale
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
    <div className="flex flex-col rounded-lg border border-border bg-bg overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span className="font-medium uppercase">{type} Logs</span>
          {follow && connected && (
            <span className="flex items-center gap-1 text-green-400">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              Live
            </span>
          )}
        </div>
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
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="max-h-96 overflow-auto p-3 font-mono text-xs leading-5"
      >
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
