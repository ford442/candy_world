const fs = require('fs');
let file = fs.readFileSync('src/systems/music-reactivity.ts', 'utf8');

file = file.replace(
    "private updateSkyWavePropagation(audioState: AudioData | null, isDay: boolean, cameraPosition?: THREE.Vector3) {",
    "private updateSkyWavePropagation(audioState: AudioData | null, isDay: boolean, cameraPosition?: THREE.Vector3, deltaTime: number = 0.016) {"
);

file = file.replace(
    "this.updateSkyWavePropagation(audioState, !(!isDay), camera.position);",
    "this.updateSkyWavePropagation(audioState, isDay, camera.position, deltaTime);"
);

fs.writeFileSync('src/systems/music-reactivity.ts', file);
