import * as THREE from 'three';
import { 
    createClayMaterial, 
    createCandyMaterial, 
    registerReactiveMaterial, 
    attachReactivity,
    foliageMaterials 
} from './common.js';

// --- Category 1: Melodic Flora ---

export function createArpeggioFern(options = {}) {
    const { color = 0x00FF88, scale = 1.0 } = options;
    const group = new THREE.Group();

    // Base
    const baseGeo = new THREE.ConeGeometry(0.2 * scale, 0.5 * scale, 6);
    const baseMat = createClayMaterial(0x2E8B57);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.25 * scale;
    group.add(base);

    // Fronds (Segmented for unfurling animation)
    const frondCount = 5;
    const segCount = 8;
    const frondMat = createCandyMaterial(color, 0.9);
    registerReactiveMaterial(frondMat);

    for (let i = 0; i < frondCount; i++) {
        const frondRoot = new THREE.Group();
        frondRoot.rotation.y = (i / frondCount) * Math.PI * 2;
        frondRoot.position.y = 0.4 * scale;
        
        let currentSeg = frondRoot;
        
        // Create chain of segments
        for (let j = 0; j < segCount; j++) {
            const segGeo = new THREE.BoxGeometry(0.1 * scale, 0.3 * scale, 0.02 * scale);
            // Tapering
            segGeo.scale(1.0 - (j/segCount)*0.8, 1.0, 1.0);
            segGeo.translate(0, 0.15 * scale, 0);
            
            const seg = new THREE.Mesh(segGeo, frondMat);
            const pivot = new THREE.Group();
            pivot.position.y = (j === 0) ? 0 : 0.28 * scale; // Pivot at top of prev
            
            // Initial curl state
            pivot.rotation.x = -0.5; // Curled inward
            
            pivot.add(seg);
            currentSeg.add(pivot);
            currentSeg = pivot; // Next segment attaches to this pivot
        }
        group.add(frondRoot);
    }

    group.userData.animationType = 'arpeggioUnfurl';
    group.userData.type = 'fern';
    return attachReactivity(group);
}

export function createPortamentoPine(options = {}) {
    const { color = 0xCD7F32, height = 4.0 } = options;
    const group = new THREE.Group();

    // Trunk (Segmented for bending)
    const segments = 6;
    const segHeight = height / segments;
    const trunkMat = createClayMaterial(0x8B4513); // Copper-ish
    const needleMat = createCandyMaterial(0x2E8B57, 0.5);

    let currentParent = group;

    for (let i = 0; i < segments; i++) {
        const pivot = new THREE.Group();
        pivot.position.y = (i === 0) ? 0 : segHeight;
        
        const rBot = 0.4 * (1 - i/segments) + 0.1;
        const rTop = 0.4 * (1 - (i+1)/segments) + 0.1;
        
        const geo = new THREE.CylinderGeometry(rTop, rBot, segHeight, 8);
        geo.translate(0, segHeight/2, 0);
        const mesh = new THREE.Mesh(geo, trunkMat);
        
        // Needles
        if (i > 1) {
            const needleCount = 8;
            for(let n=0; n<needleCount; n++) {
                const needle = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.6, 4), needleMat);
                needle.position.y = segHeight * 0.5;
                needle.rotation.y = (n/needleCount) * Math.PI * 2;
                needle.rotation.z = 1.5;
                needle.position.x = rBot;
                mesh.add(needle);
            }
        }

        pivot.add(mesh);
        currentParent.add(pivot);
        currentParent = pivot;
        
        // Store reference to pivots for animation
        if (!group.userData.segments) group.userData.segments = [];
        group.userData.segments.push(pivot);
    }

    group.userData.animationType = 'portamentoBend';
    group.userData.type = 'tree';
    return group;
}

// --- Category 2: Rhythmic Structures ---

export function createCymbalDandelion(options = {}) {
    const { scale = 1.0 } = options;
    const group = new THREE.Group();

    // Stem
    const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02 * scale, 0.02 * scale, 1.5 * scale),
        createClayMaterial(0x556B2F)
    );
    stem.position.y = 0.75 * scale;
    group.add(stem);

    // Head (The Cymbal Seeds)
    const head = new THREE.Group();
    head.position.y = 1.5 * scale;
    group.add(head);

    const seedCount = 24;
    const seedGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.4 * scale);
    seedGeo.translate(0, 0.2 * scale, 0);
    const tipGeo = new THREE.SphereGeometry(0.04 * scale);
    const seedMat = createCandyMaterial(0xFFD700, 1.0); // Gold
    registerReactiveMaterial(seedMat);

    for(let i=0; i<seedCount; i++) {
        const seedGroup = new THREE.Group();
        const phi = Math.acos(-1 + (2 * i) / seedCount);
        const theta = Math.sqrt(seedCount * Math.PI) * phi;
        
        seedGroup.rotation.setFromVector3(new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta),
            Math.sin(phi) * Math.sin(theta),
            Math.cos(phi)
        ).normalize().multiplyScalar(1.5)); // Direction
        
        seedGroup.lookAt(seedGroup.position.clone().add(new THREE.Vector3(0,1,0))); // Hacky alignment

        const stalk = new THREE.Mesh(seedGeo, createClayMaterial(0xFFFFFF));
        const tip = new THREE.Mesh(tipGeo, seedMat);
        tip.position.y = 0.4 * scale;
        
        stalk.add(tip);
        head.add(stalk);
        
        // Distribute spherically
        stalk.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), new THREE.Vector3(
             Math.sin(phi) * Math.cos(theta),
             Math.cos(phi),
             Math.sin(phi) * Math.sin(theta)
        ));
    }

    group.userData.animationType = 'cymbalShake'; // Needs high freq trigger
    group.userData.type = 'flower';
    return attachReactivity(group);
}

export function createSnareTrap(options = {}) {
    const { color = 0xFF4500, scale = 1.0 } = options;
    const group = new THREE.Group();

    // Base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.2), createClayMaterial(0x2E2E2E));
    group.add(base);

    // Jaws
    const jawMat = createCandyMaterial(color, 0.5);
    registerReactiveMaterial(jawMat);
    const toothMat = createClayMaterial(0xFFFFFF);

    const leftJaw = new THREE.Group();
    const rightJaw = new THREE.Group();
    
    // Jaw Shape (Half Torus ish)
    const jawGeo = new THREE.TorusGeometry(0.5 * scale, 0.1 * scale, 8, 16, Math.PI);
    
    const meshL = new THREE.Mesh(jawGeo, jawMat);
    meshL.rotation.x = Math.PI / 2;
    leftJaw.add(meshL);

    const meshR = new THREE.Mesh(jawGeo, jawMat);
    meshR.rotation.x = Math.PI / 2;
    rightJaw.add(meshR);

    // Teeth
    for(let i=0; i<5; i++) {
        const t = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2), toothMat);
        t.position.set((i-2)*0.2, 0, 0.1);
        t.rotation.x = -1.0;
        leftJaw.add(t);
        
        const t2 = t.clone();
        t2.rotation.x = 1.0;
        t2.position.z = -0.1;
        rightJaw.add(t2);
    }

    leftJaw.position.set(0, 0.2, -0.2);
    rightJaw.position.set(0, 0.2, 0.2);
    
    // Default open state
    leftJaw.rotation.x = -0.5;
    rightJaw.rotation.x = 0.5 + Math.PI; // Face opposite

    group.add(leftJaw);
    group.add(rightJaw);

    group.userData.leftJaw = leftJaw;
    group.userData.rightJaw = rightJaw;
    group.userData.animationType = 'snareSnap';
    group.userData.type = 'trap'; // Reacts to snare
    
    return attachReactivity(group);
}
