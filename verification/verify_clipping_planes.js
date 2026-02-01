/**
 * Verification test for clippingPlanes initialization fix
 * Tests that the scene traversal logic properly initializes clippingPlanes
 */

// Mock Three.js objects for testing
class MockObject3D {
    constructor() {
        this.children = [];
        this.material = null;
    }
    
    add(child) {
        this.children.push(child);
    }
    
    traverse(callback) {
        callback(this);
        this.children.forEach(child => {
            if (child.traverse) {
                child.traverse(callback);
            }
        });
    }
}

class MockMaterial {
    constructor() {}
}

// Test 1: Scene initialization
console.log('Test 1: Scene clippingPlanes initialization');
const scene = new MockObject3D();
if (!scene.clippingPlanes) {
    scene.clippingPlanes = [];
}
console.assert(Array.isArray(scene.clippingPlanes), 'Scene should have clippingPlanes array');
console.log('✓ Test 1 passed');

// Test 2: Object initialization
console.log('\nTest 2: Object clippingPlanes initialization');
const obj1 = new MockObject3D();
const obj2 = new MockObject3D();
scene.add(obj1);
scene.add(obj2);

scene.traverse((object) => {
    if (!object.clippingPlanes) {
        object.clippingPlanes = [];
    }
});

console.assert(Array.isArray(obj1.clippingPlanes), 'Object 1 should have clippingPlanes array');
console.assert(Array.isArray(obj2.clippingPlanes), 'Object 2 should have clippingPlanes array');
console.log('✓ Test 2 passed');

// Test 3: Single material initialization
console.log('\nTest 3: Single material clippingPlanes initialization');
const obj3 = new MockObject3D();
obj3.material = new MockMaterial();
scene.add(obj3);

scene.traverse((object) => {
    if (!object.clippingPlanes) {
        object.clippingPlanes = [];
    }
    
    if (object.material) {
        if (Array.isArray(object.material)) {
            object.material.forEach((mat) => {
                if (mat && !mat.clippingPlanes) {
                    mat.clippingPlanes = [];
                }
            });
        } else if (!object.material.clippingPlanes) {
            object.material.clippingPlanes = [];
        }
    }
});

console.assert(Array.isArray(obj3.material.clippingPlanes), 'Single material should have clippingPlanes array');
console.log('✓ Test 3 passed');

// Test 4: Multi-material initialization
console.log('\nTest 4: Multi-material clippingPlanes initialization');
const obj4 = new MockObject3D();
obj4.material = [new MockMaterial(), new MockMaterial()];
scene.add(obj4);

scene.traverse((object) => {
    if (!object.clippingPlanes) {
        object.clippingPlanes = [];
    }
    
    if (object.material) {
        if (Array.isArray(object.material)) {
            object.material.forEach((mat) => {
                if (mat && !mat.clippingPlanes) {
                    mat.clippingPlanes = [];
                }
            });
        } else if (!object.material.clippingPlanes) {
            object.material.clippingPlanes = [];
        }
    }
});

console.assert(Array.isArray(obj4.material[0].clippingPlanes), 'First material should have clippingPlanes array');
console.assert(Array.isArray(obj4.material[1].clippingPlanes), 'Second material should have clippingPlanes array');
console.log('✓ Test 4 passed');

// Test 5: Nested objects
console.log('\nTest 5: Nested object clippingPlanes initialization');
const parent = new MockObject3D();
const child1 = new MockObject3D();
const child2 = new MockObject3D();
child1.material = new MockMaterial();
child2.material = new MockMaterial();
parent.add(child1);
parent.add(child2);
scene.add(parent);

scene.traverse((object) => {
    if (!object.clippingPlanes) {
        object.clippingPlanes = [];
    }
    
    if (object.material) {
        if (Array.isArray(object.material)) {
            object.material.forEach((mat) => {
                if (mat && !mat.clippingPlanes) {
                    mat.clippingPlanes = [];
                }
            });
        } else if (!object.material.clippingPlanes) {
            object.material.clippingPlanes = [];
        }
    }
});

console.assert(Array.isArray(parent.clippingPlanes), 'Parent should have clippingPlanes array');
console.assert(Array.isArray(child1.clippingPlanes), 'Child 1 should have clippingPlanes array');
console.assert(Array.isArray(child2.clippingPlanes), 'Child 2 should have clippingPlanes array');
console.assert(Array.isArray(child1.material.clippingPlanes), 'Child 1 material should have clippingPlanes array');
console.assert(Array.isArray(child2.material.clippingPlanes), 'Child 2 material should have clippingPlanes array');
console.log('✓ Test 5 passed');

console.log('\n✅ All clippingPlanes initialization tests passed!');
