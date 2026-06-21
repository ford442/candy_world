#!/bin/bash
# scripts/jules-setup.sh
# Jules setup for candy_world (pnpm + WebGPU + WASM)

set -euo pipefail

echo "🚀 [Jules] Setting up candy_world environment..."

echo "🔧 Enabling corepack + pnpm install..."
corepack enable
pnpm install --frozen-lockfile --prefer-offline

# === Heavy steps intentionally left out of normal Jules setup ===
# Full WASM/Emscripten builds are slow and not needed for most code edits.
# Only run these during one-time validation or when explicitly asked:
#   pnpm run build:wasm
#   pnpm run build:emcc
#   pnpm run build

echo "✅ [Jules] candy_world environment ready!"