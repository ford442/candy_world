const fs = require('fs');
let file = fs.readFileSync('src/systems/music-reactivity.ts', 'utf8');

file = file.replace(
    "this.updateLuminousPlants(audioState, isDay);",
    "this.updateLuminousPlants(audioState, !isDay);"
);

fs.writeFileSync('src/systems/music-reactivity.ts', file);
