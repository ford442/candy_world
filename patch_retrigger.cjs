const fs = require('fs');
const content = fs.readFileSync('src/foliage/animation.ts', 'utf8');

const search = `        // Particles - visible and jittering during retrigger
        if (particles) {
            if (particles) particles.visible = retriggerIntensity > 0.3;

            if (particles.visible && particles.geometry.attributes.position) {
                const positions = particles.geometry.attributes.position.array as Float32Array;
                for (let i = 0; i < positions.length / 3; i++) {
                    // Random jitter based on retrigger phase
                    if (phase < 0.2) {
                        positions[i * 3] += (Math.random() - 0.5) * 0.02 * retriggerIntensity;
                        positions[i * 3 + 2] += (Math.random() - 0.5) * 0.02 * retriggerIntensity;
                    }
                }
                particles.geometry.attributes.position.needsUpdate = true;
            }

            if (particles.material && (particles.material as any).opacity !== undefined) {
                (particles.material as any).opacity = 0.3 + retriggerIntensity * 0.5;
            }
        }`;

const replace = `        // Particles - visible and jittering during retrigger
        if (particles) {
            particles.visible = retriggerIntensity > 0.3;

            // ⚡ OPTIMIZATION: Early return/continue for hidden particles to avoid array modification overhead
            if (particles.visible) {
                if (particles.geometry.attributes.position) {
                    const positions = particles.geometry.attributes.position.array as Float32Array;
                    for (let i = 0; i < positions.length / 3; i++) {
                        // Random jitter based on retrigger phase
                        if (phase < 0.2) {
                            positions[i * 3] += (Math.random() - 0.5) * 0.02 * retriggerIntensity;
                            positions[i * 3 + 2] += (Math.random() - 0.5) * 0.02 * retriggerIntensity;
                        }
                    }
                    particles.geometry.attributes.position.needsUpdate = true;
                }

                if (particles.material && (particles.material as any).opacity !== undefined) {
                    (particles.material as any).opacity = 0.3 + retriggerIntensity * 0.5;
                }
            }
        }`;

if (content.includes(search)) {
    const newContent = content.replace(search, replace);
    fs.writeFileSync('src/foliage/animation.ts', newContent, 'utf8');
    console.log("Successfully patched retrigger particles");
} else {
    console.log("Could not find retrigger particles search block");
}
