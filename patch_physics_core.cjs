const fs = require('fs');

const path = 'src/systems/physics/physics-core.ts';
let code = fs.readFileSync(path, 'utf-8');

// Optimize glitch field check
const checkGlitchFieldTarget = `
    // Check if player is within active glitch grenade field
    if (uGlitchExplosionRadius.value > 0) {

        const center = uGlitchExplosionCenter.value as THREE.Vector3;
        const dx = player.position.x - center.x;
        const dy = player.position.y - center.y;
        const dz = player.position.z - center.z;
        const distSq = dx*dx + dy*dy + dz*dz;

        const radiusSq = uGlitchExplosionRadius.value * uGlitchExplosionRadius.value;
        if (distSq < radiusSq) {
            // Player is inside the glitch field - grant intangibility/phasing
            if (!player.isPhasing) {
                player.isPhasing = true;
                player.phaseTimer = 0.5; // Short duration, refreshed each frame while inside
            } else {
                // Refresh timer while inside
                player.phaseTimer = Math.max(player.phaseTimer, 0.5);
            }
        }
    }
`;

const checkGlitchFieldOptimized = `
    // Check if player is within active glitch grenade field
    // ⚡ OPTIMIZATION: Faster radius squared check
    const glitchRad = uGlitchExplosionRadius.value;
    if (glitchRad > 0) {
        const center = uGlitchExplosionCenter.value as THREE.Vector3;
        const dx = player.position.x - center.x;
        const dy = player.position.y - center.y;
        const dz = player.position.z - center.z;
        const distSq = dx*dx + dy*dy + dz*dz;

        if (distSq < glitchRad * glitchRad) {
            // Player is inside the glitch field - grant intangibility/phasing
            if (!player.isPhasing) {
                player.isPhasing = true;
                player.phaseTimer = 0.5; // Short duration, refreshed each frame while inside
            } else {
                // Refresh timer while inside
                if (player.phaseTimer < 0.5) player.phaseTimer = 0.5;
            }
        }
    }
`;

code = code.replace(checkGlitchFieldTarget, checkGlitchFieldOptimized);


const checkVineTarget = `
    for (let i = 0; i < vineSwings.length; i++) {
        const v = vineSwings[i];
        if (v !== activeVineSwing) v.update(player as any, delta, null);
    }

    if (Date.now() - lastVineDetachTime > 500) {
        checkVineAttachment(camera);
    }
`;

const checkVineOptimized = `
    // ⚡ OPTIMIZATION: Caching time to avoid multiple Date.now() calls
    const now = performance.now(); // More precise than Date.now()

    // ⚡ OPTIMIZATION: Only update vines if they are somewhat near the player.
    for (let i = 0; i < vineSwings.length; i++) {
        const v = vineSwings[i];
        if (v !== activeVineSwing) {
            // Simple distance check (e.g. 50 units) before calling update to save CPU
            if (v.anchorPoint) {
                const dx = player.position.x - v.anchorPoint.x;
                const dz = player.position.z - v.anchorPoint.z;
                if (dx*dx + dz*dz < 2500) {
                    v.update(player as any, delta, null);
                }
            } else {
                v.update(player as any, delta, null);
            }
        }
    }

    if (now - lastVineDetachTime > 500) {
        checkVineAttachment(camera);
    }
`;

code = code.replace(checkVineTarget, checkVineOptimized);


fs.writeFileSync(path, code, 'utf-8');
console.log('physics-core.ts patched');
