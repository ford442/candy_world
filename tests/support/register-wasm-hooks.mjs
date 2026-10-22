import { register } from 'node:module';

// ----------------------------------------------------------------------------
// The root cause of the "initCandyPhysics is not a function" under `tsx` is that
// `tsx` intercepts all imports, including the `.wasm?init` we use in tests.
// `tsx` ends up resolving `candy_physics.wasm` as an empty object `{}`.
//
// When running `node --import ./tests/support/register-wasm-hooks.mjs`, our hook
// runs before Node's default resolution, returning the custom initialization wrapper.
// But under `tsx --import ...`, `tsx`'s loader is already active.
//
// To bypass `tsx` entirely for `.wasm?init` modules, we must ensure our hook
// returns `shortCircuit: true` so that subsequent loaders (like `tsx`) ignore it.
// ----------------------------------------------------------------------------

register('./wasm-init-hooks.mjs', import.meta.url);
