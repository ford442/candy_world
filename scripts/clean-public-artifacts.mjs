#!/usr/bin/env node
/**
 * Remove stale build artifacts from public/ before a Vite build.
 *
 * The AssemblyScript module is bundled from src/wasm/ via `?init`; old copies
 * of it under public/ (from earlier build setups) are never loaded but Vite
 * copies everything in public/ into dist/, so they ship ~400 KB of dead bytes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STALE = ['candy_physics.wasm', 'candy_physics.wasm.map', 'candy_physics.wat'];

for (const name of STALE) {
    const file = path.join(publicDir, name);
    if (fs.existsSync(file)) {
        fs.rmSync(file);
        console.log(`[clean] removed stale public/${name}`);
    }
}
