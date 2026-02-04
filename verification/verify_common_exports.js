import fs from 'fs';

const content = fs.readFileSync('src/foliage/common.ts', 'utf8');

const checks = [
    'export const triplanarNoise',
    'export const createJuicyRimLight',
    'export const uWindSpeed',
    'export const uWindDirection',
    'export const uAudioHigh'
];

let errors = [];
checks.forEach(check => {
    if (!content.includes(check)) {
        errors.push(`Missing export "${check}"`);
    }
});

if (errors.length > 0) {
    console.error("Verification Failed:", errors);
    process.exit(1);
} else {
    console.log("Verification Passed: common.ts exports exist.");
    process.exit(0);
}
