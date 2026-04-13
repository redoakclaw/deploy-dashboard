import { NextResponse } from "next/server";
import { getApp, readDeployStatus, getLastDeploy } from "@/lib/apps";
import { getServiceLogs } from "@/lib/system";
import { readDeployLog } from "@/lib/deploy";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const app = getApp(id);
  if (!app) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "deploy";
  const follow = url.searchParams.get("follow") === "true";

  if (type === "service") {
    const lines = await getServiceLogs(app.serviceName);
    return NextResponse.json({ lines, type: "service" });
  }

  // Deploy logs
  if (follow) {
    // SSE streaming for live deploy logs
    const deployStatus = readDeployStatus(id);
    const logFile = deployStatus.logFile;

    if (!logFile || deployStatus.status !== "deploying") {
      return NextResponse.json({
        lines: logFile ? readDeployLog(logFile) : [],
        type: "deploy",
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let lastLength = 0;

        const interval = setInterval(() => {
          try {
            const lines = readDeployLog(logFile, 0);
            if (lines.length > lastLength) {
              const newLines = lines.slice(lastLength);
              lastLength = lines.length;
              const data = `data: ${JSON.stringify(newLines)}\n\n`;
              controller.enqueue(encoder.encode(data));
            }

            // Check if deploy is done
            const currentStatus = readDeployStatus(id);
            if (currentStatus.status !== "deploying") {
              // Send remaining lines
              const finalLines = readDeployLog(logFile, 0);
              if (finalLines.length > lastLength) {
                const newLines = finalLines.slice(lastLength);
                const data = `data: ${JSON.stringify(newLines)}\n\n`;
                controller.enqueue(encoder.encode(data));
              }
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              clearInterval(interval);
              controller.close();
            }
          } catch {
            clearInterval(interval);
            controller.close();
          }
        }, 1000);

        // Safety timeout — close after 11 minutes
        setTimeout(() => {
          clearInterval(interval);
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }, 11 * 60 * 1000);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Non-streaming: return current/last deploy logs
  const deployStatus = readDeployStatus(id);
  const logFile =
    deployStatus.logFile || getLastDeploy(id)?.logFile || null;

  const lines = logFile ? readDeployLog(logFile) : [];
  return NextResponse.json({ lines, type: "deploy" });
}
