const fs = require('fs');

const path = 'src/systems/physics/physics-updates.ts';
let code = fs.readFileSync(path, 'utf-8');

const checkVineTarget = `
            const distHSq = dx*dx + dz*dz;
            const tipY = anchor.y - (typeof vineManager.length === 'number' ? vineManager.length : 0);
            if (distHSq < 4.0 && playerPos.y < anchor.y && playerPos.y > tipY) {
                 if (distHSq < 1.0) {
                     if (typeof vineManager.attach === 'function') {
                         vineManager.attach(player, player.velocity);
                         setActiveVineSwing(vineManager);
                         break;
                     }
                 }
            }
`;

const checkVineOptimized = `
            const distHSq = dx*dx + dz*dz;
            // ⚡ OPTIMIZATION: Quick horizontal distance check before more expensive math
            if (distHSq < 1.0) {
                const tipY = anchor.y - (typeof vineManager.length === 'number' ? vineManager.length : 0);
                if (playerPos.y < anchor.y && playerPos.y > tipY) {
                    if (typeof vineManager.attach === 'function') {
                        vineManager.attach(player, player.velocity);
                        setActiveVineSwing(vineManager);
                        break;
                    }
                }
            }
`;

code = code.replace(checkVineTarget, checkVineOptimized);

fs.writeFileSync(path, code, 'utf-8');
console.log('physics-updates.ts patched');
