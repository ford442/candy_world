
import assert from 'assert';

// Mock minimal Three.js
const THREE = {
    Vector3: class {
        constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
        distanceTo(v) { return Math.sqrt((this.x-v.x)**2 + (this.y-v.y)**2 + (this.z-v.z)**2); }
        copy(v) { this.x=v.x; this.y=v.y; this.z=v.z; return this; }
        set(x,y,z) { this.x=x; this.y=y; this.z=z; return this; }
    },
    Vector2: class { constructor(x,y) {} },
    Raycaster: class {
        constructor() { this.far = 100; }
        setFromCamera() {}
        intersectObjects(list) { return []; } // Mock no intersection by default
    }
};

// Mock CONFIG
const CONFIG = {
    interaction: { proximityRadius: 10, interactionDistance: 5 }
};

// Mock InteractionSystem dependencies
global.THREE = THREE; // For the import in the file

class InteractionSystem {
    constructor(camera, reticleCallback) {
        this.camera = camera;
        this.raycaster = new THREE.Raycaster();
        this.raycaster.far = 50;
        this.hoveredObject = null;

        // ⚡ OPTIMIZATION: Double-buffered Sets
        this._nearbySetA = new Set();
        this._nearbySetB = new Set();
        this.nearbyObjects = this._nearbySetA;

        // ⚡ OPTIMIZATION: Reusable scratch array
        this._candidatesScratch = [];

        this.reticleCallback = reticleCallback;
        this.proximityRadius = 10.0;
        this.interactionDistance = 5.0;
    }

    // Copied update method from my change
    update(dt, playerPosition, ...interactableLists) {
        const prevNearby = this.nearbyObjects;
        const nextNearby = (prevNearby === this._nearbySetA) ? this._nearbySetB : this._nearbySetA;
        nextNearby.clear();

        // 1. PROXIMITY CHECK
        for (let i = 0; i < interactableLists.length; i++) {
            const list = interactableLists[i];
            if (!list || !Array.isArray(list)) continue;

            const len = list.length;
            for (let j = 0; j < len; j++) {
                const obj = list[j];
                if (!obj || !obj.position || !obj.visible) continue;

                const dist = playerPosition.distanceTo(obj.position);

                if (dist < this.proximityRadius) {
                    nextNearby.add(obj);
                }
            }
        }

        // Check Enters
        for (const obj of nextNearby) {
            if (!prevNearby.has(obj)) {
                 if (obj.userData?.onProximityEnter) {
                     obj.userData.onProximityEnter(playerPosition.distanceTo(obj.position));
                 }
            }
        }

        // Check Leaves
        for (const obj of prevNearby) {
            if (!nextNearby.has(obj)) {
                if (obj.userData?.onProximityLeave) {
                    obj.userData.onProximityLeave();
                }
                if (this.hoveredObject === obj) this.handleHover(null);
            }
        }

        this.nearbyObjects = nextNearby;

        // 2. GAZE CHECK
        this._candidatesScratch.length = 0;
        for (const obj of this.nearbyObjects) {
            this._candidatesScratch.push(obj);
        }

        const candidates = this._candidatesScratch;
        // Mock raycast check
        if (candidates.length > 0) {
            // In a real test we'd mock raycaster result.
            // For logic verification of the Set swapping, we are good.
        }
    }

    handleHover(obj) { this.hoveredObject = obj; }
}

// --- TESTS ---

function runTests() {
    console.log("Running InteractionSystem Tests...");
    const camera = new THREE.Vector3(); // Mock camera
    const system = new InteractionSystem(camera, null);

    const playerPos = new THREE.Vector3(0, 0, 0);

    // Test Objects
    const objA = { position: new THREE.Vector3(5, 0, 0), visible: true, userData: { id: 'A' } }; // Close
    const objB = { position: new THREE.Vector3(20, 0, 0), visible: true, userData: { id: 'B' } }; // Far
    const objC = { position: new THREE.Vector3(5, 0, 0), visible: true, userData: { id: 'C' } }; // Close

    // Callbacks
    let entered = [];
    let left = [];

    const setupCallbacks = (obj) => {
        obj.userData.onProximityEnter = () => entered.push(obj.userData.id);
        obj.userData.onProximityLeave = () => left.push(obj.userData.id);
    };
    setupCallbacks(objA);
    setupCallbacks(objB);
    setupCallbacks(objC);

    // FRAME 1: A and C are close. B is far.
    // Pass as multiple arrays
    system.update(0.1, playerPos, [objA, objB], [objC]);

    assert.ok(system.nearbyObjects.has(objA), "A should be nearby");
    assert.ok(!system.nearbyObjects.has(objB), "B should NOT be nearby");
    assert.ok(system.nearbyObjects.has(objC), "C should be nearby");
    assert.deepStrictEqual(entered, ['A', 'C'], "A and C should enter");
    assert.deepStrictEqual(left, [], "Nothing should leave");

    // Verify Set Swapping
    const set1 = system.nearbyObjects;

    // FRAME 2: Player moves, A stays close, C becomes far (removed from list logic check), B becomes close (logic check)
    // Actually let's just move B close and remove C from the list entirely to check removal logic.

    entered = [];
    left = [];

    objB.position.set(5, 0, 0); // B moves close

    // C is removed from the input arrays
    system.update(0.1, playerPos, [objA, objB]);

    const set2 = system.nearbyObjects;
    assert.notStrictEqual(set1, set2, "Sets should be swapped");

    assert.ok(system.nearbyObjects.has(objA), "A should still be nearby");
    assert.ok(system.nearbyObjects.has(objB), "B should now be nearby");
    assert.ok(!system.nearbyObjects.has(objC), "C should NOT be nearby (removed)");

    // A was already nearby, so no Enter.
    // B entered.
    // C left (because it was in prevNearby but not in nextNearby).

    assert.deepStrictEqual(entered, ['B'], "Only B should enter");
    assert.deepStrictEqual(left, ['C'], "C should leave");

    console.log("✅ All Logic Tests Passed");
}

runTests();
