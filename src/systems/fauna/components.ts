/**
 * Native ECS codec for fauna components (fixed stride for C++ ECS bitmask queries).
 */

import type { NativeComponentCodec } from '../ecs/types.ts';
import type { FaunaComponent } from './types.ts';
import { FaunaSpecies, FaunaState } from './types.ts';

/** 32 bytes: slot, species, state, biome hash, normal xyz, padding */
export const FAUNA_COMPONENT_STRIDE = 32;

export const faunaComponentCodec: NativeComponentCodec<FaunaComponent> = {
    strideBytes: FAUNA_COMPONENT_STRIDE,
    maxEntities: 256,
    write(view, c) {
        view.setUint32(0, c.slot, true);
        view.setUint32(4, c.species, true);
        view.setUint32(8, c.state, true);
        let biomeHash = 0;
        for (let i = 0; i < c.biome.length; i++) {
            biomeHash = (biomeHash * 31 + c.biome.charCodeAt(i)) | 0;
        }
        view.setInt32(12, biomeHash, true);
        view.setFloat32(16, c.normalX, true);
        view.setFloat32(20, c.normalY, true);
        view.setFloat32(24, c.normalZ, true);
    },
    read(view) {
        const biomeHash = view.getInt32(12, true);
        return {
            slot: view.getUint32(0, true),
            species: view.getUint32(4, true) as FaunaSpecies,
            state: view.getUint32(8, true) as FaunaState,
            biome: `biome_${biomeHash}`,
            normalX: view.getFloat32(16, true),
            normalY: view.getFloat32(20, true),
            normalZ: view.getFloat32(24, true),
        };
    },
};
