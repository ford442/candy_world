import { getNoteColor } from '../src/systems/music-reactivity.js';

const notes = ['C','E','G#'];
for (const n of notes) {
  const hex = getNoteColor(n, 'mushroom');
  console.log(`${n} -> 0x${hex.toString(16).padStart(6,'0')}`);
}
