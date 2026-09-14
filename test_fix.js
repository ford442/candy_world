import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/systems/music-reactivity.ts', 'utf8');

// Replace this._lastCameraPos with camera.position
content = content.replace(/this\._lastCameraPos\.copy\(camera\.position\);\n\n        updateBiomeChannelBindings\(audioState, getDayNightBias\(time % CYCLE_DURATION\), this\._lastCameraPos\);/g, 'updateBiomeChannelBindings(audioState, getDayNightBias(time % CYCLE_DURATION), camera.position);');
content = content.replace(/updateLuminousPlants\(audioState, !isDay, this\._lastCameraPos\);/g, 'updateLuminousPlants(audioState, !isDay, camera.position);');
content = content.replace(/    private _lastCameraPos = new THREE\.Vector3\(\);\n/g, '');

writeFileSync('src/systems/music-reactivity.ts', content);
