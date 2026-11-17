import { test } from 'node:test';
import * as assert from 'node:assert';
import * as THREE from 'three';
import { ChordStrikeSystem } from '../src/gameplay/chord-strike.ts';

test('ChordStrikeSystem memory rescue', (t) => {
    const scene = new THREE.Scene();
    const system = new ChordStrikeSystem();

    // Add to scene
    system.addToScene(scene);

    assert.equal(scene.children.length, 1);
    const mesh = scene.children[0] as THREE.Mesh;
    assert.equal(mesh, system.mesh);

    // Mock dispose methods to track calls
    let geometryDisposed = false;
    let materialDisposed = false;

    mesh.geometry.dispose = () => {
        geometryDisposed = true;
    };

    if (!Array.isArray(mesh.material)) {
        mesh.material.dispose = () => {
            materialDisposed = true;
        };
    }

    // Call dispose
    system.dispose();

    // Assertions
    assert.equal(scene.children.length, 0, 'Mesh should be removed from scene');
    assert.equal(geometryDisposed, true, 'Geometry should be disposed');
    assert.equal(materialDisposed, true, 'Material should be disposed');
});
