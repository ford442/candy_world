// verification/verify_spawn_subwoofer_lotus.js
// Simple verification test to ensure createSubwooferLotus spawns without throwing

import * as THREE from 'three';
import { createSubwooferLotus } from '../src/foliage/flowers.js';
import { fileURLToPath } from 'url';

export function verifySpawnSubwooferLotus() {
    try {
        const obj = createSubwooferLotus({ color: 0x2E8B57 });
        if (!obj || typeof obj !== 'object') throw new Error('createSubwooferLotus returned invalid object');
        if (!obj.userData || obj.userData.type !== 'lotus') throw new Error('spawned object missing expected userData.type');
        // Basic shape checks
        const hasPad = obj.children && obj.children.length > 0;
        if (!hasPad) throw new Error('spawned lotus missing pad child');
        return { ok: true, message: 'createSubwooferLotus created a valid object' };
    } catch (err) {
        return { ok: false, message: String(err) };
    }
}

// If run directly, print result (ESM-friendly)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const res = verifySpawnSubwooferLotus();
    if (!res.ok) {
        console.error('[verify_spawn_subwoofer_lotus] FAILED:', res.message);
        process.exitCode = 2;
    } else {
        console.log('[verify_spawn_subwoofer_lotus] OK:', res.message);
    }
}
