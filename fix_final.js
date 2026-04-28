import fs from 'fs';

const blaster = fs.readFileSync("src/gameplay/rainbow-blaster.ts", "utf8");
let newBlaster = blaster.replace("const plasmaTime = uTime ? (uTime ? uTime.mul(float(3.0)) : float(0.0)) : float(0.0);", "const plasmaTime = uTime.mul(float(3.0));");
newBlaster = newBlaster.replace("const audioPulse = uAudioHigh ? (uAudioHigh ? uAudioHigh.mul(float(0.3)).add(float(1.0)) : float(1.0)) : float(1.0);", "const audioPulse = uAudioHigh.mul(float(0.3)).add(float(1.0));");
newBlaster = newBlaster.replace("const spunTime = uTime ? (uTime ? uTime.mul(float(5.0)) : float(0.0)) : float(0.0);", "const spunTime = uTime.mul(float(5.0));");
newBlaster = newBlaster.replace("const coreGlow = uAudioHigh ? (uAudioHigh ? baseColor.mul(float(0.5).add(uAudioHigh.mul(0.5))) : baseColor.mul(float(0.5))) : baseColor.mul(float(0.5));", "const coreGlow = baseColor.mul(float(0.5).add(uAudioHigh.mul(0.5)));");
fs.writeFileSync("src/gameplay/rainbow-blaster.ts", newBlaster);

const chord = fs.readFileSync("src/gameplay/chord-strike.ts", "utf8");
let newChord = chord.replace("const timeScale = uTime ? (uTime ? uTime.mul(20.0) : float(0.0)) : float(0.0);", "const timeScale = uTime.mul(20.0);");
newChord = newChord.replace("const coreIntensity = uAudioLow ? (uAudioLow ? uAudioLow.mul(float(1.5)).add(float(1.0)) : float(1.0)) : float(1.0);", "const coreIntensity = uAudioLow.mul(float(1.5)).add(float(1.0));");
newChord = newChord.replace("const rippleTime = uTime ? (uTime ? uTime.mul(5.0) : float(0.0)) : float(0.0);", "const rippleTime = uTime.mul(5.0);");
fs.writeFileSync("src/gameplay/chord-strike.ts", newChord);
