import * as THREE from 'three';

const group = new THREE.Group();
group.position.set(10, 0, 10);
group.updateWorldMatrix(true, false);
console.log(group.matrixWorld.elements);
