import fs from 'fs';

const content = fs.readFileSync('src/foliage/cloud-batcher.ts', 'utf8');

const checks = [
    'IcosahedronGeometry(1, 2)',
    'uWindSpeed',
    'triplanarNoise',
    'createJuicyRimLight',
    'mx_noise_float',
    'smoothstep',
    'createCloudMaterial'
];

let errors = [];
checks.forEach(check => {
    if (!content.includes(check)) {
        errors.push(`Missing "${check}"`);
    }
});

if (errors.length > 0) {
    console.error("Verification Failed:", errors);
    process.exit(1);
} else {
    console.log("Verification Passed: cloud-batcher.ts contains required elements.");
    process.exit(0);
}
