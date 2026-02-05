
import fs from 'fs';

const impactsContent = fs.readFileSync('src/foliage/impacts.js', 'utf8');
const blasterContent = fs.readFileSync('src/gameplay/rainbow-blaster.ts', 'utf8');

const errors = [];

// Verify impacts.js
if (!impactsContent.includes("trail: { count: 1 }")) errors.push("impacts.js: Missing 'trail' config");
if (!impactsContent.includes("muzzle: { count: 10 }")) errors.push("impacts.js: Missing 'muzzle' config");
if (!impactsContent.includes("options.color")) errors.push("impacts.js: Missing 'options.color' support");
if (!impactsContent.includes("options.direction")) errors.push("impacts.js: Missing 'options.direction' support");

// Verify rainbow-blaster.ts
if (!blasterContent.includes("spawnImpact(origin, 'muzzle'")) errors.push("rainbow-blaster.ts: Missing muzzle flash spawn");
if (!blasterContent.includes("spawnImpact(p.position, 'trail'")) errors.push("rainbow-blaster.ts: Missing trail spawn");
if (!blasterContent.includes("mat.emissiveNode = instanceColor.mul(0.5)")) errors.push("rainbow-blaster.ts: Missing emissive glow");
if (!blasterContent.includes("color: THREE.Color;")) errors.push("rainbow-blaster.ts: Missing color property in projectile interface");

if (errors.length > 0) {
    console.error("Verification Failed:", errors);
    process.exit(1);
} else {
    console.log("Verification Passed: Palette Juice (Trails & Muzzle) detected.");
    process.exit(0);
}
