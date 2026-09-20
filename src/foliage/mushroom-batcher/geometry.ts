import * as THREE from 'three';
import { sharedGeometries } from '../index.ts';
import {
    _scratchPos,
    _scratchMatrix,
    _scratchMatrix2,
    _scratchScale,
    _scratchQuat,
    _scratchCapCenter,
    _scratchSpotScale,
    _scratchUp,
    _scratchEye,
    _scratchDummyObj
} from './constants.ts';

export function createMergedGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    let vertexOffset = 0;
    const addPart = (geo: THREE.BufferGeometry, matIndex: number, transform?: THREE.Matrix4) => {
        const posAttr = geo.attributes.position;
        const normAttr = geo.attributes.normal;
        const uvAttr = geo.attributes.uv;
        const indexAttr = geo.index;

        // ⚡ OPTIMIZATION: Scratch vector defined at module level instead of recreating in loop closure
        for (let i = 0; i < posAttr.count; i++) {
            _scratchPos.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
            if (transform) _scratchPos.applyMatrix4(transform);
            positions.push(_scratchPos.x, _scratchPos.y, _scratchPos.z);

            // Normals (assuming simple transform without non-uniform scale)
            _scratchPos.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
            if (transform) _scratchPos.transformDirection(transform);
            normals.push(_scratchPos.x, _scratchPos.y, _scratchPos.z);

            if (uvAttr) {
                uvs.push(uvAttr.getX(i), uvAttr.getY(i));
            } else {
                uvs.push(0, 0);
            }
        }

        if (indexAttr) {
            for (let i = 0; i < indexAttr.count; i++) {
                indices.push(indexAttr.getX(i) + vertexOffset);
            }
        } else {
            // Non-indexed geometry fallback
            for (let i = 0; i < posAttr.count; i++) {
                indices.push(i + vertexOffset);
            }
        }

        // Add Group
        // We push a new group for every part. InstancedMesh handles multiple groups fine.
        const count = indexAttr ? indexAttr.count : posAttr.count;
        // We defer group creation to the end, but we need to track ranges.
        // Actually, BufferGeometry groups are cumulative.

        // To simplify, we will create ONE group per material index.
        // This requires sorting or just being careful.
        // Since we add parts in order of material index, we can just track start/end.
    };

    const groups: { start: number, count: number, materialIndex: number }[] = [];
    const matIndices = [0, 1, 2, 3, 4, 5, 6, 7];
    // 0: Stem, 1: Cap, 2: Gills, 3: Spots, 4: Eye, 5: Pupil, 6: Mouth, 7: Cheek

    // Transform helpers
    // ⚡ OPTIMIZATION: Reuse scratch matrices to avoid GC spikes on every generation call
    const m = _scratchMatrix.identity();
    const q = _scratchQuat.identity(); // ⚡ OPTIMIZATION: Avoid unused allocation
    // s was unused
    const p = _scratchScale; // Use the other unused scratch vector for 'p' (position scratch)

    // 1. Stem (Material 0)
    // Unit Cylinder is centered at 0, 0.5, 0.
    let startIndex = indices.length;
    addPart(sharedGeometries.unitCylinder, 0);
    groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 0 });

    // 2. Cap (Material 1)
    // Cap sits at y=1.0 (top of stem). Radius approx 1.0.
    // Cap geometry is sphere 1.0. Center at 0,0,0.
    // We translate it up.
    startIndex = indices.length;
    m.makeTranslation(0, 0.8, 0); // Cap center slightly below top
    addPart(sharedGeometries.mushroomCap, 1, m);
    groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 1 });

    // 3. Gills (Material 2)
    startIndex = indices.length;
    // Gill is cone.
    m.makeTranslation(0, 0.8, 0);
    // ⚡ OPTIMIZATION: Re-use scratch variable to avoid GC spikes
    _scratchMatrix2.makeRotationX(Math.PI); // Flip upside down
    m.multiply(_scratchMatrix2);
    // Scale gills slightly smaller than cap
    _scratchScale.set(0.9, 0.4, 0.9);
    m.scale(_scratchScale);
    addPart(sharedGeometries.mushroomGillCenter, 2, m);
    groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 2 });

    // 4. Spots (Material 3)
    // We add a few fixed spots.
    startIndex = indices.length;
    const spotGeo = sharedGeometries.unitSphere;
    const spots = [
        { u: 0.1, v: 0.2 }, { u: 0.4, v: 0.3 }, { u: 0.7, v: 0.25 },
        { u: 0.2, v: 0.6 }, { u: 0.8, v: 0.5 }
    ];

    for (const spot of spots) {
        const theta = 2 * Math.PI * spot.u;
        const phi = Math.acos(1 - spot.v); // Upper hemisphere
        const r = 1.0; // Cap radius
        const x = Math.sin(phi) * Math.cos(theta) * r;
        const y = Math.cos(phi) * r + 0.8; // + offset
        const z = Math.sin(phi) * Math.sin(theta) * r;

        p.set(x, y, z);
        _scratchCapCenter.set(0, 0.8, 0);
        _scratchSpotScale.set(0.15, 0.05, 0.15);
        m.lookAt(p, _scratchCapCenter, _scratchUp);
        m.setPosition(p);
        m.scale(_scratchSpotScale); // Flattened on surface
        addPart(spotGeo, 3, m);
    }
    groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 3 });

    // Face Logic
    // Face Group Position relative to Stem: (0, 0.6, 0.85) (scaled stem)
    // Here we assume unit scale. Stem H=1, R=1?
    // Wait, Stem R is usually 0.15. Cap R is 0.4.
    // We are building a "Unit Mushroom" here.
    // Stem R=0.15, H=1.0. Cap R=0.4.
    // We should bake these relative scales into the merged geometry?
    // YES. Otherwise non-uniform scaling of the instance will distort the face spheres into ellipsoids.

    // Let's reset and build a "Proportional Unit Mushroom".
    // Reference: stemR ~ 0.15, stemH ~ 1.0, capR ~ 0.4.
    // We will scale the parts here.

    // RESET ARRAYS
    positions.length = 0; normals.length = 0; uvs.length = 0; indices.length = 0; groups.length = 0; vertexOffset = 0;

    const STEM_R = 0.15;
    const STEM_H = 1.0;
    const CAP_R = 0.4;
    const CAP_Y = STEM_H - (CAP_R * 0.2);

    // 1. Stem
    startIndex = indices.length;
    m.makeScale(STEM_R, STEM_H, STEM_R);
    // unitCylinder is already translated to 0.5y. So scale works.
    addPart(sharedGeometries.unitCylinder, 0, m);
    groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 0 });

    // 2. Cap
    startIndex = indices.length;
    m.makeTranslation(0, CAP_Y, 0);
    _scratchScale.set(CAP_R, CAP_R, CAP_R);
    m.scale(_scratchScale);
    addPart(sharedGeometries.mushroomCap, 1, m);
    groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 1 });

    // 3. Gills
    startIndex = indices.length;
    m.makeTranslation(0, CAP_Y, 0);
    // ⚡ OPTIMIZATION: Re-use scratch variable to avoid GC spikes
    _scratchMatrix2.makeRotationX(Math.PI);
    m.multiply(_scratchMatrix2);
    _scratchScale.set(CAP_R * 0.9, CAP_R * 0.4, CAP_R * 0.9);
    m.scale(_scratchScale);
    addPart(sharedGeometries.mushroomGillCenter, 2, m);
    groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 2 });

    // 4. Spots
    startIndex = indices.length;
    for (const spot of spots) {
        const theta = 2 * Math.PI * spot.u;
        const phi = Math.acos(1 - spot.v);
        const x = Math.sin(phi) * Math.cos(theta) * CAP_R;
        const y = Math.cos(phi) * CAP_R + CAP_Y;
        const z = Math.sin(phi) * Math.sin(theta) * CAP_R;

        p.set(x, y, z);
        m.identity();
        _scratchEye.set(0, CAP_Y, 0);
        // lookAt expects eye, target, up
        // We want the spot (at p) to face OUT from center.
        // Actually simple translation + rotation is easier.

        const spotScale = CAP_R * 0.15;
        m.makeTranslation(x, y, z);
        // Rotate to align with normal? sphere is uniform, just scale Y
        // But we need it flush.
        // Complex. Let's just place spheres.
        _scratchScale.set(spotScale, spotScale * 0.2, spotScale);
        m.scale(_scratchScale);
        // Rotate to match surface normal approx?
        // A simple lookAt from center to P gives the rotation.
        // Object local Y is up. We want Y to point along normal.
        _scratchDummyObj.position.copy(p);
        _scratchDummyObj.lookAt(_scratchEye); // Z points to eye. Y is Up.
        // We want Y to point AWAY from eye.
        // If we lookAt(eye), Z is (eye - p).
        // We want Y aligned with (p - eye).

        _scratchPos.copy(p).sub(_scratchEye);
        _scratchPos.add(p);
        _scratchDummyObj.lookAt(_scratchPos); // Look away
        _scratchDummyObj.scale.set(spotScale, spotScale, spotScale * 0.2); // Flatten Z
        _scratchMatrix.compose(_scratchDummyObj.position, _scratchDummyObj.quaternion, _scratchDummyObj.scale);
        addPart(sharedGeometries.unitSphere, 3, _scratchMatrix);
    }
    groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 3 });

    // Face Logic
    const FACE_Y = STEM_H * 0.6;
    const FACE_Z = STEM_R * 0.85; // Slightly protruding from stem
    const FACE_SCALE = 0.8; // Relative to stem

    // 5. Eyes (Material 4)
    startIndex = indices.length;
    const eyeOffset = 0.15 * FACE_SCALE;
    const eyeY = 0.1 * FACE_SCALE + FACE_Y;
    const eyeZ = 0.1 * FACE_SCALE + FACE_Z;
    const eyeScale = 0.12 * FACE_SCALE; // eyeGeo radius

    m.makeTranslation(-eyeOffset, eyeY, eyeZ);
    _scratchScale.set(1, 1, 1); // unitSphere is R=1. eyeGeo is R=0.12.
    m.scale(_scratchScale);
    // Wait, sharedGeometries.eye is R=0.12.
    // Let's use unitSphere for everything to be safe on transforms.
    _scratchScale.set(eyeScale, eyeScale, eyeScale);
    m.scale(_scratchScale);
    addPart(sharedGeometries.unitSphere, 4, m); // Left Eye

    m.makeTranslation(eyeOffset, eyeY, eyeZ);
    _scratchScale.set(eyeScale, eyeScale, eyeScale);
    m.scale(_scratchScale);
    addPart(sharedGeometries.unitSphere, 4, m); // Right Eye
    groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 4 });

    // 6. Pupils (Material 5)
    startIndex = indices.length;
    const pupilScale = 0.05 * FACE_SCALE;
    const pupilZ = eyeZ + (eyeScale * 0.8); // Protrude
    m.makeTranslation(-eyeOffset, eyeY, pupilZ);
    _scratchScale.set(pupilScale, pupilScale, pupilScale);
    m.scale(_scratchScale);
    addPart(sharedGeometries.unitSphere, 5, m);

    m.makeTranslation(eyeOffset, eyeY, pupilZ);
    _scratchScale.set(pupilScale, pupilScale, pupilScale);
    m.scale(_scratchScale);
    addPart(sharedGeometries.unitSphere, 5, m);
    groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 5 });

    // 7. Mouth (Material 6)
    startIndex = indices.length;
    m.makeTranslation(0, FACE_Y - 0.05 * FACE_SCALE, FACE_Z + 0.1 * FACE_SCALE);
    // ⚡ OPTIMIZATION: Re-use scratch variable to avoid GC spikes
    _scratchMatrix2.makeRotationZ(Math.PI);
    m.multiply(_scratchMatrix2); // Smile
    _scratchScale.set(FACE_SCALE, FACE_SCALE, FACE_SCALE);
    m.scale(_scratchScale);
    addPart(sharedGeometries.mushroomSmile, 6, m);
    groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 6 });

    // 8. Cheeks (Material 7)
    startIndex = indices.length;
    const cheekX = 0.25 * FACE_SCALE;
    const cheekScaleX = 0.08 * FACE_SCALE;
    const cheekScaleY = 0.048 * FACE_SCALE;
    const cheekZ = FACE_Z + 0.05 * FACE_SCALE;

    m.makeTranslation(-cheekX, FACE_Y, cheekZ);
    _scratchScale.set(cheekScaleX, cheekScaleY, cheekScaleX);
    m.scale(_scratchScale);
    addPart(sharedGeometries.unitSphere, 7, m);

    m.makeTranslation(cheekX, FACE_Y, cheekZ);
    _scratchScale.set(cheekScaleX, cheekScaleY, cheekScaleX);
    m.scale(_scratchScale);
    addPart(sharedGeometries.unitSphere, 7, m);
    groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 7 });

    // Final Geometry
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    for (let i = 0; i < groups.length; i++) { geo.addGroup(groups[i].start, groups[i].count, groups[i].materialIndex); }

    return geo;
}
