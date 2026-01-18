
// Mock Browser Environment
global.document = {
    getElementById: () => ({
        classList: { add: () => {}, remove: () => {} },
        innerText: '',
        style: {},
        querySelector: () => ({ innerText: '' }) // Added querySelector
    }),
    createElement: () => ({ style: {}, appendChild: () => {} }),
    body: { appendChild: () => {} }
};
global.window = {};

// Mock localStorage BEFORE import
const localStorageMock = (() => {
    let store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = value.toString(); },
        clear: () => { store = {}; }
    };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

import { discoverySystem } from '../src/systems/discovery.js';

console.log("Testing Discovery System...");

// Test 1: Discover new item
console.log("Test 1: Discover 'test_plant'");
// Reset internal state just in case
discoverySystem.discoveredItems.clear();

const isNew = discoverySystem.discover('test_plant', 'Test Plant', '🌿');

if (isNew !== true) {
    console.error("FAILED: Expected discover to return true for new item");
    process.exit(1);
}

// Test 2: Rediscover same item
console.log("Test 2: Rediscover 'test_plant'");
const isNew2 = discoverySystem.discover('test_plant', 'Test Plant', '🌿');
if (isNew2 !== false) {
    console.error("FAILED: Expected discover to return false for existing item");
    process.exit(1);
}

// Test 3: Check isDiscovered
console.log("Test 3: Check isDiscovered");
if (!discoverySystem.isDiscovered('test_plant')) {
    console.error("FAILED: Expected isDiscovered to return true");
    process.exit(1);
}
if (discoverySystem.isDiscovered('unknown_plant')) {
    console.error("FAILED: Expected isDiscovered to return false for unknown item");
    process.exit(1);
}

console.log("✅ Discovery System Verification Passed");
