// src/audio/audio-processor.js

// We assume libopenmpt.js is available at this path in your public folder.
importScripts('/js/libopenmpt.js');

// Helper functions (portions ported from AudioSystem)
const lerp = (a, b, t) => a + (b - a) * t;
const decayTowards = (value, target, rate, dt) => lerp(value, target, 1 - Math.exp(-rate * dt));
const extractNote = (cell) => cell?.text?.match(/[A-G][#-]?\d/)?.[0];
const extractInstrument = (cell) => {
    if (!cell || !cell.text) return 0;
    const match = cell.text.match(/[A-G\.-][#\.-][\d\.-]\s+(\d+|[0-9A-F]{2})/i);
    if (match) return parseInt(match[1], 10) || parseInt(match[1], 16) || 0;
    return 0;
};
const noteToFreq = (note) => {
    if (!note) return 0;
    const n = note.toUpperCase();
    const map = { C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11 };
    const match = n.match(/^([A-G](?:#|B)?)\-?(\d)$/);
    if (!match) return 0;
    const semitone = map[match[1]] ?? 0;
    const midi = (parseInt(match[2], 10) + 1) * 12 + semitone;
    return 440 * Math.pow(2, (midi - 69) / 12);
};
const decodeEffectCode = (cell) => {
    if (!cell?.text) return { activeEffect: 0, intensity: 0 };
    const text = cell.text.trim().toUpperCase();
    const match = text.match(/([0-9A-F])([0-9A-F]{2})/);
    if (!match) return { activeEffect: 0, intensity: 0 };
    const code = match[1];
    const value = parseInt(match[2], 16) / 255;
    switch (code) {
        case '4': return { activeEffect: 1, intensity: value };
        case '3': return { activeEffect: 2, intensity: value };
        case '7': return { activeEffect: 3, intensity: value };
        case '0': if (match[2] !== '00') return { activeEffect: 4, intensity: value }; break;
        case 'R': return { activeEffect: 5, intensity: value };
        default: break;
    }
    return { activeEffect: 0, intensity: value };
};

class ChiptuneProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.libopenmpt = null;
        this.currentModulePtr = 0;
        this.isReady = false;

        this.leftBufferPtr = 0;
        this.rightBufferPtr = 0;

        // Internal state for visuals
        this.moduleInfo = { numChannels: 0 };
        this.patternMatrices = {};

        // Message port handling
        this.port.onmessage = this.handleMessage.bind(this);

        this.initLib();
    }

    async initLib() {
        try {
            // libopenmpt is loaded via importScripts, so 'libopenmpt' global should exist
            if (typeof libopenmpt !== 'undefined') {
                const lib = await libopenmpt({});

                // Add Polyfills if missing (copied from original system)
                if (!lib.UTF8ToString) {
                    lib.UTF8ToString = (ptr) => {
                        let str = '';
                        if (!ptr) return str;
                        const heap = lib.HEAPU8;
                        for (let i = 0; heap[ptr + i] !== 0; i++) {
                            str += String.fromCharCode(heap[ptr + i]);
                        }
                        return str;
                    };
                }

                this.libopenmpt = lib;
                this.isReady = true;
                this.port.postMessage({ type: 'READY' });
            } else {
                console.error("libopenmpt global not found in Worklet");
            }
        } catch (e) {
            console.error("Failed to init libopenmpt in Worklet", e);
        }
    }

    handleMessage(event) {
        const { type, data } = event.data;
        if (type === 'LOAD') {
            this.loadModule(data.fileData, data.fileName);
        } else if (type === 'STOP') {
            this.stop();
        }
    }

    stop() {
        if (this.currentModulePtr && this.libopenmpt) {
            try { this.libopenmpt._openmpt_module_destroy(this.currentModulePtr); } catch(e) {}
            this.currentModulePtr = 0;
        }
        // Free buffers
        if (this.libopenmpt) {
            if (this.leftBufferPtr) try { this.libopenmpt._free(this.leftBufferPtr); } catch(e) {}
            if (this.rightBufferPtr) try { this.libopenmpt._free(this.rightBufferPtr); } catch(e) {}
            this.leftBufferPtr = 0;
            this.rightBufferPtr = 0;
        }
    }

    loadModule(fileData, fileName) {
        if (!this.isReady) return;
        this.stop(); // Cleanup previous

        try {
            const lib = this.libopenmpt;
            const bufferPtr = lib._malloc(fileData.byteLength);
            lib.HEAPU8.set(new Uint8Array(fileData), bufferPtr);

            const modPtr = lib._openmpt_module_create_from_memory2(bufferPtr, fileData.byteLength, 0, 0, 0, 0, 0, 0, 0);
            lib._free(bufferPtr);

            if (modPtr === 0) {
                console.error(`Failed to load module ${fileName}`);
                this.port.postMessage({ type: 'SONG_END' });
                return;
            }

            this.currentModulePtr = modPtr;
            this.preCachePatternData(modPtr);

            // Alloc buffers
            this.leftBufferPtr = lib._malloc(128 * 4);
            this.rightBufferPtr = lib._malloc(128 * 4);

        } catch (e) {
            console.error("Worklet load error:", e);
        }
    }

    preCachePatternData(modPtr) {
        const lib = this.libopenmpt;
        this.patternMatrices = {};
        try {
            const numOrders = lib._openmpt_module_get_num_orders(modPtr);
            const numChannels = lib._openmpt_module_get_num_channels(modPtr);
            this.moduleInfo.numChannels = numChannels;

            for (let o = 0; o < numOrders; o++) {
                const pattern = lib._openmpt_module_get_order_pattern(modPtr, o);
                if (pattern >= lib._openmpt_module_get_num_patterns(modPtr)) continue;
                const numRows = lib._openmpt_module_get_pattern_num_rows(modPtr, pattern);
                const matrixRows = [];
                for (let r = 0; r < numRows; r++) {
                    const rowCells = [];
                    for (let c = 0; c < numChannels; c++) {
                        const commandPtr = lib._openmpt_module_format_pattern_row_channel(modPtr, pattern, r, c, 12, 1);
                        const commandStr = lib.UTF8ToString(commandPtr);
                        lib._openmpt_free_string(commandPtr);
                        rowCells.push({ text: (commandStr || '').trim() });
                    }
                    matrixRows.push(rowCells);
                }
                this.patternMatrices[o] = { rows: matrixRows, numRows, numChannels };
            }
        } catch (e) {
            console.error("Pattern cache error in worklet", e);
        }
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        if (!output) return true;

        if (!this.currentModulePtr || !this.isReady) {
            // Silence
            return true;
        }

        const lib = this.libopenmpt;
        const modPtr = this.currentModulePtr;
        const sampleRate = globalThis.sampleRate; // global in Worklet
        const bufferSize = output[0].length; // usually 128

        // Read Audio
        const frames = lib._openmpt_module_read_float_stereo(
            modPtr,
            sampleRate,
            bufferSize,
            this.leftBufferPtr,
            this.rightBufferPtr
        );

        if (frames === 0) {
            this.port.postMessage({ type: 'SONG_END' });
            return true;
        }

        const leftChannel = output[0];
        const rightChannel = output[1];

        const heap = lib.HEAPF32;

        for (let i = 0; i < bufferSize; i++) {
            leftChannel[i] = heap[(this.leftBufferPtr >> 2) + i];
            if (rightChannel) rightChannel[i] = heap[(this.rightBufferPtr >> 2) + i];
        }

        // Visual extraction
        this.processVisuals(modPtr);

        return true;
    }

    processVisuals(modPtr) {
        const lib = this.libopenmpt;
        const order = lib._openmpt_module_get_current_order(modPtr);
        const row = lib._openmpt_module_get_current_row(modPtr);
        const bpm = lib._openmpt_module_get_current_estimated_bpm(modPtr);

        const matrix = this.patternMatrices[order];
        const rowData = matrix?.rows[row] || [];
        const numChannels = this.moduleInfo.numChannels;

        const channelData = [];
        let anyTrigger = false;

        for (let ch = 0; ch < numChannels; ch++) {
            const vu = lib._openmpt_module_get_current_channel_vu_mono(modPtr, ch);
            const cell = rowData[ch];

            const noteMatch = extractNote(cell);
            const instrument = extractInstrument(cell);
            const { activeEffect, intensity } = decodeEffectCode(cell);

            if (noteMatch) anyTrigger = true;

            channelData.push({
                volume: vu,
                note: noteMatch,
                instrument: instrument,
                activeEffect: activeEffect,
                effectValue: intensity
            });
        }

        this.port.postMessage({ type: 'VISUAL_UPDATE', data: { bpm, channelData, anyTrigger } });
    }
}

registerProcessor('chiptune-processor', ChiptuneProcessor);
