import { registerBuiltinWorldObjectTypes } from './foliage-registry.ts';

registerBuiltinWorldObjectTypes();

export { populateGemCanopyCorridor } from './generation-decorators-gem-canopy.ts';
export { populateMyceliumGrove } from './generation-decorators-mycelium.ts';
export { populateProceduralExtras } from './generation-decorators-procedural-extras.ts';
export { populateCloudArchipelago } from './generation-decorators-cloud-archipelago.ts';
export { populateSugarCaves, populateSkyIslands } from './generation-decorators-sky-islands.ts';
