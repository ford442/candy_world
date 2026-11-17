import * as THREE from 'three';
import type { System, Phase, FrameContext } from '../scheduler/types.ts';

/**
 * Shared base for instanced foliage and prop batchers (#1973, #2166).
 *
 * One record per instance, packed into slots `[0, count)` of every mesh the
 * batcher owns. Removal swaps the last slot into the hole, so the draw count
 * always equals the live count and no hidden zero-scale instances are drawn.
 *
 * What the base owns, so a port does not re-implement it:
 *   slots        handle ↔ slot maps, swap-remove, optional object keys
 *                (`addKeyed`/`removeKeyed`, so an entity-kind despawn hook can
 *                pass the Object3D it was given)
 *   meshes       the primary mesh from createMesh() plus any `linkMesh()`ed
 *                mesh that shares its slots; `count` kept in sync on all
 *   streams      every mesh's instanceMatrix and instanceColor, plus each
 *                attribute from `registerAttribute()`: copied on swap, and
 *                uploaded once per update() with the dirty slot range
 *   LOD          `setLod(factor)` → `onLod(factor)` when it changes
 *   dispose      geometry, materials, every registered attribute, parent
 *                detach; state reset so the batcher can be filled again
 *
 * Ranged uploads (`rangedUploads = true`) upload only the dirty slots. With
 * them on, write batcher-owned streams only through the base (writeRecord,
 * `markSlotDirty`, `markAllDirty`): a bare `needsUpdate = true` set while a
 * range is pending would upload only that range.
 */
/** What addKeyed() keys a record by: an Object3D id, a uuid. */
export type SlotKey = number | string;

/** Every constructed batcher; the `instanced-batchers` frame system updates them all. */
const LIVE = new Set<InstancedBatcher<unknown>>();

/**
 * Run update() (step + upload) on every batcher. Registered once in
 * FRAME_SYSTEMS (src/core/game-loop-systems.ts), so a port needs no
 * registration of its own; before this, the two ported batchers' update()
 * was never called and their uploads never ran.
 */
export function updateInstancedBatchers(ctx: FrameContext): void {
    for (const b of LIVE) b.update(ctx);
}

/** The live batchers, for telemetry and tests. */
export function liveInstancedBatchers(): readonly InstancedBatcher<unknown>[] {
    return [...LIVE];
}

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

    /** Opt-in: upload only the dirty slot range instead of whole streams. */
    protected rangedUploads = false;

    private linked: { mesh: THREE.InstancedMesh; perSlot: number }[] = [];
    private attributes: { attr: THREE.InstancedBufferAttribute; perSlot: number }[] = [];
    private keyToHandle = new Map<SlotKey, number>();
    private dirtyMin = Infinity;
    private boundsDirty = false;
    private dirtyMax = -1;
    private lodFactor = -1;

    constructor(id: string, phase: Phase = 'animate', capacity: number = 1000, budgetMs?: number) {
        this.id = id;
        this.phase = phase;
        this.capacity = capacity;
        this.budgetMs = budgetMs;
        LIVE.add(this as InstancedBatcher<unknown>);
    }

    protected abstract createMesh(capacity: number): THREE.InstancedMesh;

    /**
     * Write the record into slot `slot`. `array` is the primary mesh's
     * instanceMatrix; write linked meshes and registered attributes here too.
     * Called on add and again for the record moved by a swap-remove.
     */
    protected abstract writeRecord(record: TRecord, slot: number, array: Float32Array): void;

    /**
     * Called during a swap-remove before writeRecord re-writes the moved
     * record. Streams the base knows about are already copied; use this for
     * side tables (per-slot JS arrays, note → slot maps).
     */
    protected onSwap(_fromSlot: number, _toSlot: number): void {}

    /** Called when setLod() changes the factor (0 = full detail, 1 = farthest). */
    protected onLod(_factor: number): void {}

    /** Subclasses can implement their specific update logic here */
    protected abstract step(ctx: FrameContext): void;

    // -------------------------------------------------------------------------
    // Meshes and streams
    // -------------------------------------------------------------------------

    /** Create the primary mesh now instead of on the first add(). */
    protected ensureMesh(): THREE.InstancedMesh {
        if (!this.mesh) {
            this.mesh = this.createMesh(this.capacity);
            this.mesh.count = this.count;
        }
        return this.mesh;
    }

    /**
     * A second mesh drawn per slot (a stem under a bulb, a plume over a base).
     * `perSlot` instances per slot (8 splashes per waterfall): slot s owns
     * instances [s * perSlot, (s + 1) * perSlot).
     */
    protected linkMesh(mesh: THREE.InstancedMesh, perSlot = 1): THREE.InstancedMesh {
        if (mesh.instanceMatrix.count < this.capacity * perSlot) throw new RangeError(this.id);
        mesh.count = this.count * perSlot;
        this.linked.push({ mesh, perSlot });
        return mesh;
    }

    /**
     * A per-instance attribute the base copies on swap, uploads and disposes
     * (with its geometry). `perSlot` items per slot, as for linkMesh.
     */
    protected registerAttribute<A extends THREE.InstancedBufferAttribute>(attr: A, perSlot = 1): A {
        if (attr.count < this.capacity * perSlot) throw new RangeError(this.id);
        this.attributes.push({ attr, perSlot });
        return attr;
    }

    /** Every mesh this batcher draws: the primary first, then linked meshes. */
    get meshes(): THREE.InstancedMesh[] {
        const linked = this.linked.map((l) => l.mesh);
        return this.mesh ? [this.mesh, ...linked] : linked;
    }

    get instanceCount(): number {
        return this.count;
    }

    get maxInstances(): number {
        return this.capacity;
    }

    /** Every per-instance stream, with how many items each slot owns. */
    private streams(): { attr: THREE.BufferAttribute; perSlot: number }[] {
        const out: { attr: THREE.BufferAttribute; perSlot: number }[] = [];
        const meshes = this.mesh ? [{ mesh: this.mesh, perSlot: 1 }, ...this.linked] : this.linked;
        for (const { mesh, perSlot } of meshes) {
            out.push({ attr: mesh.instanceMatrix, perSlot });
            if (mesh.instanceColor) out.push({ attr: mesh.instanceColor, perSlot });
        }
        out.push(...this.attributes);
        return out;
    }

    // -------------------------------------------------------------------------
    // Slots
    // -------------------------------------------------------------------------

    add(record: TRecord): number | null {
        const mesh = this.ensureMesh();
        if (this.count >= this.capacity) return null;

        const slot = this.count++;
        const handle = this.nextHandleId++;

        this.slotToHandle[slot] = handle;
        this.handleToSlot.set(handle, slot);
        this.records[slot] = record;

        this.writeRecord(record, slot, mesh.instanceMatrix.array as Float32Array);
        this.syncCounts();
        this.markSlotDirty(slot);
        this.boundsDirty = true;
        return handle;
    }

    /** add() keyed by an id (Object3D.id, a uuid), so removeKeyed() can find it. */
    addKeyed(key: SlotKey, record: TRecord): number | null {
        const existing = this.keyToHandle.get(key);
        if (existing !== undefined && this.handleToSlot.has(existing)) return existing;
        const handle = this.add(record);
        if (handle !== null) this.keyToHandle.set(key, handle);
        return handle;
    }

    removeKeyed(key: SlotKey): boolean {
        const handle = this.keyToHandle.get(key);
        if (handle === undefined) return false;
        this.keyToHandle.delete(key);
        this.remove(handle);
        return true;
    }

    hasKey(key: SlotKey): boolean {
        return this.keyToHandle.has(key);
    }

    slotOf(handle: number): number | undefined {
        return this.handleToSlot.get(handle);
    }

    slotOfKey(key: SlotKey): number | undefined {
        const handle = this.keyToHandle.get(key);
        return handle === undefined ? undefined : this.handleToSlot.get(handle);
    }

    recordAt(slot: number): TRecord | null {
        return slot < this.count ? (this.records[slot] ?? null) : null;
    }

    remove(handle: number): void {
        if (!this.mesh) return;

        const slotToRemove = this.handleToSlot.get(handle);
        if (slotToRemove === undefined) return;

        const lastSlot = this.count - 1;

        if (slotToRemove !== lastSlot) {
            const lastHandle = this.slotToHandle[lastSlot];
            const lastRecord = this.records[lastSlot] as TRecord;

            this.slotToHandle[slotToRemove] = lastHandle;
            this.handleToSlot.set(lastHandle, slotToRemove);
            this.records[slotToRemove] = lastRecord;

            for (const s of this.streams()) copySlot(s.attr, s.perSlot, lastSlot, slotToRemove);
            this.onSwap(lastSlot, slotToRemove);
            this.writeRecord(
                lastRecord,
                slotToRemove,
                this.mesh.instanceMatrix.array as Float32Array
            );
            this.markSlotDirty(slotToRemove);
        }

        this.handleToSlot.delete(handle);
        this.slotToHandle.pop();
        this.records.pop();
        this.count--;
        this.syncCounts();
        // The draw count shrank; nothing past it needs uploading.
        this.matricesDirty = true;
        this.boundsDirty = true;
    }

    /** Remove every instance; meshes and attributes stay allocated. */
    clear(): void {
        this.slotToHandle.length = 0;
        this.handleToSlot.clear();
        this.records.length = 0;
        this.keyToHandle.clear();
        this.count = 0;
        this.syncCounts();
        this.dirtyMin = Infinity;
        this.dirtyMax = -1;
        this.boundsDirty = true;
    }

    private syncCounts(): void {
        if (this.mesh) this.mesh.count = this.count;
        for (const l of this.linked) l.mesh.count = this.count * l.perSlot;
    }

    // -------------------------------------------------------------------------
    // Dirty tracking and upload
    // -------------------------------------------------------------------------

    /** The legacy flag: upload every stream at the next update(). */
    protected markDirty(): void {
        this.markAllDirty();
    }

    /** Slot `slot` changed in some stream; widen the pending upload range. */
    protected markSlotDirty(slot: number): void {
        if (slot < this.dirtyMin) this.dirtyMin = slot;
        if (slot > this.dirtyMax) this.dirtyMax = slot;
        this.matricesDirty = true;
    }

    protected markAllDirty(): void {
        this.dirtyMin = 0;
        this.dirtyMax = Math.max(this.dirtyMax, this.count - 1);
        this.matricesDirty = true;
    }

    /** Upload pending changes now (update() does this after step()). */
    flush(): void {
        // InstancedMesh culls against a bounding sphere computed once from the
        // instances present then; drop it so it covers the current set. Kept
        // apart from matricesDirty, which a subclass step() may clear itself.
        if (this.boundsDirty) {
            this.boundsDirty = false;
            for (const m of this.meshes) if (m.frustumCulled) m.boundingSphere = null;
        }
        if (!this.matricesDirty) return;
        this.matricesDirty = false;
        const lo = this.dirtyMin;
        const hi = Math.min(this.dirtyMax, this.count - 1);
        this.dirtyMin = Infinity;
        this.dirtyMax = -1;
        if (hi < lo) return;
        for (const { attr, perSlot } of this.streams()) {
            const n = attr.itemSize * perSlot;
            if (this.rangedUploads) addMergedRange(attr, lo * n, (hi - lo + 1) * n);
            attr.needsUpdate = true;
        }
    }

    update(ctx: FrameContext): void {
        this.step(ctx);
        this.flush();
    }

    // -------------------------------------------------------------------------
    // LOD
    // -------------------------------------------------------------------------

    /** Set the LOD factor; onLod runs only when it changes. */
    setLod(factor: number): void {
        const f = Math.min(1, Math.max(0, factor));
        if (f === this.lodFactor) return;
        this.lodFactor = f;
        this.onLod(f);
    }

    get lod(): number {
        return this.lodFactor < 0 ? 0 : this.lodFactor;
    }

    // -------------------------------------------------------------------------
    // Dispose
    // -------------------------------------------------------------------------

    /**
     * Free every mesh's geometry and materials and every registered
     * attribute, detach the meshes, and reset to empty. A later add()
     * creates the primary mesh again (linked meshes are the subclass's to
     * recreate, in createMesh).
     */
    dispose(): void {
        const geometries = new Set<THREE.BufferGeometry>();
        const materials = new Set<THREE.Material>();
        for (const m of this.meshes) {
            m.removeFromParent();
            geometries.add(m.geometry);
            // A shared material (foliageMaterials, a preset) is not ours to free.
            if (!m.userData?.preventMaterialDispose) {
                for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
                    if (mat) materials.add(mat);
                }
            }
            m.dispose(); // frees instanceMatrix / instanceColor on the renderer
        }
        for (const g of geometries) g.dispose();
        for (const mat of materials) {
            (mat as THREE.MeshStandardMaterial).map?.dispose();
            mat.dispose();
        }
        this.mesh = null;
        this.linked = [];
        this.attributes = [];
        this.lodFactor = -1;
        this.clear();
    }
}

/** Past this many pending ranges on one stream, upload one range covering them all. */
const MAX_PENDING_RANGES = 16;

/**
 * Add an upload range, merging it into the last pending one when they touch
 * or overlap (flushes between renders, such as one per register() during
 * generation, append to adjacent slots). The renderer clears the list after
 * each upload.
 */
export function addMergedRange(attr: THREE.BufferAttribute, start: number, count: number): void {
    const ranges = attr.updateRanges;
    const last = ranges[ranges.length - 1];
    if (last && start <= last.start + last.count && start + count >= last.start) {
        const end = Math.max(last.start + last.count, start + count);
        last.start = Math.min(last.start, start);
        last.count = end - last.start;
        return;
    }
    if (ranges.length >= MAX_PENDING_RANGES) {
        let lo = start;
        let hi = start + count;
        for (const r of ranges) {
            lo = Math.min(lo, r.start);
            hi = Math.max(hi, r.start + r.count);
        }
        attr.clearUpdateRanges();
        attr.addUpdateRange(lo, hi - lo);
        return;
    }
    attr.addUpdateRange(start, count);
}

/** Copy slot `from`'s items (perSlot × itemSize components) of a stream to slot `to`. */
function copySlot(attr: THREE.BufferAttribute, perSlot: number, from: number, to: number): void {
    const n = attr.itemSize * perSlot;
    const a = attr.array as Float32Array;
    a.copyWithin(to * n, from * n, from * n + n);
}
