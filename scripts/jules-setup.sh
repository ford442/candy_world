#!/bin/bash
# scripts/jules-setup.sh
# Jules setup for candy_world

set -euo pipefail

echo "🚀 [Jules] Setting up candy_world environment..."

corepack enable

echo "🔧 Pre-approving build scripts..."
pnpm config set approve-builds esbuild,@swc/core 2>/dev/null || true

echo "📦 Running pnpm install..."
pnpm install --frozen-lockfile --prefer-offline

# Extra approval pass after install (helps in some environments)
pnpm approve-builds esbuild @swc/core --yes 2>/dev/null || true

echo "✅ [Jules] candy_world environment ready!"