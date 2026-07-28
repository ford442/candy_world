/**
 * Biome tag at world XZ — uses map regions when loaded, else 'global'.
 */

import type { MapRegion } from '../../world/map-loader.ts';

let _regions: MapRegion[] | undefined;

export function setBiomeRegions(regions: MapRegion[] | undefined): void {
    _regions = regions;
}

export function getBiomeAtPosition(x: number, z: number): string {
    if (!_regions || _regions.length === 0) return 'global';
    for (let i = 0; i < _regions.length; i++) {
        const region = _regions[i];
        const minX = region.bounds.min[0];
        const minZ = region.bounds.min[1];
        const maxX = region.bounds.max[0];
        const maxZ = region.bounds.max[1];
        if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
            return region.biome ?? region.id ?? 'global';
        }
    }
    return 'global';
}
