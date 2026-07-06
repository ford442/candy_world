const fs = require('fs');
let code = fs.readFileSync('src/systems/physics.core.ts', 'utf8');

code = code.replace(
    /\/\*\*\n \* Get unified ground height with lake carving and island applied\.\n \*\n \* Kept for backward compatibility with existing call sites\. New code should\n \* import \{@link getGroundHeight\} from `\.\/ground-system\.ts` directly\.\n \*\/\nexport function getUnifiedGroundHeightTyped\(\n    x: number,\n    z: number,\n    _getGroundHeight\?: \(x: number, z: number\) => number\n\): number {\n    return getAuthoritativeGroundHeight\(x, z\);\n}\n/g,
    ''
);

fs.writeFileSync('src/systems/physics.core.ts', code);
