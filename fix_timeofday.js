import { readFileSync, writeFileSync } from 'fs';
let content = readFileSync('src/systems/music-reactivity-luminous.ts', 'utf8');

// It's probably in `core/config.ts` or somewhere else, or we just remove it if unused.
// Let's check if getGlobalLightingConfig is even used in this file.
console.log(content.includes('getGlobalLightingConfig(') ? "Used" : "Not Used");

if (!content.includes('getGlobalLightingConfig(')) {
    content = content.replace(/import \{ getGlobalLightingConfig \} from '\.\.\/core\/time-of-day\.ts';\n/, '');
    writeFileSync('src/systems/music-reactivity-luminous.ts', content);
}
