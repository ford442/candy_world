import type * as THREE from 'three';
import { InstancedBatcher } from '../../core/batcher/instanced-batcher.ts';
import { INSTANCE_LOD_ATTR } from '../batcher-lod-utils.ts';

/** One instance of one tree part (a trunk, a leaf ball, a rose). */
export interface TreePartRecord {
    /** World matrix, column-major (Matrix4.elements). */
    matrix: Float32Array;
    r: number;
    g: number;
    b: number;
    animType: number;
    animOffset: number;
}

/**
 * The slots of one tree mesh (#2166). TreeBatcher owns six of these; a tree
 * owns one handle per sub-mesh it was built from, spread across them.
 *
 * The mesh is built by initializeTreeBatcherMeshes (the six share a material
 * set-up), so createMesh hands back the mesh `getMesh` returns. Matrices,
 * instanceColor, instanceAnimType/Offset and instanceLodFactor are slot
 * streams: the base copies them on swap-remove and uploads them.
 */
export class TreePartBatcher extends InstancedBatcher<TreePartRecord> {
    private animType: THREE.InstancedBufferAttribute | null = null;
    private animOffset: THREE.InstancedBufferAttribute | null = null;

    constructor(
        id: string,
        capacity: number,
        private readonly getMesh: () => THREE.InstancedMesh
    ) {
        super(id, 'animate', capacity);
    }

    /** Take the mesh from getMesh now and register its per-instance attributes. */
    attach(): THREE.InstancedMesh {
        const mesh = this.ensureMesh();
        const attrs = mesh.geometry.attributes;
        this.animType = this.optionalAttribute(attrs.instanceAnimType);
        this.animOffset = this.optionalAttribute(attrs.instanceAnimOffset);
        this.optionalAttribute(attrs[INSTANCE_LOD_ATTR]);
        return mesh;
    }

    private optionalAttribute(
        attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined
    ): THREE.InstancedBufferAttribute | null {
        if (!attr || !(attr as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) return null;
        return this.registerAttribute(attr as THREE.InstancedBufferAttribute);
    }

    protected createMesh(_capacity: number): THREE.InstancedMesh {
        return this.getMesh();
    }

    protected writeRecord(record: TreePartRecord, slot: number, array: Float32Array): void {
        array.set(record.matrix, slot * 16);
        const color = this.mesh!.instanceColor;
        if (color) {
            const c = color.array as Float32Array;
            c[slot * 3] = record.r;
            c[slot * 3 + 1] = record.g;
            c[slot * 3 + 2] = record.b;
        }
        if (this.animType) (this.animType.array as Float32Array)[slot] = record.animType;
        if (this.animOffset) (this.animOffset.array as Float32Array)[slot] = record.animOffset;
    }

    protected step(): void {}
}
