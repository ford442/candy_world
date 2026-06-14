// src/foliage/cave.ts

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, mix, positionLocal, normalWorld,
    smoothstep, abs
} from 'three/tsl';
import {
    uAudioLow, createRimLight, triplanarNoise, perturbNormal
} from './index.ts';
import { uTwilight } from './sky.ts';
import { waterfallBatcher } from './waterfall-batcher.ts';

const _scratchMatrix = new THREE.Matrix4();
export interface CaveOptions {
    scale?: number;
    depth?: number;
    width?: number;
    height?: number;
}

// Module-level shared geometry for performance
const _sharedConeGeo = new THREE.ConeGeometry(0.8, 3.0, 8);
// Displace vertices slightly for organic look
const _conePos = _sharedConeGeo.attributes.position;
for (let i = 0; i < _conePos.count; i++) {
    const x = _conePos.getX(i);
    const y = _conePos.getY(i);
    const z = _conePos.getZ(i);
    if (y < 1.4) { // keep tip relatively sharp
        _conePos.setX(i, x + (Math.random() - 0.5) * 0.3);
        _conePos.setZ(i, z + (Math.random() - 0.5) * 0.3);
    }
}
_sharedConeGeo.computeVertexNormals();

let _sharedCrystalMat: MeshStandardNodeMaterial | null = null;
let _sharedRockMat: MeshStandardNodeMaterial | null = null;

function getSharedCrystalMat() {
    if (!_sharedCrystalMat) {
        // --- PALETTE UPGRADE: Crystal Material ---
        _sharedCrystalMat = new MeshStandardNodeMaterial();

        // 1. Base Crystal Texture (Noise)
        const crystalNoiseScale = float(1.5);
        const crystalNoise = triplanarNoise(positionLocal, crystalNoiseScale);

        // Cyan / Deep Blue colors
        const colorCore = color(0x0088ff);
        const colorTip = color(0x00ffff);

        // Mix based on local Y position to create a gradient from base to tip
        // The cone is 3.0 units high, centered at 0. So y goes from -1.5 to 1.5.
        // For stalactites, tip is at +y (since we rotate it 90 deg, local Y is aligned with cone's height)
        const tipFactor = smoothstep(float(-1.5), float(1.5), positionLocal.y);
        const crystalBaseColor = mix(colorCore, colorTip, tipFactor);

        // 2. Bioluminescent Glow (Audio Reactive)
        // Pulse with Bass (AudioLow)
        const crystalPulse = uAudioLow.mul(1.5).add(0.2); // Pulse harder on beat
        const crystalGlowStrength = tipFactor.mul(crystalPulse).mul(uTwilight).mul(5.0); // Tip glows strongest
        const crystalGlowColor = color(0x00FFFF); // Cyan glow

        // 3. Rim Light (Edge Definition)
        const crystalRim = createRimLight(color(0xffffff), float(0.8), float(3.0));

        // Combine Colors
        _sharedCrystalMat.colorNode = crystalBaseColor.add(crystalRim);
        _sharedCrystalMat.emissiveNode = crystalGlowColor.mul(crystalGlowStrength);

        // 4. Surface Detail (Bump & Roughness & Transmission)
        _sharedCrystalMat.roughnessNode = float(0.2).add(crystalNoise.mul(0.1)); // Smooth and shiny
        _sharedCrystalMat.metalnessNode = float(0.2);
    }
    return _sharedCrystalMat;
}

function getSharedRockMat() {
    if (!_sharedRockMat) {
        // --- PALETTE UPGRADE: Living Cave Material ---
        _sharedRockMat = new MeshStandardNodeMaterial();

        // 1. Base Rock Texture (Triplanar)
        const noiseScale = float(0.5);
        const rockNoise = triplanarNoise(positionLocal, noiseScale);

        // Dark Organic Rock Colors
        const colorDeep = color(0x1a1a1a); // Black/Grey
        const colorHighlight = color(0x2d2d3a); // Blue-ish Grey

        // Mix based on noise
        const baseColor = mix(colorDeep, colorHighlight, rockNoise);

        // 2. Bioluminescent Veins (Audio Reactive)
        // Create thin lines where noise is close to 0
        const veinScale = float(2.5);
        const veinNoise = triplanarNoise(positionLocal, veinScale);
        // Create a narrow band around 0.0
        const veinMask = float(1.0).sub(smoothstep(0.01, 0.08, abs(veinNoise)));

        // Pulse with Bass (AudioLow)
        // Glows stronger at night (Twilight)
        const pulse = uAudioLow.mul(0.8).add(0.2); // Always some glow, pulse harder on beat
        const glowStrength = veinMask.mul(pulse).mul(uTwilight).mul(3.0);
        const veinColor = color(0x00FFFF); // Cyan glow

        // 3. Rim Light (Edge Definition)
        const rim = createRimLight(color(0x444455), float(0.5), float(2.0));

        // Combine Colors
        _sharedRockMat.colorNode = baseColor.add(rim);
        _sharedRockMat.emissiveNode = veinColor.mul(glowStrength);

        // 4. Surface Detail (Bump & Roughness)
        // Wet spots where noise is high
        _sharedRockMat.roughnessNode = float(0.9).sub(rockNoise.mul(0.4)); // 0.5 to 0.9
        _sharedRockMat.metalnessNode = float(0.1);

        // Bump Map for detail
        _sharedRockMat.normalNode = perturbNormal(positionLocal, normalWorld, float(8.0), float(0.5));
    }
    return _sharedRockMat;
}

export function createCaveEntrance(options: CaveOptions = {}): THREE.Group {
    const {
        scale = 1.0,
        depth = 20.0,
        width = 8.0,
        height = 6.0
    } = options;

    const group = new THREE.Group();
    group.userData.type = 'cave';
    group.userData.isBlocked = false;

    const rockMat = getSharedRockMat();

    // IMPROVED: A 4-point curve for a better tunnel shape
    const tunnelCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, -2, -depth * 0.3),
        new THREE.Vector3(4, -4, -depth * 0.6),
        new THREE.Vector3(10, -6, -depth)
    ]);

    const tubeGeo = new THREE.TubeGeometry(tunnelCurve, 12, width/2, 8, false);

    // FIX: Iterate i++ (not i+=3) to displace EVERY vertex
    const positions = tubeGeo.attributes.position;
    for(let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        // Simple noise displacement
        positions.setX(i, x + (Math.random()-0.5) * 0.5);
        positions.setY(i, y + (Math.random()-0.5) * 0.5);
        positions.setZ(i, z + (Math.random()-0.5) * 0.5);
    }
    tubeGeo.computeVertexNormals();

    const tunnelMesh = new THREE.Mesh(tubeGeo, rockMat);
    tunnelMesh.castShadow = true;
    tunnelMesh.receiveShadow = true;
    group.add(tunnelMesh);

    // --- Stalactites & Stalagmites ---
    // ⚡ OPTIMIZATION: Converted cave stalactites to InstancedMesh to reduce draw calls and GC.
    const formationCount = 12;

    const crystalMat = getSharedCrystalMat();

    const _scratchPos = new THREE.Vector3();
    const _scratchTangent = new THREE.Vector3();
    const _scratchObj = new THREE.Object3D();

    const formationsMesh = new THREE.InstancedMesh(_sharedConeGeo, crystalMat, formationCount);
    formationsMesh.castShadow = true;
    formationsMesh.receiveShadow = true;

    for (let i = 0; i < formationCount; i++) {
        const t = 0.1 + (Math.random() * 0.8); // Avoid very ends of tunnel
        tunnelCurve.getPoint(t, _scratchPos);
        tunnelCurve.getTangent(t, _scratchTangent);

        // Tunnel radius is width/2 = 4.0
        // We want to place them on the floor or ceiling
        const isCeiling = Math.random() > 0.5;

        // Calculate a normal vector pointing out from the curve center
        // Since curve goes down/forward (y, z), an orthogonal vector could be (1, 0, 0) for sides,
        // or (0, 1, 0) for floor/ceiling.
        // For simplicity, we can just use the curve point, and add an offset.

        const radius = (width / 2) * 0.8; // slightly inside
        const angle = isCeiling ?
            (-Math.PI/4 + Math.random() * Math.PI/2) : // Ceiling arc
            (Math.PI*3/4 + Math.random() * Math.PI/2); // Floor arc

        // Simple local offset based on angle
        const offsetX = Math.cos(angle) * radius;
        const offsetY = Math.sin(angle) * radius;

        _scratchObj.position.copy(_scratchPos);
        _scratchObj.position.x += offsetX;
        _scratchObj.position.y += offsetY;

        // Point the cone towards the center of the tunnel
        _scratchObj.lookAt(_scratchPos);

        // If it's a stalactite (ceiling), base is attached to wall, tip points inward
        // lookAt points Z towards target. Cone points up in Y by default.
        _scratchObj.rotateX(Math.PI / 2); // align Y axis with Z (lookAt direction)

        // Random scaling
        const s = 0.5 + Math.random() * 1.0;
        _scratchObj.scale.set(s * 0.5, s, s * 0.5);
        _scratchMatrix.compose(_scratchObj.position, _scratchObj.quaternion, _scratchObj.scale);
        // ⚡ OPTIMIZATION: Write directly to instanceMatrix array instead of updateMatrix + setMatrixAt
        _scratchMatrix.toArray(formationsMesh.instanceMatrix.array, (i) * 16);
    }
    group.add(formationsMesh);

    // 2. The Water Gate (Waterfall)
    const gatePos = new THREE.Vector3(0, height * 0.7, -2);
    const floorPos = new THREE.Vector3(0, -1, -2);

    // ⚡ OPTIMIZATION: Use waterfallBatcher instead of creating individual meshes with JS animation loop
    group.userData.gateLocalPos = gatePos;
    group.userData.gateHeight = gatePos.y - floorPos.y;
    group.userData.gateWidth = width * 0.7;
    group.userData.waterfallActive = false;

    group.scale.setScalar(scale);

    return group;
}

const _scratchWorldPos = new THREE.Vector3();

export function updateCaveWaterLevel(caveGroup: THREE.Group, waterLevel: number): void {
    const threshold = 0.2;

    if (waterLevel > threshold) {
        if (!caveGroup.userData.waterfallActive) {
            caveGroup.userData.waterfallActive = true;
            // Calculate world position of the gate
            _scratchWorldPos.copy(caveGroup.userData.gateLocalPos);
            _scratchWorldPos.applyMatrix4(caveGroup.matrixWorld);

            // Add to batcher
            waterfallBatcher.add(
                caveGroup.uuid,
                _scratchWorldPos,
                caveGroup.userData.gateHeight * caveGroup.scale.y,
                caveGroup.userData.gateWidth * caveGroup.scale.x
            );
        }

        const intensity = (waterLevel - threshold) / (1.0 - threshold);
        // Scale thickness based on intensity
        waterfallBatcher.updateInstance(caveGroup.uuid, 0.5 + intensity * 0.5);

        caveGroup.userData.isBlocked = intensity > 0.1;
    } else {
        if (caveGroup.userData.waterfallActive) {
            caveGroup.userData.waterfallActive = false;
            waterfallBatcher.remove(caveGroup.uuid);
        }
        caveGroup.userData.isBlocked = false;
    }
}
