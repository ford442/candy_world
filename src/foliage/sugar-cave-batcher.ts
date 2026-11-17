import * as THREE from 'three';
import { color, float, mix, positionLocal, normalWorld, smoothstep } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { InstancedBatcher } from '../core/batcher/instanced-batcher.ts';
import { getLoadMemoryTier } from '../core/config.ts';
import { getCIAdjustedCount } from '../core/config.ts';
import { getBiomeUniforms } from '../systems/biome-uniforms.ts';
import { worldGroup } from '../world/state.ts';
import {
    createJuicyRimLight,
    applyStandardDeformation,
    triplanarNoise,
    uAudioLow,
} from './material-core.ts';
import { uTwilight } from './sky.ts';

const _scratchMatrix = new THREE.Matrix4();
const _scratchScale = new THREE.Vector3();

const SUGAR_RIB_MAX = getCIAdjustedCount(800, 0.1, 150);

interface SugarRib {
    /** Column-major instance matrix, so a swap-remove can rewrite the slot. */
    matrix: Float32Array;
}

/** The slot space for the crystal ribs. */
class SugarRibSlots extends InstancedBatcher<SugarRib> {
    constructor() {
        super('sugar-cave', 'animate', SUGAR_RIB_MAX);
        this.rangedUploads = true;
    }

    protected createMesh(capacity: number): THREE.InstancedMesh {
        const geo = new THREE.ConeGeometry(0.8, 3.0, 8);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            if (y < 1.4) {
                pos.setX(i, x + (Math.random() - 0.5) * 0.3);
                pos.setZ(i, z + (Math.random() - 0.5) * 0.3);
            }
        }
        geo.computeVertexNormals();

        const uniforms = getBiomeUniforms('sugar_caves');

        const mat = new MeshStandardNodeMaterial();

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

        mat.positionNode = applyStandardDeformation(positionLocal);
        mat.colorNode = crystalBaseColor.add(crystalRim);
        mat.emissiveNode = crystalGlowColor.mul(crystalGlowStrength);
        mat.roughnessNode = float(0.2).add(crystalNoise.mul(0.1));
        mat.metalnessNode = float(0.2);

        const mesh = new THREE.InstancedMesh(geo, mat, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.count = 0;
        worldGroup.add(mesh);
        return mesh;
    }

    protected writeRecord(r: SugarRib, slot: number, array: Float32Array): void {
        array.set(r.matrix, slot * 16);
    }

    protected step(): void {
        // Static instances; glow and sway are in the TSL graph.
    }

    open(): THREE.InstancedMesh {
        return this.ensureMesh();
    }
}

/**
 * Crystal ribs in the sugar caves (#2166: ported to InstancedBatcher, through
 * SugarRibSlots). Public API unchanged; register() keys by Object3D.id, so
 * userData.batchIndex is no longer written.
 */
export class SugarCaveBatcher {
    private readonly slots = new SugarRibSlots();

    init(): void {
        this.slots.open();
    }

    private record(position: THREE.Vector3, quaternion: THREE.Quaternion, scale: number): SugarRib {
        _scratchScale.set(scale * 0.5, scale, scale * 0.5);
        _scratchMatrix.compose(position, quaternion, _scratchScale);
        return { matrix: new Float32Array(_scratchMatrix.elements) };
    }

    add(position: THREE.Vector3, quaternion: THREE.Quaternion, scale: number): void {
        this.slots.add(this.record(position, quaternion, scale));
        // Generation adds outside the frame; upload now.
        this.slots.flush();
    }

    register(logicObject: THREE.Object3D): void {
        this.slots.addKeyed(
            logicObject.id,
            this.record(logicObject.position, logicObject.quaternion, logicObject.scale.y)
        );
        this.slots.flush();
    }

    removeInstance(logicObject: THREE.Object3D): void {
        if (this.slots.removeKeyed(logicObject.id)) this.slots.flush();
    }

    clear(): void {
        this.slots.clear();
    }

    dispose(): void {
        this.slots.dispose();
    }

    get mesh(): THREE.InstancedMesh | null {
        return this.slots.mesh;
    }

    get count(): number {
        return this.slots.instanceCount;
    }
}

export const sugarCaveBatcher = new SugarCaveBatcher();
