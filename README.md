# Deploy Dashboard

## Purpose
Centralized deployment dashboard for all apps on the OpenClaw production server. Replaces per-app embedded deploy UIs. Managed by OpenClaw (ops/hosting), developed by Claude Code (features/UI).

## Architecture
- **Standalone Next.js app** running on its own port (3099)
- **Does NOT deploy itself** — it deploys other apps
- Each app registers in `data/apps.json` with its workspace path, deploy script, service name, and port
- The dashboard calls each app's own `scripts/deploy.sh` to deploy it
- Shows real-time logs, deploy history, and service status for all apps
- **Accessible via Tailscale only** (same as other apps)

## App Registry
Current registered apps:

| App | Port | Repo | Service | Status |
|-----|------|------|---------|--------|
| **Pitching Analysis** | 3093 | `redoakclaw/pitching-analysis` | `pitching-analysis.service` | ✅ Active |

### Future Apps (pending deploy script creation):
- **ClearLevels** → `redoakclaw/clearlevels` (website)  
- **Tallingo** → `redoakclaw/tallingo` (scorekeeper training)
- **Second Brain** → systemd service active, needs GitHub repo
- **Instagram Viewer** → port 3092, needs deploy automation
- **Lexus CPO Scout** → needs deploy automation  
- **Mission Control** → needs deploy automation

## How Deployment Works
1. Dashboard runs `bash <workspaceDir>/<deployScript>` for the selected app
2. Each app's `deploy.sh` handles git pull, npm ci, build, service restart
3. Dashboard is a **separate process** — no self-destruction problem
4. Dashboard reads deploy logs and service status to show results

## Development Workflow
- **OpenClaw**: creates repo, manages hosting/systemd, adds new apps to registry
- **Claude Code**: builds the dashboard UI, API routes, deploy orchestration  
- Code changes pushed to `main` on GitHub, OpenClaw deploys from there

## Getting Started
```bash
# Install dependencies
npm ci

# Start development server  
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Adding New Apps
To register a new app for deployment:

1. Ensure the app has a `scripts/deploy.sh` file in its workspace directory
2. Ensure the app has a systemd service configured  
3. Add an entry to `data/apps.json`:
```json
{
  "id": "app-name",
  "name": "App Display Name", 
  "repo": "redoakclaw/repo-name",
  "branch": "main",
  "workspaceDir": "/home/redoakclaw/.openclaw/workspace/app-name",
  "deployScript": "scripts/deploy.sh",
  "serviceName": "app-name",
  "port": 3000,
  "description": "Brief description of the app"
}
```

## Security
- **Local only**: Accessible via Tailscale network only
- **Service account**: Runs as the `redoakclaw` user with systemd permissions
- **Workspace isolation**: Each app deploys from its own workspace directory
- **No shell injection**: Deploy commands are pre-defined per app