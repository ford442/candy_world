/**
 * @file region-manager.ts
 * @description Grid-based region management for asset streaming - Barrel export
 */

export * from './region-manager-core.ts';
export * from './region-manager-lod.ts';

import { RegionManager } from './region-manager-core.ts';
export default RegionManager;
