import { Entity, Component, System, NativeComponentCodec, NativeQueryTable } from './types.ts';
import { isEmscriptenReady, getNativeFunc, getEmscriptenInstance } from '../../utils/wasm-loader-core.ts';

// =============================================================================
// C++ ECS BRIDGE
// =============================================================================

const CPP_QUERY_BUF_SIZE = 4096; // max entities returned per query

interface CppEcsBindings {
    createEntity: () => number;
    destroyEntity: (id: number) => void;
    isAlive: (id: number) => number;
    registerComponent: (stride: number, max: number) => number;
    getComponent: (entityId: number, type: number) => number;
    setComponent: (entityId: number, type: number, dataPtr: number) => void;
    addComponent: (entityId: number, type: number) => void;
    removeComponent: (entityId: number, type: number) => void;
    hasComponent: (entityId: number, type: number) => number;
    queryComponents: (mask: number, outPtr: number, max: number) => number;
    queryComponentPointers: (mask: number, type: number, outPtr: number, max: number) => number;
    getComponentStride: (type: number) => number;
    malloc: (size: number) => number;
    free: (ptr: number) => void;
    heapU8: Uint8Array;
    heap32: Int32Array;
    /** output buffer ptr pre-allocated in Emscripten heap */
    queryBufPtr: number;
    /** output pointer buffer ptr pre-allocated in Emscripten heap */
    queryPtrBufPtr: number;
}

function bindCppEcs(): CppEcsBindings | null {
    if (!isEmscriptenReady()) return null;
    try {
        const emInst = getEmscriptenInstance() as any;
        const createEntity     = getNativeFunc('ecsCreateEntity');
        const destroyEntity    = getNativeFunc('ecsDestroyEntity');
        const isAlive          = getNativeFunc('ecsIsAlive');
        const registerComponent= getNativeFunc('ecsRegisterComponent');
        const getComponent     = getNativeFunc('ecsGetComponent');
        const setComponent     = getNativeFunc('ecsSetComponent');
        const addComponent     = getNativeFunc('ecsAddComponent');
        const removeComponent  = getNativeFunc('ecsRemoveComponent');
        const hasComponent     = getNativeFunc('ecsHasComponent');
        const queryComponents  = getNativeFunc('ecsQueryComponents');
        const queryComponentPointers = getNativeFunc('ecsQueryComponentPointers');
        const getComponentStride = getNativeFunc('ecsGetComponentStride');
        const malloc           = emInst?._malloc as ((n: number) => number) | undefined;
        const free             = emInst?._free  as ((p: number) => void) | undefined;
        const heapU8           = emInst?.HEAPU8 as Uint8Array | undefined;
        const heap32           = emInst?.HEAP32 as Int32Array | undefined;
        const initEcs          = getNativeFunc('ecsInit');

        if (!createEntity || !destroyEntity || !isAlive || !registerComponent ||
            !getComponent || !setComponent || !addComponent || !removeComponent ||
            !hasComponent || !queryComponents || !queryComponentPointers || !getComponentStride ||
            !malloc || !heapU8 || !heap32) {
            return null;
        }

        const queryBufPtr = malloc(CPP_QUERY_BUF_SIZE * 4);
        const queryPtrBufPtr = malloc(CPP_QUERY_BUF_SIZE * 4);
        if (!queryBufPtr || !queryPtrBufPtr) {
            if (queryBufPtr) free?.(queryBufPtr);
            if (queryPtrBufPtr) free?.(queryPtrBufPtr);
            return null;
        }

        // Reset the C++ world (idempotent)
        initEcs?.();

        return {
            createEntity, destroyEntity, isAlive,
            registerComponent, getComponent, setComponent,
            addComponent, removeComponent, hasComponent,
            queryComponents, queryComponentPointers, getComponentStride,
            malloc, free: free ?? (() => {}),
            heapU8, heap32, queryBufPtr, queryPtrBufPtr,
        };
    } catch {
        return null;
    }
}

interface NativeComponentMeta<T extends Component = Component> {
    codec: NativeComponentCodec<T>;
    type: number;
    scratchPtr: number;
}

// =============================================================================
// WORLD
// =============================================================================

/**
 * Entity-Component World.
 * Routes entity lifecycle and batch queries to C++/Emscripten when available;
 * component data always lives in JavaScript (arbitrary JS object shapes cannot
 * be cheaply serialised to fixed-stride C++ slabs).
 *
 * Hot-path optimisation: `getEntitiesWithComponents` uses the C++ bitmask query
 * when the Emscripten module is loaded, avoiding the O(entities × components)
 * JS loop.
 */
export class World {
    // JS-side entity tracking (kept in sync with C++ for API compatibility)
    private nextEntityId: Entity = 1;
    private entities: Set<Entity> = new Set();

    // Dense arrays for high-performance JS-side iteration
    private components: Map<string, any[]> = new Map();
    private entityToIndex: Map<string, Map<Entity, number>> = new Map();
    private indexToEntity: Map<string, Map<number, Entity>> = new Map();

    private systems: System[] = [];

    // C++ binding (null when Emscripten is not available)
    private cpp: CppEcsBindings | null = null;
    // Maps component name → C++ type index (for bitmask queries)
    private cppTypeMap: Map<string, number> = new Map();
    private nativeComponents: Map<string, NativeComponentMeta> = new Map();
    // Track which C++ entities correspond to JS entities (1:1 if C++ is active)
    private jsToCpp: Map<Entity, number> = new Map();

    constructor() {
        this.cpp = bindCppEcs();
        if (this.cpp) {
            console.log('[ECS] C++ backend active — entity queries will use WASM bitmask path');
        }
    }

    // =========================================================================
    // Entity lifecycle
    // =========================================================================

    createEntity(): Entity {
        let id: Entity;
        if (this.cpp) {
            const cppId = this.cpp.createEntity();
            // Use the C++ generational ID directly as the JS entity ID so they stay in sync
            id = cppId;
            this.jsToCpp.set(id, cppId);
        } else {
            id = this.nextEntityId++;
        }
        this.entities.add(id);
        return id;
    }

    destroyEntity(entity: Entity) {
        this.entities.delete(entity);
        const componentNames = Array.from(this.entityToIndex.keys());
        for (const name of componentNames) {
            if (this.entityToIndex.get(name)?.has(entity)) {
                this.removeComponent(entity, name);
            }
        }
        if (this.cpp) {
            const cppId = this.jsToCpp.get(entity) ?? entity;
            this.cpp.destroyEntity(cppId);
            this.jsToCpp.delete(entity);
        }
    }

    // =========================================================================
    // Component management
    // =========================================================================

    addComponent<T extends Component>(entity: Entity, componentName: string, component: T) {
        const existing = this.entityToIndex.get(componentName);
        if (existing?.has(entity)) {
            this.setComponent(entity, componentName, component);
            return;
        }

        if (!this.components.has(componentName)) {
            this.components.set(componentName, []);
            this.entityToIndex.set(componentName, new Map());
            this.indexToEntity.set(componentName, new Map());
        }

        const componentArray   = this.components.get(componentName)!;
        const indexMap         = this.entityToIndex.get(componentName)!;
        const reverseIndexMap  = this.indexToEntity.get(componentName)!;

        const index = componentArray.length;
        componentArray.push(component);
        indexMap.set(entity, index);
        reverseIndexMap.set(index, entity);

        this.writeNativeComponent(entity, componentName, component);
    }

    removeComponent(entity: Entity, componentName: string) {
        const indexMap        = this.entityToIndex.get(componentName);
        const reverseIndexMap = this.indexToEntity.get(componentName);

        if (!indexMap || !reverseIndexMap || !indexMap.has(entity)) return;

        const indexToRemove = indexMap.get(entity)!;
        const componentArray = this.components.get(componentName)!;
        const lastIndex = componentArray.length - 1;

        if (indexToRemove !== lastIndex) {
            const lastElement = componentArray[lastIndex];
            const lastEntity  = reverseIndexMap.get(lastIndex)!;
            componentArray[indexToRemove] = lastElement;
            indexMap.set(lastEntity, indexToRemove);
            reverseIndexMap.set(indexToRemove, lastEntity);
        }

        componentArray.pop();
        indexMap.delete(entity);
        reverseIndexMap.delete(lastIndex);

        // Clear C++ bit
        if (this.cpp) {
            const type = this.cppTypeMap.get(componentName);
            if (type !== undefined) {
                const cppId = this.jsToCpp.get(entity) ?? entity;
                this.cpp.removeComponent(cppId, type);
            }
        }
    }

    getComponent<T extends Component>(entity: Entity, componentName: string): T | undefined {
        const indexMap = this.entityToIndex.get(componentName);
        if (!indexMap || !indexMap.has(entity)) return undefined;
        const index = indexMap.get(entity)!;
        const nativeMeta = this.nativeComponents.get(componentName);
        if (nativeMeta && this.cpp) {
            const cppId = this.jsToCpp.get(entity) ?? entity;
            const ptr = this.cpp.getComponent(cppId, nativeMeta.type);
            if (ptr) {
                const component = nativeMeta.codec.read(
                    new DataView(this.cpp.heapU8.buffer, ptr, nativeMeta.codec.strideBytes)
                ) as T;
                this.components.get(componentName)![index] = component;
                return component;
            }
        }
        return this.components.get(componentName)![index] as T;
    }

    setComponent<T extends Component>(entity: Entity, componentName: string, component: T) {
        const indexMap = this.entityToIndex.get(componentName);
        if (!indexMap || !indexMap.has(entity)) {
            this.addComponent(entity, componentName, component);
            return;
        }
        this.components.get(componentName)![indexMap.get(entity)!] = component;
        this.writeNativeComponent(entity, componentName, component);
    }

    hasComponent(entity: Entity, componentName: string): boolean {
        const indexMap = this.entityToIndex.get(componentName);
        return indexMap ? indexMap.has(entity) : false;
    }

    // =========================================================================
    // Systems
    // =========================================================================

    addSystem(system: System) {
        this.systems.push(system);
    }

    update(dt: number) {
        for (const system of this.systems) {
            system.update(dt);
        }
    }

    // =========================================================================
    // Batch query — uses C++ bitmask when Emscripten is available
    // =========================================================================

    /**
     * Return entities that have ALL of the named components.
     * Routes to C++ WASM bitmask query when available (avoids O(N×M) JS loop).
     */
    getEntitiesWithComponents(components: string[]): Entity[] {
        if (this.cpp && components.length > 0) {
            return this.getEntitiesWithComponentsCpp(components);
        }
        return this.getEntitiesWithComponentsJS(components);
    }

    /** True when the C++/Emscripten backend is handling entity operations */
    isUsingCpp(): boolean {
        return this.cpp !== null;
    }

    registerNativeComponent<T extends Component>(componentName: string, codec: NativeComponentCodec<T>): boolean {
        if (!this.cpp) return false;
        if (this.nativeComponents.has(componentName)) return true;

        const maxEntities = codec.maxEntities ?? 65536;
        const type = this.cpp.registerComponent(codec.strideBytes, maxEntities);
        if (type < 0) return false;

        const scratchPtr = this.cpp.malloc(codec.strideBytes);
        if (!scratchPtr) return false;

        this.cppTypeMap.set(componentName, type);
        this.nativeComponents.set(componentName, {
            codec: codec as NativeComponentCodec<Component>,
            type,
            scratchPtr
        });
        return true;
    }

    queryNativeTable(componentNames: string[]): NativeQueryTable | null {
        if (!this.cpp || componentNames.length === 0) return null;

        let mask = 0;
        for (const name of componentNames) {
            const meta = this.nativeComponents.get(name);
            if (!meta) return null;
            mask |= (1 << meta.type);
        }

        const count = this.cpp.queryComponents(mask, this.cpp.queryBufPtr, CPP_QUERY_BUF_SIZE);
        if (count <= 0) {
            return { ids: new Uint32Array(0), pointers: {}, count: 0 };
        }

        const ids = new Uint32Array(count);
        ids.set(new Uint32Array(this.cpp.heap32.buffer, this.cpp.queryBufPtr, count));

        const pointers: Record<string, Uint32Array> = {};
        for (const name of componentNames) {
            const meta = this.nativeComponents.get(name)!;
            const written = this.cpp.queryComponentPointers(mask, meta.type, this.cpp.queryPtrBufPtr, CPP_QUERY_BUF_SIZE);
            if (written !== count) return null;
            pointers[name] = new Uint32Array(count);
            pointers[name].set(new Uint32Array(this.cpp.heap32.buffer, this.cpp.queryPtrBufPtr, count));
        }

        return { ids, pointers, count };
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    private getEntitiesWithComponentsCpp(components: string[]): Entity[] {
        const cpp = this.cpp!;

        // Build bitmask from registered types (register on first use)
        let mask = 0;
        for (const name of components) {
            const type = this.ensureCppType(name);
            mask |= (1 << type);
        }

        const count = cpp.queryComponents(mask, cpp.queryBufPtr, CPP_QUERY_BUF_SIZE);
        if (count <= 0) return [];

        const base = cpp.queryBufPtr >> 2; // byte → Int32Array index
        const result: Entity[] = new Array(count);
        for (let i = 0; i < count; i++) {
            result[i] = cpp.heap32[base + i] as Entity;
        }
        return result;
    }

    private getEntitiesWithComponentsJS(components: string[]): Entity[] {
        const result: Entity[] = [];
        for (const entity of this.entities) {
            let hasAll = true;
            for (const c of components) {
                if (!this.hasComponent(entity, c)) { hasAll = false; break; }
            }
            if (hasAll) result.push(entity);
        }
        return result;
    }

    /**
     * Get the C++ type index for a component name, registering it if needed.
     * Uses a stride of 0 (marker-only) for unknown/JS-only components.
     */
    private ensureCppType(componentName: string): number {
        const nativeMeta = this.nativeComponents.get(componentName);
        if (nativeMeta) {
            return nativeMeta.type;
        }
        if (this.cppTypeMap.has(componentName)) {
            return this.cppTypeMap.get(componentName)!;
        }
        // Register as a 1-byte marker slab (data lives in JS)
        const type = this.cpp!.registerComponent(1, 65536);
        if (type < 0) {
            // C++ out of slots; use a stable hash mod 32 as best-effort fallback
            const fallback = componentName.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0x7FFFFFFF, 0) % 32;
            this.cppTypeMap.set(componentName, fallback);
            return fallback;
        }
        this.cppTypeMap.set(componentName, type);
        return type;
    }

    private writeNativeComponent<T extends Component>(entity: Entity, componentName: string, component: T) {
        if (!this.cpp) return;
        const nativeMeta = this.nativeComponents.get(componentName);
        if (nativeMeta) {
            const view = new DataView(this.cpp.heapU8.buffer, nativeMeta.scratchPtr, nativeMeta.codec.strideBytes);
            nativeMeta.codec.write(view, component);
            const cppId = this.jsToCpp.get(entity) ?? entity;
            this.cpp.setComponent(cppId, nativeMeta.type, nativeMeta.scratchPtr);
            return;
        }

        const type = this.ensureCppType(componentName);
        const cppId = this.jsToCpp.get(entity) ?? entity;
        this.cpp.addComponent(cppId, type);
    }
}
