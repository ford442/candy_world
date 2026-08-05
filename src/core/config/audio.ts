import type { ConfigType } from './types.ts';

/** Audio processing and music source defaults. */
export const AUDIO_DEFAULTS: ConfigType['audio'] = {
    useScriptProcessorNode: false,
    musicMode: 'auto' as 'tracker' | 'generative' | 'auto',
    generativeSeed: 0,
};
