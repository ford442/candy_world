# Vendored OpenMP for Emscripten builds

`libomp.a` is a prebuilt LLVM OpenMP static archive for the wasm32 Emscripten
target. `emscripten/build.sh` links it via `-L$SCRIPT_DIR/vendor -lomp`.

Kept tracked (with a `.gitignore` exception for `!emscripten/vendor/libomp.a`)
because the archive is not currently regenerated from the toolchain in CI.
See `emscripten/REFACTORING_README.md` and `docs/archive/libomp.md`.
