const fs = require('fs');

const path = 'src/foliage/material-core.ts';
let code = fs.readFileSync(path, 'utf8');

const newFn = `
/**
 * 🏗️ ARCHITECT: Standardized TSL deformation chain for non-LOD objects.
 * Strictly composes wind sway followed by player interaction push.
 */
export const applyStandardDeformation = (basePosNode: any) => {
    return applyPlayerInteraction(basePosNode.add(calculateWindSway(basePosNode)));
};
`;

code += newFn;
fs.writeFileSync(path, code);

const indexPath = 'src/foliage/index.ts';
let indexCode = fs.readFileSync(indexPath, 'utf8');

indexCode = indexCode.replace(
    '    applyPlayerInteraction,\n',
    '    applyPlayerInteraction,\n    applyStandardDeformation,\n'
);
fs.writeFileSync(indexPath, indexCode);
