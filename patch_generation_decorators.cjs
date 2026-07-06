const fs = require('fs');
let code = fs.readFileSync('src/world/generation-decorators.ts', 'utf8');

// Add the import for sampleGroundY
code = code.replace(
    /import { plantOnSurface } from '\.\/placement-utils\.ts';/,
    "import { plantOnSurface, sampleGroundY } from './placement-utils.ts';"
);

fs.writeFileSync('src/world/generation-decorators.ts', code);
