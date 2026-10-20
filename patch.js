const fs = require('fs');
const file = 'src/foliage/kick-drum-geyser-batcher.ts';
let content = fs.readFileSync(file, 'utf8');

const search = `            // dirty check
            if (Math.abs(plumeArray[baseIndex + 5] - (baseArray[baseIndex + 5] * scaleY)) < 1e-6) continue;

            plumeDirty = true;

            plumeArray[baseIndex + 0] = baseArray[baseIndex + 0];
            plumeArray[baseIndex + 1] = baseArray[baseIndex + 1];
            plumeArray[baseIndex + 2] = baseArray[baseIndex + 2];
            plumeArray[baseIndex + 3] = baseArray[baseIndex + 3];

            // Scale Y-axis basis vector
            plumeArray[baseIndex + 4] = baseArray[baseIndex + 4] * scaleY;
            plumeArray[baseIndex + 5] = baseArray[baseIndex + 5] * scaleY;
            plumeArray[baseIndex + 6] = baseArray[baseIndex + 6] * scaleY;
            plumeArray[baseIndex + 7] = baseArray[baseIndex + 7] * scaleY;

            plumeArray[baseIndex + 8] = baseArray[baseIndex + 8];
            plumeArray[baseIndex + 9] = baseArray[baseIndex + 9];
            plumeArray[baseIndex + 10] = baseArray[baseIndex + 10];
            plumeArray[baseIndex + 11] = baseArray[baseIndex + 11];

            plumeArray[baseIndex + 12] = baseArray[baseIndex + 12];
            plumeArray[baseIndex + 13] = baseArray[baseIndex + 13];
            plumeArray[baseIndex + 14] = baseArray[baseIndex + 14];
            plumeArray[baseIndex + 15] = baseArray[baseIndex + 15];`;

const replace = `            let changed = false;

            // Target values
            const t0 = baseArray[baseIndex + 0];
            const t1 = baseArray[baseIndex + 1];
            const t2 = baseArray[baseIndex + 2];
            const t3 = baseArray[baseIndex + 3];

            const t4 = baseArray[baseIndex + 4] * scaleY;
            const t5 = baseArray[baseIndex + 5] * scaleY;
            const t6 = baseArray[baseIndex + 6] * scaleY;
            const t7 = baseArray[baseIndex + 7] * scaleY;

            const t8 = baseArray[baseIndex + 8];
            const t9 = baseArray[baseIndex + 9];
            const t10 = baseArray[baseIndex + 10];
            const t11 = baseArray[baseIndex + 11];

            const t12 = baseArray[baseIndex + 12];
            const t13 = baseArray[baseIndex + 13];
            const t14 = baseArray[baseIndex + 14];
            const t15 = baseArray[baseIndex + 15];

            // Check if any element changed
            if (
                Math.abs(plumeArray[baseIndex + 0] - t0) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 1] - t1) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 2] - t2) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 3] - t3) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 4] - t4) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 5] - t5) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 6] - t6) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 7] - t7) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 8] - t8) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 9] - t9) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 10] - t10) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 11] - t11) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 12] - t12) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 13] - t13) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 14] - t14) > 1e-6 ||
                Math.abs(plumeArray[baseIndex + 15] - t15) > 1e-6
            ) {
                changed = true;
                plumeDirty = true;
            }

            if (!changed) continue;

            plumeArray[baseIndex + 0] = t0;
            plumeArray[baseIndex + 1] = t1;
            plumeArray[baseIndex + 2] = t2;
            plumeArray[baseIndex + 3] = t3;

            plumeArray[baseIndex + 4] = t4;
            plumeArray[baseIndex + 5] = t5;
            plumeArray[baseIndex + 6] = t6;
            plumeArray[baseIndex + 7] = t7;

            plumeArray[baseIndex + 8] = t8;
            plumeArray[baseIndex + 9] = t9;
            plumeArray[baseIndex + 10] = t10;
            plumeArray[baseIndex + 11] = t11;

            plumeArray[baseIndex + 12] = t12;
            plumeArray[baseIndex + 13] = t13;
            plumeArray[baseIndex + 14] = t14;
            plumeArray[baseIndex + 15] = t15;`;

content = content.replace(search, replace);
fs.writeFileSync(file, content);
