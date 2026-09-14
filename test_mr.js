import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/systems/music-reactivity.ts', 'utf8');

if (content.includes('import { updateSkyWavePropagation }')) {
    console.log("Imports exist.");
} else {
    console.log("No imports.");
}

// Let's check update() method to make sure we're passing `camera.position` properly everywhere

console.log(content.match(/updateBiomeChannelBindings\(audioState, getDayNightBias\(time % CYCLE_DURATION\)[^\)]*\)/));
console.log(content.match(/updateLuminousPlants\(audioState, !isDay[^\)]*\)/));
console.log(content.match(/updateSkyWavePropagation\(audioState, isDay, camera.position, deltaTime\)/));
