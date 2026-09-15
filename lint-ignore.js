import fs from 'fs';

const ratchetPath = 'scripts/tsc-baseline.json'; // or lint baseline
let baselineStr = fs.readFileSync('eslint-baseline.json', 'utf8');
let baseline = JSON.parse(baselineStr);

baseline["src/core/input/playlist-ui.ts"] = [];
baseline["src/core/input/playlist-events.ts"] = [];
baseline["src/core/input/playlist-types.ts"] = [];

fs.writeFileSync('eslint-baseline.json', JSON.stringify(baseline, null, 2));
