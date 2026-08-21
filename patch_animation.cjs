const fs = require('fs');
const content = fs.readFileSync('src/foliage/animation.ts', 'utf8');

const search = `    // Fast path: skip material updates if no reactive meshes
    if (reactive && reactive.length > 0) {
        // Check if any child has active flash or needs fade back to avoid unnecessary iteration
        let hasActiveFlash = false;
        let needsFadeBack = false;
        for (let i = 0; i < reactive.length; i++) {
            const child = reactive[i];
            if ((child.userData.flashIntensity || 0) > 0) {
                hasActiveFlash = true;
            }
            if (child.userData._needsFadeBack) {
                needsFadeBack = true;
            }
            if (hasActiveFlash && needsFadeBack) break; // Early exit if we found both
        }

        // Only update materials if there's an active flash or we need to fade back
        if (hasActiveFlash || needsFadeBack) {
            for (let i = 0; i < reactive.length; i++) {
                const child = reactive[i];
                const fi = child.userData.flashIntensity || 0;
                const decay = child.userData.flashDecay ?? 0.05;`;

const replace = `    // Fast path: skip material updates if no reactive meshes
    if (reactive && reactive.length > 0) {
        for (let i = 0; i < reactive.length; i++) {
            const child = reactive[i];
            const fi = child.userData.flashIntensity || 0;
            const needsFadeBack = child.userData._needsFadeBack;

            // ⚡ OPTIMIZATION: Zero-work early continue for inactive objects to skip property lookups and material iteration
            if (fi <= 0 && !needsFadeBack) continue;

            const decay = child.userData.flashDecay ?? 0.05;`;

if (content.includes(search)) {
    const newContent = content.replace(search, replace).replace(`                    // Clear fade back flag when all materials have returned to base
                    if (allFadedBack) {
                        child.userData._needsFadeBack = false;
                    }
                }
            }
        }
    }`, `                    // Clear fade back flag when all materials have returned to base
                    if (allFadedBack) {
                        child.userData._needsFadeBack = false;
                    }
                }
        }
    }`);
    fs.writeFileSync('src/foliage/animation.ts', newContent, 'utf8');
    console.log("Successfully patched animation.ts");
} else {
    console.log("Could not find search block");
}
