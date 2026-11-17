#!/bin/bash
# =============================================================================
# Garden DSP module: emscripten/dsp/*.cpp -> public/candy_dsp.wasm
# =============================================================================
#
# A second, separate C++ module for the garden AudioWorklet
# (src/audio/worklet/garden-processor.ts). It must load inside
# AudioWorkletGlobalScope, which has no fetch, no importScripts and no Worker,
# so it is a standalone wasm: no JS glue, no imports, one exported memory that
# never grows, single-threaded (no -pthread, no SHARED_MEMORY, no OpenMP).
# The main thread fetches the bytes and posts them to the worklet.
#
# The ABI is every EMSCRIPTEN_KEEPALIVE function in emscripten/dsp/*.cpp (all
# named dsp_*). scripts/check-dsp-wasm.mjs checks the linked binary against it;
# check:native-exports checks every export has a caller and every lookup a
# definition. Flags are the toolchain contract in AGENTS.md ("Garden DSP
# module"); `npm run verify:emcc:manifest` fails if the two disagree.
#
# Without em++ this removes any stale public/candy_dsp.wasm and exits 0: the
# generative soundtrack then plays through SynthVoice (Web Audio nodes).
#
# Environment:
#   CANDY_STRICT_EMSDK=1  fail if em++ differs from .emsdk-version (default: warn)
#   SKIP_VERIFY=1         skip the post-link ABI check (default: 0)
# =============================================================================

set -uo pipefail

CANDY_STRICT_EMSDK="${CANDY_STRICT_EMSDK:-0}"
SKIP_VERIFY="${SKIP_VERIFY:-0}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_WASM="$REPO_ROOT/public/candy_dsp.wasm"

echo "=========================================="
echo "Candy World Garden DSP build"
echo "=========================================="

for LOC in "/app/emsdk/emsdk_env.sh" "/content/build_space/emsdk/emsdk_env.sh" \
    "$HOME/emsdk/emsdk_env.sh" "$REPO_ROOT/../emsdk/emsdk_env.sh" \
    "/opt/emsdk/emsdk_env.sh" "/usr/local/emsdk/emsdk_env.sh"; do
    if ! command -v em++ >/dev/null 2>&1 && [ -f "$LOC" ]; then
        echo "[INFO] Sourcing $LOC"
        source "$LOC" >/dev/null 2>&1 || true
    fi
done

if ! command -v em++ >/dev/null 2>&1; then
    echo "[WARN] em++ not found: skipping the garden DSP module (SynthVoice fallback)."
    rm -f "$OUTPUT_WASM"
    exit 0
fi

PINNED_EMSDK="$(tr -d '[:space:]' < "$REPO_ROOT/.emsdk-version" 2>/dev/null)"
ACTUAL_EMSDK="$(em++ --version 2>/dev/null | head -n1 | sed -E 's/.* ([0-9]+\.[0-9]+\.[0-9]+).*/\1/')"
if [ -n "$PINNED_EMSDK" ] && [ "$PINNED_EMSDK" != "$ACTUAL_EMSDK" ]; then
    echo "[WARN] em++ is $ACTUAL_EMSDK but .emsdk-version pins $PINNED_EMSDK"
    if [ "$CANDY_STRICT_EMSDK" = "1" ]; then
        echo "[ERROR] CANDY_STRICT_EMSDK=1: refusing to build with an unpinned emsdk"
        exit 1
    fi
fi

# Compile: -O2 like candy_native (one level for every C++ artifact), SIMD128
# without relaxed SIMD, no exceptions/RTTI. No -ffast-math: the engine's NaN
# guards (finitef) need IEEE semantics. No -pthread / -fopenmp / -matomics:
# AudioWorkletGlobalScope cannot spawn threads, and the module must not need
# cross-origin isolation.
DSP_COMPILE_FLAGS="-O2 -flto -std=c++17 -fno-exceptions -fno-rtti -msimd128"

# Link: standalone reactor (--no-entry), no JS glue, no filesystem, a fixed
# 2MB memory (every buffer is static; ~0.9MB of it is data) and a 64KB stack
# (nothing recurses; the biggest frame is the 8KB due-event buffer, which is
# static too). ERROR_ON_UNDEFINED_SYMBOLS=1: an import would make the module
# unloadable in the worklet, so it is a link error here.
DSP_LINK_FLAGS="-O2 -flto -msimd128 --no-entry -s STANDALONE_WASM=1 -s FILESYSTEM=0 \
-s ALLOW_MEMORY_GROWTH=0 -s INITIAL_MEMORY=2MB -s STACK_SIZE=64KB -s ERROR_ON_UNDEFINED_SYMBOLS=1"

rm -f "$OUTPUT_WASM"
mkdir -p "$(dirname "$OUTPUT_WASM")"

# shellcheck disable=SC2086
if ! em++ "$SCRIPT_DIR"/*.cpp $DSP_COMPILE_FLAGS $DSP_LINK_FLAGS -o "$OUTPUT_WASM"; then
    echo "[ERROR] Garden DSP build failed (see the em++ output above)."
    rm -f "$OUTPUT_WASM"
    exit 1
fi

echo "[OK] public/candy_dsp.wasm ($(stat -c%s "$OUTPUT_WASM" 2>/dev/null || stat -f%z "$OUTPUT_WASM") bytes)"

if [ "$SKIP_VERIFY" != "1" ]; then
    if ! node "$REPO_ROOT/scripts/check-dsp-wasm.mjs" "$OUTPUT_WASM"; then
        rm -f "$OUTPUT_WASM"
        exit 1
    fi
fi
