import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/systems/music-reactivity.ts', 'utf8');

content = content.replace(/ {4}releaseNoteColor\(uniform, target\);\n {4}return false;\n}\n\n/g, '');

writeFileSync('src/systems/music-reactivity.ts', content);

let bContent = readFileSync('src/systems/music-reactivity-bindings.ts', 'utf8');

// applyNoteColor was cut off! Let's just fix it completely.
const badApply = `function applyNoteColor(
    uniform: { value: THREE.Color }
    export function updateBiomeChannelBindings(audioState: AudioData | null, dayNightBias: number, _lastCameraPos: THREE.Vector3) {`;

const goodApply = `export function applyNoteColor(
    uniform: { value: THREE.Color },
    noteVal: number,
    target: THREE.Color,
    palette: string,
    lerpRate: number
): boolean {
    if (noteVal > 0) {
        mapNoteToColor(noteVal, target, palette);
        uniform.value.lerp(target, lerpRate);
        return true;
    }
    releaseNoteColor(uniform, target);
    return false;
}

export function updateBiomeChannelBindings(audioState: AudioData | null, dayNightBias: number, _lastCameraPos: THREE.Vector3) {`;

bContent = bContent.replace(badApply, goodApply);

writeFileSync('src/systems/music-reactivity-bindings.ts', bContent);
