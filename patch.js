const fs = require('fs');
let code = fs.readFileSync('src/foliage/animation.ts', 'utf8');
code = code.replace(
    `export function updateFoliageMaterials(
    offset: number,
    isDaytime: boolean,
    audioData: any,
    deltaTime: number,
    state: string
) {
    const time = performance.now() * 0.001;`,
    `export let _dayResetMatCount = 0; // Exported for metrics only

export function updateFoliageMaterials(
    offset: number,
    isDaytime: boolean,
    audioData: any,
    deltaTime: number,
    state: string
) {
    // ⚡ OPTIMIZATION: Early out if daytime and nothing to reset, to bypass O(N) array iteration
    const foliageNeedsFadeBack = _dayResetMatCount > 0;
    if (isDaytime && !audioData && state === 'default' && !foliageNeedsFadeBack) {
        return; // Nothing to update or fade out.
    }
    _dayResetMatCount = 0;

    const time = performance.now() * 0.001;`
);

code = code.replace(
    `        if (shouldReset) {
            if (activeMaterial.emissiveIntensity > 0.01) {
                // Smoothly fade back to default emissive
                activeMaterial.emissiveIntensity = Math.max(
                    0,
                    activeMaterial.emissiveIntensity - deltaTime * 2.0
                );
            }
        }`,
    `        if (shouldReset) {
            if (activeMaterial.emissiveIntensity > 0.01) {
                // Smoothly fade back to default emissive
                activeMaterial.emissiveIntensity = Math.max(
                    0,
                    activeMaterial.emissiveIntensity - deltaTime * 2.0
                );
                _dayResetMatCount++; // Needs to fade back next frame too
            }
        }`
);

fs.writeFileSync('src/foliage/animation.ts', code);
