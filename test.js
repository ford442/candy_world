import { readFileSync, writeFileSync } from 'fs';
let content = readFileSync('src/systems/music-reactivity.ts', 'utf8');

content = content.replace(/this\.updateFoliageAnimationLoop\(/g, 'updateFoliageAnimationLoop(');
content = content.replace(/this\.updateBiomeChannelBindings\(audioState, getDayNightBias\(time % CYCLE_DURATION\)\);/g, 'updateBiomeChannelBindings(audioState, getDayNightBias(time % CYCLE_DURATION), this._lastCameraPos);');

const importsToAdd = `import { updateFoliageAnimationLoop } from './music-reactivity-foliage.ts';\nimport { updateBiomeChannelBindings } from './music-reactivity-bindings.ts';\n`;
content = content.replace(/(import .* from .*;)/, `$1\n${importsToAdd}`);

writeFileSync('src/systems/music-reactivity.ts', content);
