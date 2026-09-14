import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/systems/music-reactivity.ts', 'utf8');

const regex = /\n,\n    noteVal: number,[\s\S]*?return true;\n    }\n/m;
content = content.replace(regex, '');

content = content.replace(/import { updateFoliageAnimationLoop } from '\.\/music-reactivity-foliage\.ts';\nimport { updateBiomeChannelBindings } from '\.\/music-reactivity-bindings\.ts';\n/, "import { updateFoliageAnimationLoop } from './music-reactivity-foliage.ts';\nimport { updateBiomeChannelBindings } from './music-reactivity-bindings.ts';\nimport { NOTE_AUDIBLE_THRESHOLD, NOTE_COLOR_RELEASE_LERP, SILENT_DECAY, SILENT_DECAY_UNIFORMS, accumChannelVolume, firstAudibleNote, normalizeAccum, releaseNoteColor, applyNoteColor } from './music-reactivity-bindings.ts';\n");

// Also check the end of the file
console.log(content.substring(content.length - 200));
writeFileSync('src/systems/music-reactivity.ts', content);
