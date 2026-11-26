#!/usr/bin/env bash
# Builds seo-advisor.mcpb: a one-click Claude Desktop extension. Production dependencies only; no credentials.
set -euo pipefail
cd "$(dirname "$0")"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R server.mjs src manifest.json package.json package-lock.json README.md LICENSE "$STAGE"/
(cd "$STAGE" && npm ci --omit=dev --silent)
npx --yes @anthropic-ai/mcpb@2.1.2 validate "$STAGE/manifest.json"
npx --yes @anthropic-ai/mcpb@2.1.2 pack "$STAGE" seo-advisor.mcpb
ls -lh seo-advisor.mcpb
