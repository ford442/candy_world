import fs from 'fs';
import path from 'path';

const commonPath = path.resolve('src/foliage/common.ts');
const flowersPath = path.resolve('src/foliage/flowers.ts');

console.log('Verifying Foliage Logic...');

const commonContent = fs.readFileSync(commonPath, 'utf8');
const flowersContent = fs.readFileSync(flowersPath, 'utf8');

let errors = [];

// 1. Check exports in common.js
if (!commonContent.includes('export const calculateWindSway')) {
    errors.push('Missing export: calculateWindSway in common.js');
}
if (!commonContent.includes('export const calculateFlowerBloom')) {
    errors.push('Missing export: calculateFlowerBloom in common.js');
}

// 2. Check usage in common.js (foliageMaterials)
// Check strict usage pattern or at least presence
if (!commonContent.includes('calculateWindSway(positionLocal)')) {
    errors.push('foliageMaterials.stem does not seem to use calculateWindSway');
}

// Check if flowerPetal array uses the deformation node
const petalMatch = commonContent.match(/flowerPetal:\s*\[([\s\S]*?)\]/);
if (petalMatch) {
    const petalBlock = petalMatch[1];
    if (!petalBlock.includes('deformationNode: calculateFlowerBloom(positionLocal)')) {
         errors.push('foliageMaterials.flowerPetal presets missing deformationNode');
    }
} else {
    errors.push('Could not locate flowerPetal array in common.js');
}

// 3. Check usage in flowers.js
if (!flowersContent.includes('calculateFlowerBloom')) {
    errors.push('flowers.js does not import calculateFlowerBloom');
}
if (!flowersContent.includes('deformationNode: calculateFlowerBloom(positionLocal)')) {
    errors.push('createFlower does not pass calculateFlowerBloom to custom petal material');
}

if (errors.length > 0) {
    console.error('Verification FAILED:');
    errors.forEach(e => console.error('- ' + e));
    process.exit(1);
} else {
    console.log('Verification SUCCESS: TSL helpers and material updates found.');
}
