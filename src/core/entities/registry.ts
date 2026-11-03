import type * as THREE from 'three';

export interface EntityHooks {
    onSpawn: (id: string, obj: THREE.Object3D) => void;
    onDespawn: (id: string, obj: THREE.Object3D) => void;
}

export class EntityRegistry {
    private readonly hooks = new Map<string, EntityHooks>();
    // Maintains a record of the object and all the kinds it is registered under.
    private readonly byId = new Map<string, { obj: THREE.Object3D, kinds: Set<string> }>();
    // For fast membership queries, maintained alongside byId.
    private readonly byKind = new Map<string, Set<THREE.Object3D>>();

    registerKind(kind: string, hooks: EntityHooks) {
        if (this.hooks.has(kind)) {
            console.warn(`[EntityRegistry] Kind ${kind} already registered`);
            return;
        }
        this.hooks.set(kind, hooks);
        this.byKind.set(kind, new Set());
    }

    spawn(kind: string, obj: THREE.Object3D): string {
        const id = obj.uuid;

        let record = this.byId.get(id);
        if (record) {
            if (record.obj !== obj) {
                throw new Error(`[EntityRegistry] Collision: Object ID ${id} already exists for a different object.`);
            }
            if (record.kinds.has(kind)) {
                return id; // Already registered under this kind.
            }
            record.kinds.add(kind);
        } else {
            record = { obj, kinds: new Set([kind]) };
            this.byId.set(id, record);
        }

        let kindSet = this.byKind.get(kind);
        if (!kindSet) {
            kindSet = new Set();
            this.byKind.set(kind, kindSet);
        }
        kindSet.add(obj);

        const hooks = this.hooks.get(kind);
        if (hooks?.onSpawn) {
            hooks.onSpawn(id, obj);
        }

        return id;
    }

    despawn(id: string, kind?: string): boolean {
        const record = this.byId.get(id);
        if (!record) return false;

        const { obj, kinds } = record;

        if (kind) {
            if (!kinds.has(kind)) return false;
            kinds.delete(kind);

            const kindSet = this.byKind.get(kind);
            if (kindSet) kindSet.delete(obj);

            const hooks = this.hooks.get(kind);
            if (hooks?.onDespawn) {
                hooks.onDespawn(id, obj);
            }

            if (kinds.size === 0) {
                this.byId.delete(id);
            }
        } else {
            for (const k of kinds) {
                const kindSet = this.byKind.get(k);
                if (kindSet) kindSet.delete(obj);

                const hooks = this.hooks.get(k);
                if (hooks?.onDespawn) {
                    hooks.onDespawn(id, obj);
                }
            }
            this.byId.delete(id);
        }

        return true;
    }

    query(kind: string): ReadonlySet<THREE.Object3D> {
        return this.byKind.get(kind) || new Set();
    }
}
