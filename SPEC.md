# Deploy Dashboard - Build Specification

## Key Requirements (CRITICAL)
- **Deploy process must be spawned detached** (not awaited synchronously)
- **Must source user's shell profile** for PATH/XDG_RUNTIME_DIR before calling systemctl or npm
- **Must write deploy status** to a per-app status file (e.g., `data/.deploy-status-<app-id>.json`)
- **Must not lose runtime data** — each app's deploy.sh handles its own data protection
- **No authentication needed** (Tailscale-only network)

## What NOT to Build
- No CI/CD webhooks, no auto-deploy on push, no rollback mechanism, no multi-server support
- Keep it simple — it's a button that runs a shell script and shows you the output

## Stack
- **Next.js** (latest) + **TypeScript** + **Tailwind CSS v4** + **React 19**
- **Port**: 3099
- **Database**: File-based (JSON) - read `data/apps.json`
- **Process Management**: Node.js `child_process` for deploy execution

## Pages

### `/` — Dashboard Home
- **List all registered apps** from `data/apps.json`
- **App cards** showing:
  - App name + description
  - Current status: `🟢 Running` / `🔴 Stopped` / `🟡 Deploying`
  - Port number (linked to `http://100.64.0.1:<port>`)
  - Last deploy time
  - **"Deploy" button** per app
- **Real-time status polling** every 10 seconds
- **Deploy progress indicators** when deployments are running

### `/apps/[id]` — App Detail Page  
- **App header**: name, repo link, service status, port
- **Deploy history**: last 10 deployments with timestamps, status, duration
- **Live log viewer**: real-time streaming of current deploy logs (if deploying)
- **Manual deploy trigger**: prominent button to start deployment
- **Service controls**: 
  - View logs: `journalctl --user -u <serviceName> -n 50 --no-pager`
  - Service status: `systemctl --user is-active <serviceName>`
  - Restart service: `systemctl --user restart <serviceName>` (separate from deploy)

## API Routes

### `GET /api/apps`
- **Return**: List all apps from `data/apps.json` registry
- **Add runtime data**: current service status, deploy status, last deploy time
- **Response format**:
```json
{
  "apps": [
    {
      "id": "pitching-analysis",
      "name": "Pitching Analysis Dashboard", 
      "repo": "redoakclaw/pitching-analysis",
      "port": 3093,
      "serviceStatus": "active|inactive|failed",
      "deployStatus": "idle|deploying",
      "lastDeploy": "2026-04-12T15:30:00Z",
      "description": "..."
    }
  ]
}
```

### `POST /api/apps/[id]/deploy`
- **Trigger deploy** for specified app
- **Spawn detached process**: `bash <workspaceDir>/<deployScript>`
- **Return immediately** with deploy job ID
- **Log output** to temp file: `/tmp/deploy-<appId>-<timestamp>.log`
- **Set deploy status** to "deploying"
- **Response**: `{"deployId": "pitching-analysis-1712943000", "status": "started"}`

### `GET /api/apps/[id]/status`  
- **Service status**: `systemctl --user is-active <serviceName>`
- **Deploy status**: check if deploy process is running
- **Last deploy result**: success/failure from last completed deploy
- **Response**: 
```json
{
  "serviceStatus": "active",
  "deployStatus": "idle", 
  "lastDeploy": {
    "timestamp": "2026-04-12T15:30:00Z",
    "result": "success|failed",
    "duration": 45000
  }
}
```

### `GET /api/apps/[id]/logs`
- **Recent deploy logs**: last 100 lines from current/last deploy log file
- **Service logs**: `journalctl --user -u <serviceName> -n 50 --no-pager`
- **Live streaming**: use Server-Sent Events for real-time log tailing during deploys
- **Query params**: 
  - `?type=deploy|service` (default: deploy)
  - `?follow=true` (for SSE streaming)

## UI Components

### App Status Badge
```tsx
type Status = 'active' | 'inactive' | 'deploying' | 'failed';
const StatusBadge = ({ status }: { status: Status }) => (
  <span className={`badge ${statusColors[status]}`}>
    {statusIcons[status]} {status.toUpperCase()}
  </span>
);
```

### Deploy Button  
- **States**: 
  - Default: "Deploy" (blue)
  - Deploying: "Deploying..." (yellow, disabled, with spinner)
  - Success: "Deploy" (green for 3 seconds, then back to blue)  
  - Failed: "Deploy" (red for 5 seconds, then back to blue)
- **Click handler**: calls POST `/api/apps/[id]/deploy`, updates UI state

### Log Viewer
- **Syntax highlighting**: for bash output, errors in red
- **Auto-scroll**: stick to bottom during live streaming
- **Timestamps**: prefix each log line
- **Copy button**: copy full logs to clipboard

### Deploy History
- **Table format**: timestamp, duration, result (success/failed), trigger (manual/auto)
- **Status icons**: ✅ success, ❌ failed, ⏳ running
- **Expandable rows**: click to see deploy logs for that run

## File Structure
```
deploy-dashboard/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Dashboard home
│   │   ├── apps/
│   │   │   └── [id]/
│   │   │       └── page.tsx      # App detail page
│   │   └── api/
│   │       └── apps/
│   │           ├── route.ts      # GET /api/apps
│   │           └── [id]/
│   │               ├── deploy/
│   │               │   └── route.ts  # POST deploy
│   │               ├── status/
│   │               │   └── route.ts  # GET status
│   │               └── logs/
│   │                   └── route.ts  # GET logs
│   ├── components/
│   │   ├── AppCard.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── DeployButton.tsx
│   │   ├── LogViewer.tsx
│   │   └── DeployHistory.tsx
│   ├── lib/
│   │   ├── apps.ts              # App registry loader
│   │   ├── deploy.ts            # Deploy process management
│   │   └── system.ts            # systemctl/service utils
│   └── types/
│       └── app.ts               # TypeScript interfaces
├── data/
│   └── apps.json               # App registry (managed by OpenClaw)
├── logs/                       # Deploy log storage (gitignored)
├── package.json
├── tailwind.config.js
├── next.config.js
└── tsconfig.json
```

## Technical Requirements

### Deploy Process Management
- **Spawn child process**: `spawn('bash', [deployScript], { cwd: workspaceDir })`
- **Capture output**: both stdout and stderr to log file
- **Process tracking**: maintain registry of running deploys  
- **Timeout**: kill deploys after 10 minutes
- **Error handling**: catch process exits, permission errors

### System Integration
- **Service status**: reliable `systemctl --user is-active` calls
- **Log access**: read systemd journal with proper permissions
- **File permissions**: ensure deploy-dashboard can read workspace directories
- **Process isolation**: deploy processes run as same user, but isolated

### Real-time Updates
- **Polling**: dashboard polls `/api/apps` every 10 seconds for status
- **WebSocket**: consider for live log streaming (or use SSE)
- **State management**: React context for global app status
- **Optimistic updates**: immediate UI feedback on deploy triggers

### Security & Error Handling  
- **Input validation**: validate app IDs against registry
- **Path traversal**: prevent directory traversal in workspace paths
- **Process limits**: max 3 concurrent deploys
- **Error logging**: log all deploy failures with context
- **Service restart safety**: confirm service exists before attempting restart

## Styling
- **Dark theme**: match other OpenClaw apps
- **Tailscale design**: clean, technical, dashboard aesthetic
- **Mobile responsive**: works on tablets/phones
- **Monospace fonts**: for logs and terminal output
- **Color coding**: green=success, red=error, yellow=warning, blue=info

## Development Notes
- **Hot reload**: standard Next.js dev experience
- **Type safety**: strict TypeScript, no `any` types
- **Testing**: focus on API routes, deploy process management
- **Documentation**: inline JSDoc for complex functions
- **Git hooks**: prettier/eslint on commit