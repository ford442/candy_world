// src/systems/awakened/index.ts
// Awakened flora persistence: the public, eagerly-loaded surface.
//
// `awakened-persistence.ts` is deliberately NOT re-exported. It is the feature's
// own lazy chunk (`awakened`, see vite.config.js); `awakened-persistence-api.ts`
// is the thin `app`-side stub that reaches it through a dynamic import. Pulling
// it into this barrel would make every importer of the barrel a static
// dependent of that chunk.
//
// Code inside this folder imports its siblings directly, never this file.

export * from './awakened-persistence-api.ts';
export * from './awakened-persistent-id.ts';
export * from './awakened-resolve.ts';
export * from './awakened-types.ts';
