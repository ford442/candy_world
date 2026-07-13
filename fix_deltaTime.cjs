const fs = require('fs');
let file = fs.readFileSync('src/systems/music-reactivity.ts', 'utf8');

file = file.replace(
    "MRState.smoothedSkyIntensity += (rawVolume - MRState.smoothedSkyIntensity) * (1.0 - Math.exp(-deltaTime * 12.0));",
    "MRState.smoothedSkyIntensity += (rawVolume - MRState.smoothedSkyIntensity) * (1.0 - Math.exp(-1/60 * 12.0));"
);

// Wait, the error is inside `updateSkyWavePropagation`
// Let's check `updateSkyWavePropagation` for `deltaTime`.
console.log(file.includes('deltaTime'));
