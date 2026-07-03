const fs = require('fs');
let code = fs.readFileSync('src/world/generation-decorators.ts', 'utf8');

// Replace all occurrences of getUnifiedGroundHeight with sampleGroundY
code = code.replace(/getUnifiedGroundHeight/g, 'sampleGroundY');

fs.writeFileSync('src/world/generation-decorators.ts', code);
