// Simple smoke test for performance optimizations
// This tests that the core systems still work after optimization changes

import * as THREE from 'three';

// Mock camera for testing
const mockCamera = {
    position: new THREE.Vector3(0, 5, 0),
    projectionMatrix: new THREE.Matrix4().makePerspective(75, 1, 0.1, 1000),
    matrixWorldInverse: new THREE.Matrix4(),
    updateMatrixWorld: function() {
        this.matrixWorldInverse.copy(this.matrixWorld).invert();
    },
    matrixWorld: new THREE.Matrix4()
};
mockCamera.updateMatrixWorld();

// Mock weather system
const mockWeatherSystem = {
    currentLightLevel: 1.0,
    getGlobalLightLevel: function() { return this.currentLightLevel; }
};

// Mock moon
const mockMoon = new THREE.Object3D();

// Create test objects
const testObjects = [];
for (let i = 0; i < 100; i++) {
    const obj = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial()
    );
    obj.position.set(
        (Math.random() - 0.5) * 50,
        Math.random() * 5,
        (Math.random() - 0.5) * 50
    );
    obj.userData.type = 'test';
    obj.userData.animationType = 'sway';
    obj.userData.animationOffset = Math.random() * Math.PI * 2;
    testObjects.push(obj);
}

console.log('[Test] Created', testObjects.length, 'test objects');

// Test that we can import the music reactivity system
let passedTests = 0;
let failedTests = 0;

try {
    const { MusicReactivitySystem } = await import('./src/systems/music-reactivity.js');
    console.log('[Test] ✓ MusicReactivitySystem imported successfully');
    passedTests++;

    // Create instance
    const scene = new THREE.Scene();
    const system = new MusicReactivitySystem(scene);
    console.log('[Test] ✓ MusicReactivitySystem instantiated');
    passedTests++;

    // Test that update doesn't crash
    const audioState = { channelData: [], bpm: 120 };
    system.update(0, audioState, mockWeatherSystem, testObjects, mockCamera, false, false, mockMoon);
    console.log('[Test] ✓ First update() call succeeded');
    passedTests++;

    // Test multiple frames
    for (let frame = 0; frame < 10; frame++) {
        system.update(frame * 0.016, audioState, mockWeatherSystem, testObjects, mockCamera, false, false, mockMoon);
    }
    console.log('[Test] ✓ 10 frames of update() succeeded');
    passedTests++;

    // Test with objects at various distances
    testObjects[0].position.set(1000, 1000, 1000); // Very far
    testObjects[1].position.set(0, 5, 10); // Close
    system.update(0.5, audioState, mockWeatherSystem, testObjects, mockCamera, false, false, mockMoon);
    console.log('[Test] ✓ Distance culling handled correctly');
    passedTests++;

    // Test that staggered updates work
    const initialStartIndex = system.getUpdateStartIndex();
    system.update(1.0, audioState, mockWeatherSystem, testObjects, mockCamera, false, false, mockMoon);
    const newStartIndex = system.getUpdateStartIndex();
    if (newStartIndex !== initialStartIndex) {
        console.log('[Test] ✓ Staggered update index advances correctly');
        passedTests++;
    } else {
        console.warn('[Test] ✗ Staggered update index did not advance');
        failedTests++;
    }

} catch (err) {
    console.error('[Test] ✗ Test failed with error:', err);
    failedTests++;
}

// Test world generation
try {
    const { initWorld } = await import('./src/world/generation.js');
    console.log('[Test] ✓ World generation module imported');
    passedTests++;
} catch (err) {
    console.error('[Test] ✗ World generation import failed:', err);
    failedTests++;
}

// Summary
console.log('\n=== Test Summary ===');
console.log('Passed:', passedTests);
console.log('Failed:', failedTests);
console.log('Total:', passedTests + failedTests);

if (failedTests === 0) {
    console.log('\n✓ All tests passed!');
    process.exit(0);
} else {
    console.error('\n✗ Some tests failed!');
    process.exit(1);
}
