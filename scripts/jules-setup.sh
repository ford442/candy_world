#!/bin/bash
# scripts/jules-setup.sh
# Jules setup for candy_world (pnpm + WebGPU + WASM)

set -euo pipefail

echo "🚀 [Jules] Setting up candy_world environment..."

echo "🔧 Enabling corepack + pnpm install..."
corepack enable
pnpm install --frozen-lockfile --prefer-offline

# Fix pnpm ignored builds warning (esbuild + swc are safe and needed)
echo "🔧 Approving pnpm build scripts for esbuild and @swc/core..."
pnpm approve-builds esbuild @swc/core 2>/dev/null || true

echo "✅ [Jules] candy_world environment ready!"