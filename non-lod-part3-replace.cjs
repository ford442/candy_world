const fs = require('fs');

// 1. arpeggio-batcher.ts
let p1 = 'src/foliage/arpeggio-batcher.ts';
let c1 = fs.readFileSync(p1, 'utf8');
c1 = c1.replace(
    'applyPlayerInteraction,',
    'applyPlayerInteraction,\n    applyStandardDeformation,'
);
c1 = c1.replace(
    'const withInteraction = applyPlayerInteraction(pulsedPos);\n\n        // Wind Sway\n        const withWind = withInteraction.add(calculateWindSway(pulsedPos));',
    'const withWind = applyStandardDeformation(pulsedPos);'
);
fs.writeFileSync(p1, c1);

// 2. lantern-batcher.ts
let p2 = 'src/foliage/lantern-batcher.ts';
let c2 = fs.readFileSync(p2, 'utf8');
c2 = c2.replace(
    'applyPlayerInteraction,',
    'applyPlayerInteraction, applyStandardDeformation,'
);
c2 = c2.replace(
    'const sway = calculateWindSway(scaledPos);\n        const push = applyPlayerInteraction(scaledPos);\n\n        mat.positionNode = scaledPos.add(sway).add(push);',
    'mat.positionNode = applyStandardDeformation(scaledPos);'
);
c2 = c2.replace(
    'const tipSway = calculateWindSway(stemTipPos);\n        const tipPush = applyPlayerInteraction(stemTipPos);\n\n        const finalPos = offsetPos.add(tipSway).add(tipPush).add(swingOffset);',
    'const tipDeform = applyStandardDeformation(stemTipPos).sub(stemTipPos);\n        const finalPos = offsetPos.add(tipDeform).add(swingOffset);'
);
fs.writeFileSync(p2, c2);

// 3. glowing-flower-batcher.ts
let p3 = 'src/foliage/glowing-flower-batcher.ts';
let c3 = fs.readFileSync(p3, 'utf8');
c3 = c3.replace(
    'applyPlayerInteraction,',
    'applyPlayerInteraction, applyStandardDeformation,'
);
c3 = c3.replace(
    'const playerPush = applyPlayerInteraction(vec3(0, 1, 0)); // Push amount at top',
    'const playerPush = applyStandardDeformation(vec3(0, 1, 0)).sub(vec3(0, 1, 0)); // Push amount at top'
);
fs.writeFileSync(p3, c3);
