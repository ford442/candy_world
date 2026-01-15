# Candy World Setup Guide

## Prerequisites

### Required Software
- **Node.js** 16+ and npm
- **Python** 3.x (for verification scripts)
- **Git**

### Optional Software (for Native Module Build)
- **Emscripten SDK** (for C++ WASM compilation)
- **AssemblyScript** (automatically installed via npm)
- **wasm-opt** (for WASM optimization, part of Binaryen)

## Quick Start

For basic development without native module optimization:

```bash
npm install
npm run dev
```

This will:
1. Build the AssemblyScript physics WASM module
2. Skip the Emscripten C++ build (falls back to JavaScript)
3. Start the Vite development server

## Full Build Setup (with Emscripten)

To enable the native C++ performance optimizations, you need to install Emscripten:

### 1. Install Emscripten SDK

```bash
# Clone the emsdk repository
git clone https://github.com/emscripten-core/emsdk.git

# Enter the directory
cd emsdk

# Install the latest SDK tools
./emsdk install latest

# Activate the latest SDK
./emsdk activate latest

# Add emsdk to PATH (add this to your ~/.bashrc or ~/.zshrc)
source ./emsdk_env.sh
```

### 2. Verify Installation

```bash
em++ --version
```

You should see output showing the Emscripten compiler version.

### 3. Build All Modules

```bash
npm run build
```

This will:
1. Build AssemblyScript physics WASM (`candy_physics.wasm`)
2. Build C++ native WASM (`candy_native.wasm` and `candy_native.js`)
3. Optimize WASM files (if wasm-opt is available)
4. Build the Vite production bundle

## Development Workflow

### Standard Development (JavaScript Fallback)

```bash
npm run dev
```

The system will gracefully fall back to JavaScript implementations for any functions that would normally be in the native module.

### With Native Module (Performance Mode)

```bash
# Ensure emscripten is in PATH
source emsdk/emsdk_env.sh

# Run dev script (includes native build)
bash dev.sh
```

## Build Scripts

- `npm run dev` - Start development server (builds AssemblyScript only)
- `npm run build:wasm` - Build AssemblyScript physics module
- `npm run build:emcc` - Build C++ native module (requires emscripten)
- `npm run optimize` - Optimize WASM files (requires wasm-opt)
- `npm run build` - Full production build
- `npm run preview` - Preview production build

## Testing

```bash
# Run verification tests
npm run test

# Test WASM loader
npm run test:wasm

# Verify Emscripten exports
npm run verify:emcc
```

## Troubleshooting

### "em++ not found"

The C++ native module build requires Emscripten. If you see this warning:
```
Warning: em++ not found in PATH. Skipping EMCC build.
```

This is expected if you haven't installed Emscripten. The system will use JavaScript fallbacks for animation functions. To enable native optimization, install Emscripten (see "Full Build Setup" above).

### Build fails with WASM errors

Try cleaning and rebuilding:
```bash
rm -rf public/*.wasm public/candy_native.js
npm run build
```

### WebGPU not available

Candy World requires a browser with WebGPU support:
- Chrome 113+
- Edge 113+
- Other browsers with WebGPU flag enabled

## Architecture Notes

### Hybrid WASM System

The project uses two WASM modules:

1. **AssemblyScript Module** (`candy_physics.wasm`)
   - Stateful physics and collision detection
   - Always built (required for the app to function)

2. **Emscripten/C++ Module** (`candy_native.wasm`)
   - Stateless compute functions (math, animations)
   - Optional - graceful JavaScript fallbacks exist
   - Provides performance benefits for animation-heavy scenes

### Migration Strategy

The project follows a "15% Rule" for optimization:
- Not all functions need to be in C++
- Migrate only performance-critical hotspots
- Keep JavaScript layer for rapid prototyping

For more details, see `PERFORMANCE_MIGRATION_STRATEGY.md`.

## File Locations

- **Source Code**: `src/`, `main.js`
- **WASM Source**: `assembly/` (AssemblyScript), `emscripten/` (C++)
- **Build Output**: `public/` (WASM files), `dist/` (production build)
- **Assets**: `assets/`, `public/`

## CI/Deployment Notes

For deployment pipelines:

1. **Minimal Build** (JavaScript fallback):
   ```bash
   npm install
   npm run build:wasm
   vite build
   ```

2. **Full Build** (with native module):
   ```bash
   npm install
   # Install emscripten in CI environment
   npm run build
   ```

The build system gracefully handles missing emscripten by skipping the C++ build step.
