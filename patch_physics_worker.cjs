const fs = require('fs');
let code = fs.readFileSync('src/workers/physics-worker.ts', 'utf8');

code = code.replace(
    /function getUnifiedGroundHeight\(x: number, z: number\): number {\n\s*let height = exports.getGroundHeight\(x, z\);\n\s*return height;\n}\n/g,
    ''
);
code = code.replace(/getUnifiedGroundHeight/g, 'exports.getGroundHeight');

fs.writeFileSync('src/workers/physics-worker.ts', code);
