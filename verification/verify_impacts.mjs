
import { createImpactSystem, spawnImpact } from '../src/foliage/impacts.js';
import * as THREE from 'three';

// Mock TSL functions if needed, but since we are running in Node, we depend on Three.js
// If Three.js TSL nodes are not available in Node environment, this might fail.
// But we can check if exports exist.

console.log("Checking impacts.js exports...");

if (typeof createImpactSystem !== 'function') {
    console.error("FAIL: createImpactSystem is not a function");
    process.exit(1);
}

if (typeof spawnImpact !== 'function') {
    console.error("FAIL: spawnImpact is not a function");
    process.exit(1);
}

console.log("PASS: Exports valid.");

// We can't easily simulate TSL in Node without a WebGPU polyfill, so we stop here.
// The main goal is to ensure no syntax errors and correct exports.
