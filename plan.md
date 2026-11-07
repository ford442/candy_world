1. **Remove `updateBoids` from AssemblyScript and defer C++ binding.**
   - In `src/utils/wasm-loader-core.ts`, defer `cppUpdateBoids` binding until Emscripten has fully loaded inside `loadEmscriptenModule`.
   - Remove the `updateBoids` export from `assembly/index.ts`.
   - Delete the `assembly/boids.ts` file as it's being replaced by C++.
   - Add a parity test `tests/native-boids-parity.test.mjs`.
2. **Update baseline checks.**
   - Remove `updateBoids` from the Assembly baseline in `scripts/native-exports-baseline.json`.
3. **Update Documentation.**
   - Update `docs/NATIVE_LAYER.md` reflecting that `emscripten/ground.cpp` and `emscripten/discovery.cpp` are deleted, as well as `assembly/boids.ts`.
4. **Complete pre commit steps**
   - Complete pre commit steps to make sure proper testing, verifications, reviews and reflections are done.
5. **Submit the change.**
   - Submit PR with branch name `chore/remove-as-boids-twin`.
