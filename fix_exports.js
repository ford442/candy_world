import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/systems/music-reactivity-bindings.ts', 'utf8');

// The helpers were extracted but not exported
content = content.replace(/const NOTE_AUDIBLE_THRESHOLD/g, 'export const NOTE_AUDIBLE_THRESHOLD');
content = content.replace(/const NOTE_COLOR_RELEASE_LERP/g, 'export const NOTE_COLOR_RELEASE_LERP');
content = content.replace(/const SILENT_DECAY = 0\.9;/g, 'export const SILENT_DECAY = 0.9;');
content = content.replace(/const SILENT_DECAY_UNIFORMS/g, 'export const SILENT_DECAY_UNIFORMS');
content = content.replace(/function accumChannelVolume/g, 'export function accumChannelVolume');
content = content.replace(/function firstAudibleNote/g, 'export function firstAudibleNote');
content = content.replace(/function normalizeAccum/g, 'export function normalizeAccum');
content = content.replace(/function releaseNoteColor/g, 'export function releaseNoteColor');

// Also color imports: `noteColorMap } from '../core/config/colors.ts'` needs to be `noteColorMap } from '../core/config.ts'`
// Actually config exports noteColorMap. Let's try `../core/config.ts`
content = content.replace(/from '\.\.\/core\/config\/colors\.ts'/g, "from '../core/config.ts'");

writeFileSync('src/systems/music-reactivity-bindings.ts', content);

// For foliage:
let fContent = readFileSync('src/systems/music-reactivity-foliage.ts', 'utf8');

fContent = `import { MRState, _scratchSphere } from './music-reactivity-core.ts';\nimport { _emptyAudioState } from './music-reactivity.ts';\nimport { CYCLE_DURATION } from '../core/config.ts';\nimport { getDayNightBias } from '../core/cycle.ts';\n` + fContent;

// Wait, `_emptyAudioState` is in `music-reactivity.ts`. Let's export it from there.
let mContent = readFileSync('src/systems/music-reactivity.ts', 'utf8');
mContent = mContent.replace(/const _emptyAudioState/g, 'export const _emptyAudioState');
writeFileSync('src/systems/music-reactivity.ts', mContent);

writeFileSync('src/systems/music-reactivity-foliage.ts', fContent);
