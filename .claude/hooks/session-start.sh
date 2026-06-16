#!/bin/bash
# SessionStart hook: ensure the Superpowers plugin (brainstorming, TDD,
# systematic debugging, skill authoring) is installed for Claude Code on the web.
#
# The repo's .claude/settings.json marks superpowers as enabled, but the web
# container is ephemeral and starts without the plugin downloaded — so brainstorm
# and the other superpowers skills are missing until the plugin is actually
# fetched. This hook installs it on every fresh container. Idempotent.
set -euo pipefail

# Only run in the remote (web) environment; local installs are managed by the user.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

MARKETPLACE="claude-plugins-official"
PLUGIN="superpowers@${MARKETPLACE}"

# Register the marketplace if it isn't already known (idempotent).
if ! claude plugin marketplace list 2>/dev/null | grep -q "${MARKETPLACE}"; then
  claude plugin marketplace add anthropics/claude-plugins-official >/dev/null 2>&1 || true
fi

# Install (no-op if already installed).
claude plugin install "${PLUGIN}" >/dev/null 2>&1 || true

echo "Superpowers plugin ensured (${PLUGIN})."
