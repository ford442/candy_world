export { FaunaSystem, initFaunaSystem, updateFaunaSystem } from './fauna-system.ts';
export { FaunaSpecies, FaunaState, FAUNA_BOID_STRIDE } from './types.ts';
export {
    FaunaBehaviorRunner,
    registerFaunaSpecies,
    getFaunaSpeciesProfile,
    listFaunaSpeciesProfiles,
    setFaunaScatterSink,
} from './behavior.ts';
export type { FaunaSpeciesProfile, FaunaBehaviorStats, FaunaScatterSink } from './behavior.ts';
export type { FaunaComponent, FaunaBiomeDensity } from './types.ts';
export { planRoostAnchors, getSkyIslandRoostAnchors, DEFAULT_ROOST_PLAN } from './roosts.ts';
export type { RoostAnchor, RoostPlanOptions, SkyIslandRoostSource } from './roosts.ts';
