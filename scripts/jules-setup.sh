#!/bin/bash
# scripts/jules-setup.sh
# Jules setup for candy_world (pnpm + WebGPU + WASM)

set -euo pipefail

echo "🚀 [Jules] Setting up candy_world environment..."

echo "🔧 Enabling corepack..."
corepack enable

# Pre-approve safe native build scripts before install (best for Jules/CI)
echo "🔧 Pre-approving esbuild and @swc/core build scripts..."
pnpm config set approve-builds esbuild,@swc/core 2>/dev/null || true

echo "📦 Running pnpm install..."
pnpm install --frozen-lockfile --prefer-offline

echo "✅ [Jules] candy_world environment ready!"