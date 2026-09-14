import { readFileSync, writeFileSync } from 'fs';

const srcFile = 'src/systems/music-reactivity.ts';
let content = readFileSync(srcFile, 'utf8');

const name = 'updateSkyWavePropagation';
let regex = new RegExp(`private\\s+${name}\\s*\\(`, 'm');
let match = content.match(regex);

if (match) {
    let startIndex = match.index;
    while (startIndex > 0 && content[startIndex-1] !== '\n' && content[startIndex-1] !== '\r') {
        startIndex--;
    }

    let braceCount = 0;
    let inString = false;
    let stringChar = '';
    let endIndex = startIndex;
    let started = false;

    for (let i = startIndex; i < content.length; i++) {
        const c = content[i];
        if (!inString) {
            if (c === "'" || c === '"' || c === '`') {
                inString = true;
                stringChar = c;
            } else if (c === '{') {
                braceCount++;
                started = true;
            } else if (c === '}') {
                braceCount--;
                if (started && braceCount === 0) {
                    endIndex = i + 1;
                    break;
                }
            }
        } else {
            if (c === '\\') i++;
            else if (c === stringChar) inString = false;
        }
    }

    let methodCode = content.substring(startIndex, endIndex);
    methodCode = methodCode.replace(new RegExp(`private\\s+${name}\\s*\\(`), `export function ${name}(`);
    methodCode = methodCode.replace(/this\._lastCameraPos/g, '_lastCameraPos');
    methodCode = methodCode.replace(/this\.registeredObjects/g, 'musicReactivitySystem.registeredObjects');

    content = content.substring(0, startIndex) + content.substring(endIndex);

    const imports = `import * as THREE from 'three';
import { MRState, _whiteColor, getActiveWave, setActiveWave } from './music-reactivity-core.ts';
import { skyWaveUniformMap } from './music-reactivity-defaults.ts';
import { computeWaveDistSq } from './music-wave.ts';
import type { AudioData } from '../foliage/types.ts';\n\n`;

    writeFileSync('src/systems/music-reactivity-sky-wave.ts', imports + methodCode);

    content = content.replace(/this\.updateSkyWavePropagation/g, 'updateSkyWavePropagation');
    const importsToAdd = `import { updateSkyWavePropagation } from './music-reactivity-sky-wave.ts';\n`;
    content = content.replace(/(import .* from .*;)/, `$1\n${importsToAdd}`);

    writeFileSync(srcFile, content);
    console.log("Sky Wave extracted");
}
