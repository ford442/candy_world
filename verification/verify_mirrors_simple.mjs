
import fs from 'fs';

// Check if file exists and has content
if (fs.existsSync('src/foliage/mirrors.js')) {
    const content = fs.readFileSync('src/foliage/mirrors.js', 'utf8');
    if (content.includes('export function createMelodyMirror')) {
        console.log("✅ createMelodyMirror is exported.");
    } else {
        console.error("❌ createMelodyMirror is NOT exported.");
        process.exit(1);
    }

    if (content.includes('getDreamEnvTexture')) {
         console.log("✅ Dream Texture logic present.");
    }

    if (content.includes('warpSignal')) {
        console.log("✅ Audio warping logic present.");
    }
} else {
    console.error("❌ src/foliage/mirrors.js does not exist.");
    process.exit(1);
}

// Check generation.ts modification
const genContent = fs.readFileSync('src/world/generation.ts', 'utf8');
if (genContent.includes('createMelodyMirror')) {
    console.log("✅ createMelodyMirror integrated into generation.ts");
} else {
    console.error("❌ createMelodyMirror NOT found in generation.ts");
    process.exit(1);
}

console.log("Static verification passed.");
