type Status = "active" | "inactive" | "deploying" | "failed" | "unknown";

const config: Record<Status, { bg: string; text: string; icon: string; label: string }> = {
  active: { bg: "bg-green-500/15", text: "text-green-400", icon: "\u25cf", label: "Running" },
  inactive: { bg: "bg-gray-500/15", text: "text-gray-400", icon: "\u25cf", label: "Stopped" },
  deploying: { bg: "bg-yellow-500/15", text: "text-yellow-400", icon: "\u25cf", label: "Deploying" },
  failed: { bg: "bg-red-500/15", text: "text-red-400", icon: "\u25cf", label: "Failed" },
  unknown: { bg: "bg-gray-500/15", text: "text-gray-400", icon: "?", label: "Unknown" },
};

export function StatusBadge({ status }: { status: Status }) {
  const c = config[status] || config.unknown;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${c.bg} ${c.text}`}
    >
      <span className={status === "deploying" ? "animate-pulse" : ""}>{c.icon}</span>
      {c.label}
    </span>
  );
}
