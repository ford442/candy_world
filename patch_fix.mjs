import fs from 'fs';

let wEffect = fs.readFileSync('src/systems/weather/weather-effects.ts', 'utf8');
wEffect = wEffect.replace(/import \{ createIntegratedRain \} from '\.\.\/\.\.\/particles\/compute-integration\.ts';\n/g, '');
wEffect = "import { createIntegratedRain } from '../../particles/compute-integration.ts';\n" + wEffect;
fs.writeFileSync('src/systems/weather/weather-effects.ts', wEffect);

let gCore = fs.readFileSync('src/world/generation-core.ts', 'utf8');
gCore = gCore.replace(/import \{ createIntegratedFireflies \} from '\.\.\/particles\/index\.ts';\n/g, '');
gCore = "import { createIntegratedFireflies } from '../particles/index.ts';\n" + gCore;
fs.writeFileSync('src/world/generation-core.ts', gCore);
