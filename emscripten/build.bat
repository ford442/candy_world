@echo off
REM Build script for Candy World Emscripten WASM module
REM Run this after activating emsdk: emsdk_env.bat

echo Building candy_native.wasm (Standalone WASM)...

emcc candy_native.c -o ../public/candy_native.wasm ^
    -O3 ^
    -s STANDALONE_WASM=1 ^
    -s WASM=1 ^
    --no-entry ^
    -s EXPORTED_FUNCTIONS="['_hash', '_valueNoise2D', '_fbm', '_fastInvSqrt', '_fastDistance', '_batchDistances', '_batchSinWave', '_malloc', '_free']" ^
    -s ERROR_ON_UNDEFINED_SYMBOLS=0

if %ERRORLEVEL% EQU 0 (
    echo Build successful! Output: public/candy_native.wasm
) else (
    echo Build failed with error code %ERRORLEVEL%
)
