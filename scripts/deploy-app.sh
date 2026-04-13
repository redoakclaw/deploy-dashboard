#!/bin/bash
# Generic deployment wrapper for deploy-dashboard
# Usage: ./deploy-app.sh <app-id> [log-file]

set -euo pipefail

# Validate arguments
if [ $# -lt 1 ]; then
    echo "Usage: $0 <app-id> [log-file]" >&2
    exit 1
fi

APP_ID="$1"
LOG_FILE="${2:-/tmp/deploy-${APP_ID}-$(date +%s).log}"
APPS_JSON="$(dirname "$0")/../data/apps.json"

# Ensure apps.json exists
if [ ! -f "$APPS_JSON" ]; then
    echo "Error: apps.json not found at $APPS_JSON" >&2
    exit 1
fi

# Extract app configuration using jq
if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq is required but not installed" >&2
    exit 1
fi

# Get app details from registry
APP_CONFIG=$(jq -r ".apps[] | select(.id == \"$APP_ID\")" "$APPS_JSON")

if [ -z "$APP_CONFIG" ]; then
    echo "Error: App '$APP_ID' not found in registry" >&2
    exit 1
fi

# Parse app configuration
WORKSPACE_DIR=$(echo "$APP_CONFIG" | jq -r '.workspaceDir')
DEPLOY_SCRIPT=$(echo "$APP_CONFIG" | jq -r '.deployScript')
SERVICE_NAME=$(echo "$APP_CONFIG" | jq -r '.serviceName')

# Validate paths
if [ ! -d "$WORKSPACE_DIR" ]; then
    echo "Error: Workspace directory not found: $WORKSPACE_DIR" >&2
    exit 1
fi

DEPLOY_PATH="$WORKSPACE_DIR/$DEPLOY_SCRIPT"
if [ ! -f "$DEPLOY_PATH" ]; then
    echo "Error: Deploy script not found: $DEPLOY_PATH" >&2
    exit 1
fi

if [ ! -x "$DEPLOY_PATH" ]; then
    echo "Error: Deploy script is not executable: $DEPLOY_PATH" >&2
    exit 1
fi

# Create log directory if it doesn't exist
mkdir -p "$(dirname "$LOG_FILE")"

# Log deployment start
echo "=== Deploy started at $(date) ===" | tee "$LOG_FILE"
echo "App: $APP_ID" | tee -a "$LOG_FILE"
echo "Workspace: $WORKSPACE_DIR" | tee -a "$LOG_FILE"
echo "Script: $DEPLOY_SCRIPT" | tee -a "$LOG_FILE"
echo "Service: $SERVICE_NAME" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Change to workspace directory
cd "$WORKSPACE_DIR"

# Execute the app's deploy script with logging
echo "Executing: bash $DEPLOY_SCRIPT" | tee -a "$LOG_FILE"
echo "Working directory: $(pwd)" | tee -a "$LOG_FILE"
echo "--- Deploy Script Output ---" | tee -a "$LOG_FILE"

# Run deploy script and capture both stdout and stderr
if bash "$DEPLOY_SCRIPT" 2>&1 | tee -a "$LOG_FILE"; then
    DEPLOY_RESULT="SUCCESS"
    DEPLOY_EXIT_CODE=0
else
    DEPLOY_RESULT="FAILED"
    DEPLOY_EXIT_CODE=1
fi

# Log completion
echo "" | tee -a "$LOG_FILE"
echo "--- Deploy Script Completed ---" | tee -a "$LOG_FILE"
echo "Result: $DEPLOY_RESULT" | tee -a "$LOG_FILE"
echo "=== Deploy finished at $(date) ===" | tee -a "$LOG_FILE"

# Check service status after deployment
if [ "$DEPLOY_RESULT" = "SUCCESS" ]; then
    echo "" | tee -a "$LOG_FILE"
    echo "Checking service status..." | tee -a "$LOG_FILE"
    
    if systemctl --user is-active --quiet "$SERVICE_NAME"; then
        echo "✅ Service $SERVICE_NAME is active" | tee -a "$LOG_FILE"
    else
        echo "❌ Service $SERVICE_NAME is not active after deployment" | tee -a "$LOG_FILE"
        systemctl --user status "$SERVICE_NAME" 2>&1 | tee -a "$LOG_FILE" || true
        DEPLOY_RESULT="FAILED"
        DEPLOY_EXIT_CODE=1
    fi
fi

echo "Final result: $DEPLOY_RESULT" | tee -a "$LOG_FILE"
exit $DEPLOY_EXIT_CODE