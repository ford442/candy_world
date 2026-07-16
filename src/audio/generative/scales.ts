/** Chromatic note names (no octave). */
export const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export type NoteName = (typeof CHROMATIC)[number];

/** Interval sets relative to root (semitones). */
export const SCALES: Record<string, readonly number[]> = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    pentatonic: [0, 2, 4, 7, 9],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
};

export function rootToMidi(root: NoteName, octave: number): number {
    const idx = CHROMATIC.indexOf(root);
    return (octave + 1) * 12 + (idx >= 0 ? idx : 0);
}

export function scaleNote(root: NoteName, scale: readonly number[], degree: number, baseOctave: number): string {
    const rootMidi = rootToMidi(root, baseOctave);
    const len = scale.length;
    const octaveShift = Math.floor(degree / len);
    const scaleIdx = ((degree % len) + len) % len;
    const midi = rootMidi + scale[scaleIdx] + octaveShift * 12;
    const noteIdx = ((midi % 12) + 12) % 12;
    const oct = Math.floor(midi / 12) - 1;
    return `${CHROMATIC[noteIdx]}${oct}`;
}

export function noteNameToChromaticIndex(note: string): number {
    const match = note.match(/^([A-G]#?)/);
    if (!match) return 0;
    const idx = CHROMATIC.indexOf(match[1] as NoteName);
    return idx >= 0 ? idx : 0;
}
