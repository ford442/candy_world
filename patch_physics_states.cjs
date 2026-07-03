const fs = require('fs');
let code = fs.readFileSync('src/systems/physics/physics-states.ts', 'utf8');

code = code.replace(
    /function getUnifiedGroundHeight\(x: number, z: number\): number {\n\s*return getAuthoritativeGroundHeight\(x, z\);\n}\n/g,
    ''
);
code = code.replace(/getUnifiedGroundHeight/g, 'getAuthoritativeGroundHeight');

fs.writeFileSync('src/systems/physics/physics-states.ts', code);
