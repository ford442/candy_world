/**
 * Hooks through which world, systems and foliage code reports to the debug
 * tools without importing `src/debug/` (#1827 Part C.4).
 *
 * `placement-utils.ts` importing `debug/tools-stub.ts` put the whole world
 * generation graph in one import cycle with the debug editor. The dependency
 * now points the other way: `debug/tools-stub.ts` calls `installDebugHooks()`
 * when it is evaluated. `src/main.ts` reaches it statically through
 * `core/game-loop.ts`, so that happens before any boot code runs. Until then,
 * and in Node tests that never load it, every hook is a no-op.
 *
 * Keep this module a leaf: type-only imports.
 */
import type * as THREE from 'three';
import type { FaunaSpawnEntry } from '../systems/fauna/types.ts';

export interface DebugHooks {
    registerPlantedInstance(
        x: number,
        y: number,
        z: number,
        type?: string,
        footprintRadius?: number,
        normal?: THREE.Vector3
    ): void;
    registerCloudPlatform(cloud: THREE.Object3D): void;
    unregisterCloudPlatform(cloud: THREE.Object3D): void;
    isFaunaDebugEnabled(): boolean;
    updateFaunaDebug(
        heap: Float32Array,
        byteOffset: number,
        count: number,
        entries: readonly FaunaSpawnEntry[]
    ): void;
}

const noop = (): void => {};

export const debugHooks: DebugHooks = {
    registerPlantedInstance: noop,
    registerCloudPlatform: noop,
    unregisterCloudPlatform: noop,
    isFaunaDebugEnabled: () => false,
    updateFaunaDebug: noop,
};

export function installDebugHooks(hooks: DebugHooks): void {
    Object.assign(debugHooks, hooks);
}
