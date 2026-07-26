const fs = require('fs');
const path = 'src/foliage/tree-batcher.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
    'deformationNode: applyPlayerInteraction(trunkDeform), // 🎨 PALETTE: Add player interaction',
    'deformationNode: trunkDeform, // 🏗️ ARCHITECT: Removed double-application of player interaction'
);

code = code.replace(
    'deformationNode: applyPlayerInteraction(sphereFinalDeform), // 🎨 PALETTE: Add player interaction',
    'deformationNode: sphereFinalDeform, // 🏗️ ARCHITECT: Removed double-application of player interaction'
);

code = code.replace(
    'deformationNode: applyPlayerInteraction(capsuleDeform), // 🎨 PALETTE: Add player interaction',
    'deformationNode: capsuleDeform, // 🏗️ ARCHITECT: Removed double-application of player interaction'
);

code = code.replace(
    'deformationNode: applyPlayerInteraction(helixDeform), // 🎨 PALETTE: Add player interaction',
    'deformationNode: helixDeform, // 🏗️ ARCHITECT: Removed double-application of player interaction'
);

code = code.replace(
    'deformationNode: applyPlayerInteraction(roseDeform), // 🎨 PALETTE: Add player interaction',
    'deformationNode: roseDeform, // 🏗️ ARCHITECT: Removed double-application of player interaction'
);

fs.writeFileSync(path, code);
