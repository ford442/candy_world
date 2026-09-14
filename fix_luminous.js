import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/systems/music-reactivity-luminous.ts', 'utf8');

// I might have extracted the wrong method or missed some imports.
// "CHROMATIC_SCALE" is in music-reactivity-defaults.ts
// "CONFIG" is in core/config.ts
// "SkyUniforms" is in biome-uniforms.ts

const extraImports = `import { CHROMATIC_SCALE } from './music-reactivity-defaults.ts';
import { CONFIG } from '../core/config.ts';
import { SkyUniforms } from './biome-uniforms.ts';\n`;

content = content.replace(/(import .*;\n\n)/, `$1${extraImports}`);

writeFileSync('src/systems/music-reactivity-luminous.ts', content);
