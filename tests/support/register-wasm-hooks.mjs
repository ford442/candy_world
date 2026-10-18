import { register } from 'node:module';
// Registered after css-hooks so this resolve runs first for `.wasm?init`.
register('./css-hooks.mjs', import.meta.url);
register('./wasm-init-hooks.mjs', import.meta.url);
