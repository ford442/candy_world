import * as THREE from 'three';
import { foliageGroup } from '../world/state.ts';
import {
    createCandyMaterial,
    registerReactiveMaterial,
    sharedGeometries,
    applyPlayerInteraction,
    calculateWindSway,
    createJuicyRimLight,
    createStandardNodeMaterial,
    uAudioHigh,
    uPlayerPosition
} from './common.ts';
import {
    color, float, uniform, vec3, positionLocal, sin, cos, mix, uv, varying,
    smoothstep, attribute, positionWorld, If, vec4
} from 'three/tsl';
import { uTime, uGlitchIntensity } from './common.ts';
import { applyGlitch } from './glitch.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MAX_FERNS = 2000;
const FRONDS_PER_FERN = 5;

export class ArpeggioFernBatcher {
    initialized: boolean;
    count: number;
    logicFerns: any[];

    // GPU Buffers
    mesh: THREE.InstancedMesh | null; // Merged mesh

    // Scratch
    dummy: THREE.Object3D;
    _color: THREE.Color;

    // GLOBAL TSL Uniform
    public globalUnfurl: number = 0;
    public uFernUnfurl: any;

    // Global Logic State
    private currentTargetStep: number = 0;
    private currentUnfurlValue: number = 0;
    private lastTrigger: boolean = false;

    constructor() {
        this.initialized = false;
        this.count = 0;
        this.logicFerns = [];

        this.mesh = null;

        this.dummy = new THREE.Object3D();
        this._color = new THREE.Color();

        // Initialize global uniform
        this.uFernUnfurl = uniform(float(0.0));
    }

    init() {
        if (this.initialized) return;

        // --- Geometry Preparation ---

        // 1. Frond Geometry (Base Scale 1.0)
        const frondHeight = 2.3;
        const frondGeo = new THREE.BoxGeometry(0.1, frondHeight, 0.02, 1, 16, 1);
        frondGeo.translate(0, frondHeight / 2, 0); // Pivot at bottom

        // 2. Base Geometry
        const baseGeo = new THREE.ConeGeometry(0.2, 0.5, 6);
        baseGeo.translate(0, 0.25, 0);

        const geometriesToMerge: THREE.BufferGeometry[] = [];

        // --- BASE SETUP ---
        // Base is at (0,0,0) locally, no rotation
        // Attributes: aIsFrond=0, aFrondAngle=0, aFrondTilt=0
        const baseCount = baseGeo.attributes.position.count;
        const baseIsFrond = new Float32Array(baseCount).fill(0);
        const baseAngle = new Float32Array(baseCount).fill(0);
        const baseTilt = new Float32Array(baseCount).fill(0);

        baseGeo.setAttribute('aIsFrond', new THREE.BufferAttribute(baseIsFrond, 1));
        baseGeo.setAttribute('aFrondAngle', new THREE.BufferAttribute(baseAngle, 1));
        baseGeo.setAttribute('aFrondTilt', new THREE.BufferAttribute(baseTilt, 1));

        geometriesToMerge.push(baseGeo);

        // --- FROND SETUP (5 copies) ---
        const frondYOffset = 0.4; // From original code logic
        const tiltAngle = 0.2; // From original code logic

        for (let f = 0; f < FRONDS_PER_FERN; f++) {
            const angle = (f / FRONDS_PER_FERN) * Math.PI * 2;
            const geo = frondGeo.clone();

            // Apply transformations that define the frond's rest position relative to the fern center
            // 1. Tilt (Rotate X)
            geo.rotateX(tiltAngle);
            // 2. Fan (Rotate Y)
            geo.rotateY(angle);
            // 3. Lift (Translate Y)
            geo.translate(0, frondYOffset, 0);

            // Attributes
            const count = geo.attributes.position.count;
            const isFrond = new Float32Array(count).fill(1.0);
            const frondAngle = new Float32Array(count).fill(angle);
            const frondTilt = new Float32Array(count).fill(tiltAngle);

            geo.setAttribute('aIsFrond', new THREE.BufferAttribute(isFrond, 1));
            geo.setAttribute('aFrondAngle', new THREE.BufferAttribute(frondAngle, 1));
            geo.setAttribute('aFrondTilt', new THREE.BufferAttribute(frondTilt, 1));

            geometriesToMerge.push(geo);
        }

        // Merge Everything
        const mergedGeo = mergeGeometries(geometriesToMerge);

        // --- MATERIAL SETUP ---

        // 1. Base Properties (Mixed based on aIsFrond)
        const isFrondAttr = attribute('aIsFrond', 'float');

        // Base: 0x2E8B57, Rough 0.8, Metal 0.0
        // Frond: 0x00FF88, Rough 0.6, Metal 0.1
        const baseColor = color(0x2E8B57);
        const frondColor = color(0x00FF88);
        const mixedColor = mix(baseColor, frondColor, isFrondAttr);

        const mixedRough = mix(float(0.8), float(0.6), isFrondAttr);
        const mixedMetal = mix(float(0.0), float(0.1), isFrondAttr);

        const material = createStandardNodeMaterial({
            color: 0xFFFFFF, // Overridden by node
            roughness: 1.0,
            metalness: 0.0
        });
        registerReactiveMaterial(material);

        material.colorNode = mixedColor; // Will be multiplied by instanceColor in fragment logic?
        // Actually, createStandardNodeMaterial usually sets basic properties.
        // We override them here.
        material.roughnessNode = mixedRough;
        material.metalnessNode = mixedMetal;

        // --- VERTEX LOGIC (CURL) ---

        const frondAngle = attribute('aFrondAngle', 'float');
        const frondTilt = attribute('aFrondTilt', 'float'); // 0.2
        const pos = positionLocal; // Vertex Position in Fern Local Space

        // We need to un-rotate the vertex to apply the curl in canonical space (Z-aligned)
        // Inverse of: Translate(0, 0.4, 0) -> RotateY(angle) -> RotateX(tilt)
        // Wait, matrix multiplication order is Translate * RotateY * RotateX * v
        // So v_world = T * Ry * Rx * v_local
        // To unwind: v_local = Rx' * Ry' * T' * v_world
        // But we baked T * Ry * Rx into the geometry.
        // So 'pos' is v_world (relative to fern center).

        // Step 1: Untranslate Y
        const p1 = vec3(pos.x, pos.y.sub(float(frondYOffset)), pos.z);

        // Step 2: Unrotate Y (angle)
        // x' = x*cos(-a) - z*sin(-a)
        // z' = x*sin(-a) + z*cos(-a)
        const cY = cos(frondAngle.negate());
        const sY = sin(frondAngle.negate());
        const p2 = vec3(
            p1.x.mul(cY).sub(p1.z.mul(sY)),
            p1.y,
            p1.x.mul(sY).add(p1.z.mul(cY))
        );

        // Step 3: Unrotate X (tilt)
        // y' = y*cos(-t) - z*sin(-t)
        // z' = y*sin(-t) + z*cos(-t)
        const cX = cos(frondTilt.negate());
        const sX = sin(frondTilt.negate());
        const p3 = vec3(
            p2.x,
            p2.y.mul(cX).sub(p2.z.mul(sX)),
            p2.y.mul(sX).add(p2.z.mul(cX))
        );

        // p3 is now in "Canonical Frond Space" (Vertical along Y, facing Z?)
        // Frond geometry was: Box(..., height=2.3). Translated(0, 1.15, 0).
        // So p3.y is 0..2.3. p3.z is thickness. p3.x is width.

        // --- APPLY CURL LOGIC ---
        // Logic from original code, adapted for p3
        const baseUnfurl = this.uFernUnfurl;
        const spatialDelay = sin(positionWorld.x.mul(0.5).add(positionWorld.z.mul(0.3))).mul(0.1);
        const instanceUnfurl = baseUnfurl.add(spatialDelay).clamp(0.0, 1.0);

        const yNorm = p3.y.div(float(frondHeight));

        const maxCurl = float(-4.0);
        const minCurl = float(-0.2);
        const currentTotalCurl = mix(maxCurl, minCurl, instanceUnfurl);

        const theta = currentTotalCurl.mul(yNorm);
        const wavePhase = uTime.mul(5.0).add(yNorm.mul(4.0));
        const wave = sin(wavePhase).mul(0.1).mul(instanceUnfurl).mul(yNorm);

        const finalAngle = theta.add(wave);

        const cCurl = cos(finalAngle);
        const sCurl = sin(finalAngle);

        // Curl around X axis (modifying Y and Z)
        // y' = y*cos - z*sin
        // z' = y*sin + z*cos
        const curledY = p3.y.mul(cCurl).sub(p3.z.mul(sCurl));
        const curledZ = p3.y.mul(sCurl).add(p3.z.mul(cCurl));

        const pCurled = vec3(p3.x, curledY, curledZ);

        // --- RE-WIND ROTATION ---
        // Inverse of Step 3 (Rotate X)
        const cX2 = cos(frondTilt);
        const sX2 = sin(frondTilt);
        const p4 = vec3(
            pCurled.x,
            pCurled.y.mul(cX2).sub(pCurled.z.mul(sX2)),
            pCurled.y.mul(sX2).add(pCurled.z.mul(cX2))
        );

        // Inverse of Step 2 (Rotate Y)
        const cY2 = cos(frondAngle);
        const sY2 = sin(frondAngle);
        const p5 = vec3(
            p4.x.mul(cY2).sub(p4.z.mul(sY2)),
            p4.y,
            p4.x.mul(sY2).add(p4.z.mul(cY2))
        );

        // Inverse of Step 1 (Translate Y)
        const pFinalFrond = vec3(p5.x, p5.y.add(float(frondYOffset)), p5.z);

        // --- COMBINE WITH BASE ---
        // If it's a base vertex, use original position. If frond, use curled.
        const combinedPos = mix(pos, pFinalFrond, isFrondAttr);

        // --- JUICE (Audio, Interaction, Wind) ---
        // Audio Pulse (Scale width/thickness with High Freq)
        const audioScale = uAudioHigh.mul(0.3).add(1.0);
        // Apply audio scale only to fronds? Or both?
        // Original code applied to fronds only.
        const pulsedPos = mix(
            combinedPos,
            vec3(combinedPos.x.mul(audioScale), combinedPos.y, combinedPos.z.mul(audioScale)),
            isFrondAttr
        );

        // Interaction (Bending)
        const withInteraction = applyPlayerInteraction(pulsedPos);

        // Wind Sway
        const withWind = withInteraction.add(calculateWindSway(pulsedPos));

        // Bobbing (Unfurl bounce)
        const bob = instanceUnfurl.mul(0.2);
        const finalPos = withWind.add(vec3(0, bob, 0));

        const glitched = applyGlitch(uv(), finalPos, uGlitchIntensity);
        material.positionNode = glitched.position;

        // Fragment Shader: Instance Color Tint + Rim Light
        const baseInstanceColor = attribute('instanceColor', 'vec3');
        // Mix instance color into base color
        material.colorNode = mixedColor.mul(baseInstanceColor);

        // Juicy Rim Light
        const rim = createJuicyRimLight(baseInstanceColor, float(2.0), float(3.0), null);
        const audioEmissive = uAudioHigh.mul(0.5);
        material.emissiveNode = rim.add(baseInstanceColor.mul(audioEmissive));

        // --- INSTANCED MESH ---
        this.mesh = new THREE.InstancedMesh(mergedGeo, material, MAX_FERNS);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FERNS * 3), 3);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;

        foliageGroup.add(this.mesh);

        this.initialized = true;
        console.log(`[ArpeggioBatcher] Initialized unified mesh system (Cap: ${MAX_FERNS})`);
    }

    register(dummy, options: any = {}) {
        if (!this.initialized) this.init();
        if (this.count >= MAX_FERNS) {
            console.warn('[ArpeggioBatcher] Max limit reached');
            return;
        }

        const { color = 0x00FF88, scale = 1.0 } = options;
        const i = this.count;
        this.count++;

        // Store reference
        dummy.userData.batchIndex = i;
        dummy.userData.unfurlFactor = 0;
        this.logicFerns.push(dummy);

        // Setup Instance (Only ONE matrix per fern now!)
        this.dummy.position.copy(dummy.position);
        // No extra Y offset needed, baked into geometry logic relative to pivot
        // Base was offset 0.25, Frond 0.4.
        // But original register() added 0.25 * scale to base, and 0.4 * scale to frond.
        // Wait, scale applies to the whole object.
        // If we scale the object, offsets scale too.
        // We should just set the matrix.
        // But the geometry assumes a specific pivot?
        // Base geometry was translated (0, 0.25, 0). So pivot is at 0.
        // Frond geometry was translated (0, 0.4, 0) relative to base?
        // In original register():
        // Base: pos.y += 0.25 * scale
        // Frond: pos.y += 0.4 * scale
        // This implies the pivot of the *Instance* is at y=0, but the parts are lifted.
        // If I bake the lift (0.25 and 0.4) into the geometry, I don't need to add it to the matrix position.
        // BUT, I merged Base (y+0.25) and Frond (y+0.4).
        // So the merged geometry has its bottom at y=0 (actually base starts at 0, cone height 0.5 centered at 0.25).
        // So yes, pivot is at bottom.

        // So I just need to copy dummy position/rotation/scale.
        this.dummy.rotation.copy(dummy.rotation);
        this.dummy.scale.setScalar(scale);
        this.dummy.updateMatrix();

        this.mesh!.setMatrixAt(i, this.dummy.matrix);

        // Color
        this._color.setHex(color);
        this.mesh!.setColorAt(i, this._color);

        // Update count
        this.mesh!.count = this.count;
        this.mesh!.instanceMatrix.needsUpdate = true;
        if (this.mesh!.instanceColor) this.mesh!.instanceColor.needsUpdate = true;
    }

    updateInstance(index, dummy) {
        if (!this.initialized) return;

        // Simple Matrix Update (1 per fern!)
        this.dummy.position.copy(dummy.position);
        this.dummy.rotation.copy(dummy.rotation);
        this.dummy.scale.copy(dummy.scale);
        this.dummy.updateMatrix();

        this.mesh!.setMatrixAt(index, this.dummy.matrix);
        this.mesh!.instanceMatrix.needsUpdate = true;
    }

    update(audioState: any = null) {
        if (!this.initialized || this.count === 0) return;

        // Logic (Same as before)
        let arpeggioActive = false;
        let noteTrigger = false;
        if (audioState && audioState.channelData) {
            for (const ch of audioState.channelData) {
                if (ch.activeEffect === 4 || (ch.activeEffect === 0 && ch.effectValue && ch.effectValue > 0)) {
                    arpeggioActive = true;
                }
                if (ch.trigger > 0.1) {
                    noteTrigger = true;
                }
            }
        }

        const maxSteps = 12;
        let nextTarget = this.currentTargetStep;

        if (arpeggioActive) {
            if (noteTrigger && !this.lastTrigger) {
                nextTarget += 1;
                if (nextTarget > maxSteps) nextTarget = maxSteps;
            }
        } else {
            nextTarget = 0;
        }

        this.currentTargetStep = nextTarget;
        this.lastTrigger = noteTrigger;

        const speed = (nextTarget > this.currentUnfurlValue) ? 0.3 : 0.05;
        this.currentUnfurlValue += (nextTarget - this.currentUnfurlValue) * speed;

        const unfurl = this.currentUnfurlValue / maxSteps;

        this.globalUnfurl = unfurl;
        this.uFernUnfurl.value = unfurl;
    }
}

export const arpeggioFernBatcher = new ArpeggioFernBatcher();
