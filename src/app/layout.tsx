import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deploy Dashboard",
  description: "Centralized deployment dashboard for OpenClaw apps",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-text antialiased">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <a href="/" className="flex items-center gap-2 text-lg font-bold text-text">
              <svg
                className="h-6 w-6 text-accent"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Deploy Dashboard
            </a>
            <span className="text-xs text-text-muted">
              OpenClaw Ops
              {process.env.NEXT_PUBLIC_COMMIT_HASH && (
                <span className="ml-2 rounded bg-bg-card px-1.5 py-0.5 font-mono text-[10px]" title={`Built: ${process.env.NEXT_PUBLIC_BUILD_TIME || ""}\nCommit: ${process.env.NEXT_PUBLIC_COMMIT_DATE || ""}`}>
                  v:{process.env.NEXT_PUBLIC_COMMIT_HASH}
                </span>
              )}
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
