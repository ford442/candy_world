const fs = require('fs');
const content = fs.readFileSync('src/particles/compute-integration.ts', 'utf8');
if (content.includes('export interface IntegratedSparksOptions')) {
  console.log('Sparks API is implemented in compute-integration.ts');
}
