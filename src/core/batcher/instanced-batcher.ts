import * as THREE from 'three';
import { safeRemoveAndDispose } from '../../utils/dispose-utils.ts';
import type { System, Phase, FrameContext } from '../scheduler/types.ts';

export abstract class InstancedBatcher<TRecord> implements System {
    readonly id: string;
    readonly phase: Phase;
    readonly budgetMs?: number;

    mesh: THREE.InstancedMesh | null = null;
    protected count = 0;
    protected capacity: number;
    protected matricesDirty = false;

    protected slotToHandle: number[] = [];
    protected handleToSlot: Map<number, number> = new Map();
    protected records: (TRecord | null)[] = [];
    private nextHandleId = 1;

    constructor(id: string, phase: Phase = 'animate', capacity: number = 1000, budgetMs?: number) {
        this.id = id;
        this.phase = phase;
        this.capacity = capacity;
        this.budgetMs = budgetMs;
    }

    protected abstract createMesh(capacity: number): THREE.InstancedMesh;

    /** Writes the record directly into mesh.instanceMatrix.array */
    protected abstract writeRecord(record: TRecord, slot: number, array: Float32Array): void;

    /** Hook called when the last slot is swapped into the removed slot */
    protected onSwap(fromSlot: number, toSlot: number): void {}

    /** Subclasses can implement their specific update logic here */
    protected abstract step(ctx: FrameContext): void;

    add(record: TRecord): number | null {
        if (!this.mesh) {
            this.mesh = this.createMesh(this.capacity);
            this.mesh.count = 0;
        }

        if (this.count >= this.capacity) {
            return null;
        }

        const slot = this.count++;
        const handle = this.nextHandleId++;

        this.slotToHandle[slot] = handle;
        this.handleToSlot.set(handle, slot);
        this.records[slot] = record;

        this.writeRecord(record, slot, this.mesh.instanceMatrix.array as Float32Array);
        this.markDirty();

        return handle;
    }

    remove(handle: number): void {
        if (!this.mesh) return;

        const slotToRemove = this.handleToSlot.get(handle);
        if (slotToRemove === undefined) return;

        const lastSlot = this.count - 1;

        if (slotToRemove !== lastSlot) {
            // Swap-remove
            const lastHandle = this.slotToHandle[lastSlot];
            const lastRecord = this.records[lastSlot] as TRecord;

            // Update mappings
            this.slotToHandle[slotToRemove] = lastHandle;
            this.handleToSlot.set(lastHandle, slotToRemove);
            this.records[slotToRemove] = lastRecord;

            // Call hook before writing the record so subclass can copy custom arrays
            this.onSwap(lastSlot, slotToRemove);

            // Copy matrix data
            const array = this.mesh.instanceMatrix.array as Float32Array;
            for (let i = 0; i < 16; i++) {
                array[slotToRemove * 16 + i] = array[lastSlot * 16 + i];
            }
            this.writeRecord(lastRecord, slotToRemove, array); // Trigger subclass updates (like colors or extra attributes if needed)
            this.markDirty();
        }

        // Clean up
        this.handleToSlot.delete(handle);
        this.slotToHandle.pop();
        this.records.pop();
        this.count--;

        if (this.mesh) {
            this.mesh.count = this.count;
            this.markDirty();
        }
    }

    protected markDirty(): void {
        this.matricesDirty = true;
    }

    update(ctx: FrameContext): void {
        this.step(ctx);

        if (this.matricesDirty && this.mesh) {
            this.mesh.instanceMatrix.needsUpdate = true;
            this.matricesDirty = false;
        }
    }

    dispose(): void {
        if (this.mesh) {
            if (this.mesh.parent) {
                safeRemoveAndDispose(this.mesh.parent, this.mesh);
            } else {
                if (this.mesh.geometry) this.mesh.geometry.dispose();
                if (this.mesh.material) {
                    if (Array.isArray(this.mesh.material)) {
                        this.mesh.material.forEach(m => m.dispose());
                    } else {
                        this.mesh.material.dispose();
                    }
                }
            }
        }
    }
}
