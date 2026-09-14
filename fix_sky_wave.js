import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/systems/music-reactivity-sky-wave.ts', 'utf8');

const imports = `import { uTwilight } from '../foliage/sky.ts';
import { CONFIG } from '../core/config.ts';
import { WeatherMusicTargets } from './music-reactivity-core.ts';\n`;

content = content.replace(/(import .* from .*;)/, `$1\n${imports}`);

// WeatherTarget decay rate was in music-reactivity.ts ? Yes. Let's export it from there.
content = content.replace(/(import .* from .*;)/, `$1\nimport { WEATHER_TARGET_DECAY_RATE } from './music-reactivity.ts';\n`);

writeFileSync('src/systems/music-reactivity-sky-wave.ts', content);

let mrContent = readFileSync('src/systems/music-reactivity.ts', 'utf8');
mrContent = mrContent.replace(/const WEATHER_TARGET_DECAY_RATE/g, 'export const WEATHER_TARGET_DECAY_RATE');
writeFileSync('src/systems/music-reactivity.ts', mrContent);
