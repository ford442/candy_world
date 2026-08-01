import fs from 'fs';

let code = fs.readFileSync('src/core/main.ts', 'utf8');

// replace weather setup in StageLoader
code = code.replace(/await StageLoader\.loadStage\('weather', \(\) => \{\n\s*loadingScreen\.updateProgress\(70, 'Initializing weather system\.\.\.'\);\n\s*weatherSystem = new WeatherSystem\(scene\);\n\s*weatherSystem\.setRenderer\(renderer\);\n\s*\}\);/g, `await StageLoader.loadStage('weather', async () => {
    loadingScreen.updateProgress(70, 'Initializing weather system...');
    const { loadWeatherSystem } = await import('../systems/weather/lazy.ts');
    weatherSystem = await loadWeatherSystem(scene, renderer);
});`);
code = code.replace(/import { WeatherSystem } from '\.\.\/systems\/weather\.ts';/g, "import type { WeatherSystem } from '../systems/weather.ts';");


// add particles preload in deferred init
code = code.replace(/await initDeferredWorldContent\(scene, weatherSystem!, \(pct, label\) => \{/g, `const { loadParticles } = await import('../particles/lazy.ts');
        await loadParticles();
        await initDeferredWorldContent(scene, weatherSystem!, (pct, label) => {`);

fs.writeFileSync('src/core/main.ts', code);

code = fs.readFileSync('src/world/generation-decorators.ts', 'utf8');
code = code.replace(/import { createIntegratedSpores, createIntegratedGemSparks, registerIntegratedSystem } from '\.\.\/particles\/index\.ts';/g, "import { getParticles } from '../particles/lazy.ts';");
code = code.replace(/const spores = createIntegratedSpores\(group, 250\);\n\s*registerIntegratedSystem\('spores_mycelium', spores\);/g, "const { createIntegratedSpores, registerIntegratedSystem } = getParticles()!;\n    const spores = createIntegratedSpores(group, 250);\n    registerIntegratedSystem('spores_mycelium', spores);");
code = code.replace(/const sparks = createIntegratedGemSparks\(group, gemType === 'ruby' \? 0 \: gemType === 'sapphire' \? 1 \: 2\);\n\s*registerIntegratedSystem\(`gem_sparks_\$\{i\}_$\{gemType\}`, sparks\);/g, "const { createIntegratedGemSparks, registerIntegratedSystem } = getParticles()!;\n            const sparks = createIntegratedGemSparks(group, gemType === 'ruby' ? 0 : gemType === 'sapphire' ? 1 : 2);\n            registerIntegratedSystem(`gem_sparks_${i}_${gemType}`, sparks);");
fs.writeFileSync('src/world/generation-decorators.ts', code);

code = fs.readFileSync('src/world/generation-core.ts', 'utf8');
code = code.replace(/import { createIntegratedFireflies } from '\.\.\/particles\/index\.ts';/g, "import { getParticles } from '../particles/lazy.ts';");
code = code.replace(/const fireflies = createIntegratedFireflies\(\);/g, "const { createIntegratedFireflies } = getParticles()!;\n    const fireflies = createIntegratedFireflies();");
fs.writeFileSync('src/world/generation-core.ts', code);

code = fs.readFileSync('src/world/generation-setpieces.ts', 'utf8');
code = code.replace(/import { createIntegratedPollen, createIntegratedSparks, registerIntegratedSystem } from '\.\.\/particles\/index\.ts';/g, "import { getParticles } from '../particles/lazy.ts';");
code = code.replace(/const pollen = createIntegratedPollen\(group, 400\);\n\s*registerIntegratedSystem\('arpeggio_pollen', pollen\);/g, "const { createIntegratedPollen, registerIntegratedSystem } = getParticles()!;\n    const pollen = createIntegratedPollen(group, 400);\n    registerIntegratedSystem('arpeggio_pollen', pollen);");
code = code.replace(/const sparks = createIntegratedSparks\(group, 100\);\n\s*registerIntegratedSystem\('cave_sparks', sparks\);/g, "const { createIntegratedSparks, registerIntegratedSystem } = getParticles()!;\n    const sparks = createIntegratedSparks(group, 100);\n    registerIntegratedSystem('cave_sparks', sparks);");
fs.writeFileSync('src/world/generation-setpieces.ts', code);

code = fs.readFileSync('src/systems/weather/weather-effects.ts', 'utf8');
code = code.replace(/import { createIntegratedRain } from '\.\.\/\.\.\/particles\/index\.ts';\nimport { ComputeParticleSystem as Phase4ComputeSystem } from '\.\.\/\.\.\/particles\/compute-particles\.ts';/g, "import { getParticles } from '../../particles/lazy.ts';\nimport type { ComputeParticleSystem as Phase4ComputeSystem } from '../../particles/compute-particles-types.ts';");
code = code.replace(/this\.rainSystem = createIntegratedRain\(\);/g, "const { createIntegratedRain } = getParticles()!;\n        this.rainSystem = createIntegratedRain();");
fs.writeFileSync('src/systems/weather/weather-effects.ts', code);

code = fs.readFileSync('src/core/game-loop-particles.ts', 'utf8');
code = code.replace(/import { updateAllIntegratedSystems } from '\.\.\/particles\/index\.ts';/g, "import { getParticles } from '../particles/lazy.ts';");
code = code.replace(/updateAllIntegratedSystems\(delta, t, audioState, \_scratchParticleAudioData\);/g, "const particles = getParticles();\n        if (particles) particles.updateAllIntegratedSystems(delta, t, audioState, _scratchParticleAudioData);");
fs.writeFileSync('src/core/game-loop-particles.ts', code);

code = fs.readFileSync('src/foliage/berries.ts', 'utf8');
code = code.replace(/import \{ createComputeBerries, ComputeParticleSystem \} from '\.\.\/particles\/compute-particles\.ts';/g, "import { getParticles } from '../particles/lazy.ts';\nimport type { ComputeParticleSystem } from '../particles/compute-particles-types.ts';");
code = code.replace(/import \{ addComputeSystem \} from '\.\.\/particles\/compute-particles\.ts';/g, "");
code = code.replace(/this\.particleSystem = createComputeBerries\(/g, "const { createComputeBerries, addComputeSystem } = getParticles()!;\n            this.particleSystem = createComputeBerries(");
fs.writeFileSync('src/foliage/berries.ts', code);

code = fs.readFileSync('src/particles/compute-particles-types.ts', 'utf8');
code = code + `
export interface ComputeParticleSystem {
    particlesMesh: any;
    computeNode: any;
    update(delta: number, time: number, audioData: any): void;
    dispose(): void;
    updateInstances(count: number): void;
}
`;
fs.writeFileSync('src/particles/compute-particles-types.ts', code);

code = fs.readFileSync('src/compute/particle_compute.ts', 'utf8');
code = code.replace(/import type \{ ComputeParticleConfig, ParticleAudioState \} from '\.\.\/particles\/particle_config\.ts';/g, "import type { ComputeParticleConfig, ParticleAudioData } from '../particles/compute-particles-types.ts';");
fs.writeFileSync('src/compute/particle_compute.ts', code);


code = fs.readFileSync('vite.config.js', 'utf8');

const regex = /if \(\s*id\.includes\('\/src\/systems\/physics\/'\).*\s*return 'app';\s*\}/s;
const replaceWith = `
          if (id.includes('/src/systems/physics/')) {
            return 'physics';
          }
          if (id.includes('/src/systems/weather/') && !id.endsWith('/weather/lazy.ts')) {
             return 'weather';
          }
          if (id.includes('/src/systems/')) {
             return 'systems';
          }
          if (id.includes('/src/particles/') && !id.endsWith('/particles/lazy.ts') && !id.includes('compute-particles-types.ts')) {
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
            id.includes('/src/audio/') ||
            id.includes('/src/particles/compute-particles-types.ts')
          ) {
            return 'app';
          }
`;

code = code.replace(regex, replaceWith);

fs.writeFileSync('vite.config.js', code);
