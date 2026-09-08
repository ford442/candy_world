import * as fs from 'fs';
const file = 'src/foliage/panning-pads.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
`    createUnifiedMaterial,
    CandyPresets,
    registerReactiveMaterial,
    attachReactivity,
    sharedGeometries,
    createStandardNodeMaterial,
    uPlayerPosition,
    uTime,
    applyStandardDeformation,
    createJuicyRimLight`,
`    createUnifiedMaterial,
    registerReactiveMaterial,
    attachReactivity,
    sharedGeometries,
    createStandardNodeMaterial,
    uPlayerPosition,
    applyStandardDeformation,
    createJuicyRimLight`
);

code = code.replace(/    color, float, mix, uv, distance, vec2, smoothstep, uniform,\n    positionLocal, positionWorld, vec3,\n    ShaderNodeObject, Node/, `    color, float, uv, distance, vec2, smoothstep, uniform,\n    positionLocal, positionWorld, vec3`);
code = code.replace(/import { MeshStandardNodeMaterial } from 'three\/webgpu';\n/, '');

code = code.replace(/    group.userData.onProximityEnter = \(distanceSq: number\) => {/, `    group.userData.onProximityEnter = (_distanceSq: number) => {`);

fs.writeFileSync(file, code);
