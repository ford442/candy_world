const fs = require('fs');

// Patch index.ts
let indexContent = fs.readFileSync('src/systems/photo-mode/index.ts', 'utf8');
indexContent = indexContent.replace(/export { PhotoControlsOverlay, type PhotoControlValues } from '\.\/photo-controls\.ts';\n?/, '');
fs.writeFileSync('src/systems/photo-mode/index.ts', indexContent);

// Patch photo-mode.ts
let pmContent = fs.readFileSync('src/systems/photo-mode/photo-mode.ts', 'utf8');
pmContent = pmContent.replace(
    /import { PhotoControlsOverlay, type PhotoControlValues } from '\.\/photo-controls\.ts';/,
    "import type { PhotoControlsOverlay, PhotoControlValues } from './photo-controls.ts';"
);

pmContent = pmContent.replace(
    /this\.overlay = new PhotoControlsOverlay\(\{/,
    "const { PhotoControlsOverlay } = await import('./photo-controls.ts');\n\n        this.overlay = new PhotoControlsOverlay({"
);
fs.writeFileSync('src/systems/photo-mode/photo-mode.ts', pmContent);

// Patch game-loop.ts
let content = fs.readFileSync('src/core/game-loop.ts', 'utf8');

if (!content.includes("isPhotoModeActive")) {
    content = content.replace(
        "import { getPhotoMode } from '../systems/photo-mode/index.ts';",
        "import { getPhotoMode, isPhotoModeActive } from '../systems/photo-mode/index.ts';"
    );
}

content = content.replace(
    /updateFoliagePhase\([\s\S]*?dayNightBias\n    \);/,
    `if (!isPhotoModeActive()) {
        updateFoliagePhase(
            delta,
            audioState,
            visualsState.isNightNow,
            visualsState.weatherStateStr,
            visualsState.weatherIntensity,
            visualsState.dayNightBias
        );
    }`
);

content = content.replace(
    /updateParticlesPhase\([\s\S]*?\+ 0\.1 \/\/ deep night start approx, exact logic is in config\n    \);/,
    `if (!isPhotoModeActive()) {
        updateParticlesPhase(
            delta,
            gt + timeOffsetRef.value,
            audioState,
            visualsState.isNightNow,
            visualsState.cyclePos >= 0.2 + 0.3 + 0.1 + 0.1 // deep night start approx, exact logic is in config
        );
    }`
);

content = content.replace(
    /updateComputePhase\(\);\n    tickComputeOrchestrator\(\);\n\n    updateImpacts\(rendererRef, gt \+ timeOffsetRef\.value\);\n    updateDandelionSeeds\(rendererRef\);\n    updateFaunaSystem\(delta, gt \+ timeOffsetRef\.value\);/,
    `if (!isPhotoModeActive()) {
        updateComputePhase();
        tickComputeOrchestrator();

        updateImpacts(rendererRef, gt + timeOffsetRef.value);
        updateDandelionSeeds(rendererRef);
        updateFaunaSystem(delta, gt + timeOffsetRef.value);
    }`
);

content = content.replace(
    /updatePhysicsPhase\(delta, devOrbitActive, audioState\);/,
    `if (!isPhotoModeActive()) {
        updatePhysicsPhase(delta, devOrbitActive, audioState);
    }`
);

content = content.replace(
    /updateGameplayPhase\(delta, gt \+ timeOffsetRef\.value, exploreActive, audioState\);/,
    `if (!isPhotoModeActive()) {
        updateGameplayPhase(delta, gt + timeOffsetRef.value, exploreActive, audioState);
    }`
);

fs.writeFileSync('src/core/game-loop.ts', content);

// Patch photo-capture.ts
let captureContent = fs.readFileSync('src/systems/photo-mode/photo-capture.ts', 'utf8');

const captureReplace = `
    try {
        options.renderFrame();

        // Wait for WebGPU queue to submit rendering work before capturing
        const backend = (renderer as any).backend;
        if (backend?.device?.queue?.onSubmittedWorkDone) {
            await backend.device.queue.onSubmittedWorkDone();
        }

        let dataUrl = renderer.domElement.toDataURL('image/png');
`;

captureContent = captureContent.replace(
    /try \{\n        options\.renderFrame\(\);\n        let dataUrl = renderer\.domElement\.toDataURL\('image\/png'\);/,
    captureReplace
);

fs.writeFileSync('src/systems/photo-mode/photo-capture.ts', captureContent);

// Patch docs
let docsContent = fs.readFileSync('docs/archive/IMPLEMENTATION_PLAN_MUSICAL_ECOSYSTEM.md', 'utf8');
docsContent += `\n1. **#1356 Cinematic Photo Mode** (Status: In Progress ⏳)\n   - *Implementation Details:* Pending UI scaffolding and canvas capture logic.\n`;
fs.writeFileSync('docs/archive/IMPLEMENTATION_PLAN_MUSICAL_ECOSYSTEM.md', docsContent);

let planContent = fs.readFileSync('weekly_plan.md', 'utf8');
const itemsToMarkDone = ["1448", "1352", "1353", "1450", "1451"];
const doneHeader = "## Done\n<!--\nCompleted items, routine archives here with date.\nPrune occasionally when this gets long.\n-->\n";
let replacement = doneHeader;
for (const id of itemsToMarkDone) {
    replacement += `- [x] **#${id}** — Marked as complete based on codebase state.\n`;
}
if (!planContent.includes(`- [x] **#1448**`)) {
    planContent = planContent.replace(doneHeader, replacement);
}
for (const id of itemsToMarkDone) {
    const regex = new RegExp(`- \\[ \\] \\*\\*#${id}`, 'g');
    planContent = planContent.replace(regex, `- [x] **#${id}`);
    const regex2 = new RegExp(`- \\[~\\] \\*\\*#${id}`, 'g');
    planContent = planContent.replace(regex2, `- [x] **#${id}`);
}
fs.writeFileSync('weekly_plan.md', planContent);
