// verification/verify_normals_on_points.js
import { createStars } from '../src/foliage/stars.js';
import { createFireflies } from '../src/foliage/fireflies.js';

export function verifyNormals() {
    const s = createStars(10);
    const f = createFireflies(5);

    const sHasNormal = !!s.geometry.attributes.normal;
    const fHasNormal = !!f.geometry.attributes.normal;

    if (!sHasNormal) return { ok: false, message: 'Stars geometry missing normal attribute' };
    if (!fHasNormal) return { ok: false, message: 'Fireflies geometry missing normal attribute' };

    return { ok: true, message: 'Stars and Fireflies have normals' };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    const res = verifyNormals();
    if (!res.ok) {
        console.error('[verify_normals_on_points] FAILED:', res.message);
        process.exitCode = 2;
    } else {
        console.log('[verify_normals_on_points] OK:', res.message);
    }
}
