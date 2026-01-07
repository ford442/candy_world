import fs from 'fs';
import path from 'path';

// Basic structural check to ensure no syntax errors and correct logic placement
const code = fs.readFileSync('src/foliage/mushrooms.js', 'utf8');

// Check for required imports
if (!code.includes("uAudioLow") || !code.includes("uAudioHigh")) {
    console.error("Missing audio uniform imports!");
    process.exit(1);
}

// Check for TSL squish logic
if (!code.includes("kickSquish = uAudioLow.mul")) {
    console.error("Missing TSL squish logic!");
    process.exit(1);
}

// Check for rim light logic
if (!code.includes("createRimLight(color(0xFFFFFF)")) {
    console.error("Missing Rim Light logic!");
    process.exit(1);
}

// Check that giant material replacement is gone
if (code.includes("const breathMat = new MeshStandardNodeMaterial")) {
    console.error("Giant material replacement logic still exists!");
    process.exit(1);
}

console.log("Structure verified successfully.");
