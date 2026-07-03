const fs = require('fs');
let code = fs.readFileSync('src/world/generation-utils.ts', 'utf8');

code = code.replace(
    /\/\/ Helper: Calculate Unified Ground Height \(WASM \+ Visual Lake Modifiers \+ Island\)\n\/\/ The authoritative logic now lives in GroundSystem; this wrapper preserves the\n\/\/ existing generation-utils API\.\nexport function getUnifiedGroundHeight\(x: number, z: number\): number {\n    return getAuthoritativeGroundHeight\(x, z\);\n}\n/g,
    ''
);
// Also remove it from exports at the bottom if it is there

fs.writeFileSync('src/world/generation-utils.ts', code);
