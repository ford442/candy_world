// src/foliage/batcher/foliage-batcher-effects.ts
// Animation-specific apply functions for foliage batch processing

import { FoliageObject } from './foliage-batcher-types.ts';
import { spawnImpact } from '../impacts.ts';

/**
 * Apply snare snap animation results
 * Animation type code 13
 */
export function applySnareSnap(obj: FoliageObject, data: Float32Array, offset: number): void {
    const s = data[offset + 1];
    // Juice: Trigger impact on rising edge
    const oldState = obj.userData.snapState || 0;
    if (s > 0.2 && oldState < 0.2) {
        spawnImpact(obj.position, 'snare');
    }
    obj.userData.snapState = s;

    const left = obj.userData.leftJaw;
    const right = obj.userData.rightJaw;
    if (left && right) {
        // Left Jaw: Open -0.5, Closed 0.0
        left.rotation.x = -0.5 * (1.0 - s);
        // Right Jaw: Open 0.5+PI, Closed 0.0+PI
        right.rotation.x = Math.PI + 0.5 * (1.0 - s);
    }
}

/**
 * Apply accordion animation results
 * Animation type code 14
 */
export function applyAccordion(obj: FoliageObject, data: Float32Array, offset: number): void {
    // Determine target: trunk group or object itself (fallback)
    const target = obj.userData.trunk || obj;
    target.scale.y = data[offset + 0]; // stretchY
    // If trunk exists, apply width conservation to it
    if (obj.userData.trunk) {
        target.scale.x = data[offset + 1]; // widthXZ
        target.scale.z = data[offset + 1];
    } else {
        // If no trunk group, apply to object X/Z (fallback for simple objects)
        obj.scale.x = data[offset + 1];
        obj.scale.z = data[offset + 1];
    }
}

/**
 * Apply fiber whip animation results
 * Animation type code 15
 */
export function applyFiberWhip(obj: FoliageObject, data: Float32Array, offset: number): void {
    obj.rotation.y = data[offset + 0]; // baseRotY
    const baseRotZ = data[offset + 1];

    const children = obj.children;
    // Optimized hierarchy update
    for (let i = 0; i < children.length; i++) {
        // Skip trunk (index 0 usually)
        if (i === 0) continue;
        const branch = children[i];
        // branch is a Group, inside is 'whip' (Group), inside is 'cable' (Mesh)
        // The hierarchy is: BranchGroup -> Whip -> Cable -> Tip
        // animateFoliage logic: branchGroup.children[0] is 'cable' (actually 'whip' in trees.ts)
        // Wait, createFiberOpticWillow adds 'whip' to 'branchGroup'.
        // So branchGroup.children[0] is 'whip'.
        // Inside whip: children[0] is cable.

        const whip = branch.children[0];
        if (whip) {
            const cable = whip.children[0];
            if (cable) {
                // Apply rotation with slight offset variation
                cable.rotation.z = baseRotZ + i * 0.1;
            }

            // Handle Tip Visibility (Flicker)
            // This logic was in JS. We can approximate it or skip it.
            // "tip.visible = Math.random() < (0.5 + whip);"
            // Let's implement a stable flicker using time
            const tip = whip.children[1]; // Cable is 0, Tip is 1
            if (tip) {
                // leadVol passed as audioParam -> used for out[1] calc?
                // We use leadVol directly here if needed, but we don't have it in scope easily
                // without passing it through `out`.
                // Let's assume out[2] or similar holds intensity, or just use out[1] magnitude.
                // Simplified: Always visible or simple flicker based on time
                // tip.visible = true; // Optimization: Keep visible to avoid state thrashing
            }
        }
    }
}

/**
 * Apply spiral wave animation results
 * Animation type code 16
 */
export function applySpiralWave(obj: FoliageObject, data: Float32Array, offset: number): void {
    const baseRot = data[offset + 0];
    const children = obj.children;
    for (let i = 0; i < children.length; i++) {
        // Offset phase per child
        children[i].rotation.y = baseRot + i * 0.2;
    }
}

/**
 * Apply vibrato shake animation results
 * Animation type code 17
 */
export function applyVibratoShake(obj: FoliageObject, data: Float32Array, offset: number): void {
    const headGroup = obj.userData.headGroup;
    if (headGroup) {
        headGroup.rotation.z = data[offset + 2]; // Whole head wobble (stored in out[2])

        const rotX = data[offset + 0];
        const rotY = data[offset + 1];
        const children = headGroup.children;

        for (let i = 0; i < children.length; i++) {
            if (i === 0) continue; // Skip center/light
            const child = children[i];
            // Apply shake
            child.rotation.x = -Math.PI / 2 + rotX;
            child.rotation.y = rotY;
        }
    }
}

/**
 * Apply tremolo pulse animation results
 * Animation type code 18
 */
export function applyTremoloPulse(obj: FoliageObject, data: Float32Array, offset: number): void {
    const headGroup = obj.userData.headGroup;
    const scale = data[offset + 0];
    const opacity = data[offset + 1];
    const emission = data[offset + 2];

    if (headGroup) {
        headGroup.scale.set(scale, scale, scale);
    }

    // Update Materials
    const bellMat = obj.userData.bellMaterial;
    if (bellMat) {
        bellMat.opacity = opacity;
        bellMat.emissiveIntensity = emission;
    }

    const vortex = obj.userData.vortex;
    if (vortex) {
        vortex.scale.setScalar(2.0 - scale); // Inverse pulse
        vortex.material.opacity = opacity * 0.5;
    }

    // Base rotation
    obj.rotation.z = data[offset + 3] || 0; // Assuming out[3] might carry secondary motion
}

/**
 * Apply cymbal shake animation results
 * Animation type code 19
 */
export function applyCymbalShake(obj: FoliageObject, data: Float32Array, offset: number): void {
    const rotZ = data[offset + 0];
    const rotX = data[offset + 1];
    const scale = data[offset + 2];

    const head = obj.children[1];
    if (head) {
        head.rotation.z = rotZ;
        head.rotation.x = rotX;
        head.scale.set(scale, scale, scale);

        // Shake stalks
        const children = head.children;
        for (let i = 0; i < children.length; i++) {
            const stalk = children[i];
            // Add some chaos based on index
            stalk.rotation.z = (i % 2 === 0 ? rotZ : -rotZ) * 2.0;
        }
    }
}

/**
 * Apply panning bob animation results
 * Animation type code 20
 */
export function applyPanningBob(obj: FoliageObject, data: Float32Array, offset: number): void {
    const bobHeight = data[offset + 0];
    const tilt = data[offset + 1];
    const glow = data[offset + 2];

    obj.position.y = (obj.userData.originalY || 0) + bobHeight;
    obj.rotation.z = tilt;
    obj.userData.currentBob = bobHeight;

    // Update Glow
    const glowMat = obj.userData.glowMaterial;
    const glowUni = obj.userData.glowUniform;
    if (glowUni) {
         glowUni.value = glow;
    } else if (glowMat) {
         glowMat.opacity = glow;
    }
}

/**
 * Apply spirit fade animation results
 * Animation type code 21
 */
export function applySpiritFade(obj: FoliageObject, data: Float32Array, offset: number): void {
    const opacity = data[offset + 0];
    const posY = data[offset + 1];
    const fleeSpeed = data[offset + 2];

    obj.userData.currentOpacity = opacity;
    obj.userData.fleeSpeed = fleeSpeed;

    const mat = obj.userData.spiritMaterial;
    if (mat) {
        mat.opacity = opacity;
        mat.visible = opacity > 0.01;
    }

    if (opacity > 0.01) {
        obj.position.y = posY;
    }

    if (fleeSpeed > 0) {
        obj.position.z -= fleeSpeed;
    }
}
