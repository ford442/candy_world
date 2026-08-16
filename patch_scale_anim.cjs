const fs = require('fs');
const content = fs.readFileSync('src/foliage/animation.ts', 'utf8');

const search = `    // --- Mushroom Scale Animation (from note bounce) ---
    // Animate scale back to base after note trigger (replaces setTimeout)
    if (foliageObject.userData.scaleAnimStart) {
        const elapsed = Date.now() - foliageObject.userData.scaleAnimStart;`;

const replace = `    // --- Mushroom Scale Animation (from note bounce) ---
    // Animate scale back to base after note trigger (replaces setTimeout)
    if (foliageObject.userData.scaleAnimStart) {
        const elapsed = performance.now() - foliageObject.userData.scaleAnimStart;`;

if (content.includes(search)) {
    const newContent = content.replace(search, replace);
    fs.writeFileSync('src/foliage/animation.ts', newContent, 'utf8');
    console.log("Successfully patched scaleAnimStart performance.now()");
} else {
    console.log("Could not find scaleAnimStart search block");
}
