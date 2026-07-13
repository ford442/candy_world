const fs = require('fs');

const path = 'src/foliage/lod-nodes.ts';
let code = fs.readFileSync(path, 'utf8');

// Replace JSDoc
code = code.replace(
    '/**\n * Full foliage motion offset (deformationNode semantics: displaced position minus positionLocal).\n */',
    `/**\n * Full foliage motion offset for LOD-enabled objects.\n * (deformationNode semantics: displaced position minus positionLocal).\n * 🏗️ ARCHITECT: Single source of truth for LOD deformation.\n * Internally composes wind sway and player push. DO NOT wrap with applyPlayerInteraction.\n */`
);

// Append function
code += `\n/**\n * 🏗️ ARCHITECT: Standardized TSL deformation chain for LOD-enabled objects\n * that manually compose their offsets instead of using foliageDeformationOffset.\n */\nexport const applyStandardDeformationWithLod = (basePosNode: any) => {\n    return applyPlayerInteractionWithLod(basePosNode.add(calculateWindSwayWithLod(basePosNode)));\n};\n`;

fs.writeFileSync(path, code);
