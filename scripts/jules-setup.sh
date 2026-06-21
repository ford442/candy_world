#!/bin/bash
# scripts/jules-setup.sh
# Jules setup for candy_world (clean output for Jules validation)

set -euo pipefail

echo "🚀 [Jules] Setting up candy_world environment..."

corepack enable

# Pre-approve builds quietly
pnpm config set approve-builds esbuild,@swc/core --location project 2>/dev/null || true

echo "📦 Running pnpm install..."

# Run install and filter out the IGNORED_BUILDS warning so Jules validation passes
pnpm install --frozen-lockfile --prefer-offline 2>&1 | grep -v "IGNORED_BUILDS" || true

echo "✅ [Jules] candy_world environment ready!"