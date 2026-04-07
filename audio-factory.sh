#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# Nuri Audio Factory
# Nuri researches a topic → sources.md → NotebookLM → podcast audio
#
# Usage:
#   ./audio-factory.sh "<topic>" "<client>"
#   ./audio-factory.sh "AI in healthcare" "Acme Corp"
#
# Flags:
#   --research-only   Stop after generating sources.md (skip NotebookLM)
#   --show-browser    Run browser in non-headless mode (useful for debugging)
#
# Required env (add to ~/.openclaw/.env):
#   ANTHROPIC_API_KEY      — Claude API key
#   NLM_COOKIES_PATH       — Path to exported NotebookLM cookies (recommended)
#   TELEGRAM_BOT_TOKEN     — For delivery notification
#   TELEGRAM_CHAT_ID       — Your Telegram chat ID
#
# Optional:
#   BRAVE_SEARCH_API_KEY   — Better web search results
#   AUDIO_PROJECTS_DIR     — Output directory (default: ~/.openclaw/audio-projects)
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

TOPIC="${1:-}"
CLIENT="${2:-Internal}"
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.openclaw/plugins/audio-factory"
ENV_FILE="$HOME/.openclaw/.env"

# ── Validate ──────────────────────────────────────────────────────

if [[ -z "$TOPIC" ]]; then
  echo "Usage: $0 \"<topic>\" \"<client>\" [--research-only] [--show-browser]"
  echo "       $0 \"AI in healthcare\" \"Acme Corp\""
  exit 1
fi

# ── Load env ──────────────────────────────────────────────────────

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  echo "🔑 Loaded env from $ENV_FILE"
fi

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "❌ ANTHROPIC_API_KEY not set. Add it to $ENV_FILE"
  exit 1
fi

# ── Ensure dependencies ───────────────────────────────────────────

if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org"
  exit 1
fi

if ! node -e "require('@anthropic-ai/sdk')" 2>/dev/null; then
  echo "📦 Installing @anthropic-ai/sdk..."
  npm install -g @anthropic-ai/sdk
fi

# Install playwright only if NotebookLM step is needed
if [[ ! " $* " =~ --research-only ]]; then
  if ! node -e "require('playwright')" 2>/dev/null; then
    echo "📦 Installing playwright..."
    npm install -g playwright
    npx playwright install chromium --with-deps
  fi
fi

# ── Run pipeline ──────────────────────────────────────────────────

echo ""
echo "🎙️  Starting Nuri Audio Factory"
echo "   Topic:  $TOPIC"
echo "   Client: $CLIENT"
echo ""

node "$PLUGIN_DIR/index.js" "$TOPIC" "$CLIENT" "$@"

EXIT_CODE=$?

if [[ $EXIT_CODE -eq 0 ]]; then
  echo ""
  echo "✅ Audio brief ready for $CLIENT on \"$TOPIC\""
else
  echo ""
  echo "❌ Audio factory failed (exit $EXIT_CODE)"
  exit $EXIT_CODE
fi
