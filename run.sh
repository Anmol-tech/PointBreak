#!/usr/bin/env bash
# Starts the party runtime (:9001) and the VendorVault gateway + dashboard (:8000).
# Loads .env first so the gateway can use your Bedrock key. Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a; source .env; set +a
  echo "Loaded .env (Bedrock key ${AWS_BEARER_TOKEN_BEDROCK:+found})"
else
  echo "No .env found: the vault agent will answer with local search instead of Bedrock"
fi

if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi

echo "Building dashboard..."
(cd dashboard && { [ -d node_modules ] || npm install --silent; } && npm run build --silent >/dev/null)

for port in 8000 9001; do
  if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null; then
    echo "Port $port is already in use. Stop that process first (lsof -ti tcp:$port | xargs kill)."
    exit 1
  fi
done

.venv/bin/python -m uvicorn party.proxy:app --port 9001 --log-level warning &
PARTY=$!
.venv/bin/python -m uvicorn gateway.app:app --port 8000 --log-level warning &
GATEWAY=$!
trap 'kill $PARTY $GATEWAY 2>/dev/null' EXIT INT TERM

echo
echo "VendorVault dashboard: http://localhost:8000"
echo "OpenCode MCP endpoint: http://localhost:9001/agents/opencode/mcp"
echo "Press Ctrl+C to stop."
wait
