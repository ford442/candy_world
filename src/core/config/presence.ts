import type { ConfigType } from './types.ts';

/** Real-time co-presence (Supabase Realtime) defaults. */
export const PRESENCE_DEFAULTS: ConfigType['presence'] = {
    enabled: true,
    maxPeers: 16,
    tickHz: 10,
    cullDistance: 120,
};
