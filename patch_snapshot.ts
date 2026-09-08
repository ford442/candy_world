import * as fs from 'fs';
const file = 'src/systems/entity-snapshot.ts';
let code = fs.readFileSync(file, 'utf8');

// The file has two parts. The wrapper is the first 16 lines:
const targetLines = code.split('\n').slice(0, 16);
fs.writeFileSync(file, targetLines.join('\n') + '\n}\n');
