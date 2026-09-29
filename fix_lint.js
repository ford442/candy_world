const fs = require('fs');
const filepath = 'scripts/eslint-baseline.json';
let data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
data.maxProblems = 1888;
fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
console.log('Fixed lint baseline');
