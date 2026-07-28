export {
    presenceSystem,
    initPresenceFromOptIn,
    updatePresenceSystem,
    teardownPresence,
    isPresenceBackendConfigured,
    isPresenceOptedIn,
    setPresenceOptIn,
} from './presence.ts';
export { getBiomeAtPosition, setBiomeRegions } from './biome-at-position.ts';
export type { PresencePose, PresenceMeta, RemotePeer } from './presence-types.ts';
