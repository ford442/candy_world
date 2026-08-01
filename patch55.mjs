import fs from 'fs';
let code = fs.readFileSync('vite.config.js', 'utf8');

const regex = /if \(\s*id\.includes\('\/src\/systems\/physics\/'\).*\s*return 'app';\s*\}/s;
const replaceWith = `
          if (id.includes('/src/systems/physics/')) {
            return 'physics';
          }
          if (id.includes('/src/systems/weather/')) {
             return 'weather';
          }
          if (id.includes('/src/systems/')) {
             return 'systems';
          }
          if (id.includes('/src/particles/')) {
             return 'particles';
          }
          if (id.includes('/src/audio/') && !id.includes('audio-system-core.ts') && !id.includes('audio-system.ts') && !id.includes('beat-sync.ts') && !id.includes('audio-system-playback.ts') && !id.includes('music-mode.ts') && !id.includes('generative/')) {
             return 'audio';
          }
          if (
            id.includes('/src/core/') ||
            id.includes('/src/foliage/') ||
            id.includes('/src/rendering/') ||
            id.includes('/src/ui/') ||
            id.includes('/src/utils/') ||
            id.includes('/src/world/') ||
            id.includes('/src/debug/') ||
            id.includes('/src/compute/') ||
            id.includes('/src/audio/')
          ) {
            return 'app';
          }
`;

code = code.replace(regex, replaceWith);

fs.writeFileSync('vite.config.js', code);
