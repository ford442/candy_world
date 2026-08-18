import * as THREE from 'three';
import { color, float, mix, positionLocal, normalWorld, smoothstep } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { getLoadMemoryTier } from '../core/config.ts';
import { getCIAdjustedCount } from '../core/config.ts';
import { getBiomeUniforms } from '../systems/biome-uniforms.ts';
import { worldGroup } from '../world/state.ts';
import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';
import { createJuicyRimLight, applyStandardDeformation, triplanarNoise, uAudioLow } from './index.ts';
import { uTwilight } from './sky.ts';

const _scratchMatrix = new THREE.Matrix4();
const _scratchPos = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3();
const _scratchHide = new THREE.Matrix4().makeScale(0, 0, 0);

const SUGAR_RIB_MAX = getCIAdjustedCount(800, 0.1, 150);

export class SugarCaveBatcher {
    private _mesh: THREE.InstancedMesh | null = null;
    private _geo: THREE.ConeGeometry | null = null;
    private _mat: MeshStandardNodeMaterial | null = null;
    private _count = 0;

    init(): void {
        if (this._mesh) return;

        this._geo = new THREE.ConeGeometry(0.8, 3.0, 8);
        const pos = this._geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            if (y < 1.4) {
                pos.setX(i, x + (Math.random() - 0.5) * 0.3);
                pos.setZ(i, z + (Math.random() - 0.5) * 0.3);
            }
        }
        this._geo.computeVertexNormals();

        const uniforms = getBiomeUniforms('sugar_caves');

        this._mat = new MeshStandardNodeMaterial();

        const crystalNoiseScale = float(1.5);
        const crystalNoise = triplanarNoise(positionLocal, crystalNoiseScale);

        const colorCore = color(0xff69b4); // Hot pink base
        const colorTip = uniforms.noteColor; // Reactive tip

        const tipFactor = smoothstep(float(-1.5), float(1.5), positionLocal.y);
        const crystalBaseColor = mix(colorCore, colorTip, tipFactor);

        const crystalPulse = uAudioLow.mul(1.5).add(0.2);
        const crystalGlowStrength = tipFactor
            .mul(crystalPulse)
            .mul(uTwilight)
            .mul(3.0)
            .add(uniforms.shimmer.mul(2.0));
        const crystalGlowColor = uniforms.noteColor;

        const crystalRim = createJuicyRimLight(
            color(0xffffff),
            float(0.8),
            float(3.0),
            normalWorld
        );

        this._mat.positionNode = applyStandardDeformation(positionLocal);
        this._mat.colorNode = crystalBaseColor.add(crystalRim);
        this._mat.emissiveNode = crystalGlowColor.mul(crystalGlowStrength);
        this._mat.roughnessNode = float(0.2).add(crystalNoise.mul(0.1));
        this._mat.metalnessNode = float(0.2);

        this._mesh = new THREE.InstancedMesh(this._geo, this._mat, SUGAR_RIB_MAX);
        this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this._mesh.castShadow = true;
        this._mesh.receiveShadow = true;

        // Hide all initially
        for (let i = 0; i < SUGAR_RIB_MAX; i++) {
            _scratchHide.toArray(this._mesh.instanceMatrix.array, i * 16);
        }
        this._mesh.instanceMatrix.needsUpdate = true;
        this._mesh.count = 0;

        worldGroup.add(this._mesh);
    }

    add(position: THREE.Vector3, quaternion: THREE.Quaternion, scale: number): void {
        if (!this._mesh) this.init();
        if (!this._mesh || this._count >= SUGAR_RIB_MAX) return;

        _scratchScale.set(scale * 0.5, scale, scale * 0.5);
        _scratchMatrix.compose(position, quaternion, _scratchScale);

        // Zero-allocation matrix write
        _scratchMatrix.toArray(this._mesh.instanceMatrix.array, this._count * 16);
        this._mesh.instanceMatrix.needsUpdate = true;

        this._count++;
        this._mesh.count = this._count;
    }

    clear(): void {
        this._count = 0;
        if (this._mesh) {
            this._mesh.count = 0;
        }
    }

    dispose(): void {
        if (this._mesh) {
            safeRemoveAndDispose(worldGroup, this._mesh);
            this._mesh = null;
        }
        if (this._geo) {
            this._geo.dispose();
            this._geo = null;
        }
        if (this._mat) {
            this._mat.dispose();
            this._mat = null;
        }
        this._count = 0;
    }
}

export const sugarCaveBatcher = new SugarCaveBatcher();
