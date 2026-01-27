import fs from 'fs';

const content = fs.readFileSync('src/foliage/berries.js', 'utf8');

let failed = false;

// Check for absence of forEach loop on the pool
// We look for specific patterns that indicate looping over the pool with closures
if (content.includes('fallingBerryPool.forEach')) {
    console.error('FAIL: fallingBerryPool.forEach still found in berries.js');
    failed = true;
}

if (content.includes('fallingBerryPool.find')) {
    console.error('FAIL: fallingBerryPool.find still found in berries.js');
    failed = true;
}

// Check for presence of InstancedMesh
if (!content.includes('new THREE.InstancedMesh')) {
    console.error('FAIL: InstancedMesh not found in berries.js');
    failed = true;
}

// Check for presence of instanceColor usage
if (!content.includes('instanceColor')) {
    console.error('FAIL: instanceColor not found in berries.js');
    failed = true;
}

if (failed) {
    process.exit(1);
}

console.log('SUCCESS: berries.js passed static verification.');
