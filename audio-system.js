// AudioSystem.js - With Playlist Queue & Stability Fixes

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 1024;

// Helper functions
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

export class AudioSystem {
    constructor() {
        this.libopenmpt = null;
        this.currentModulePtr = 0;
        this.audioContext = null;
        this.scriptNode = null;
        this.stereoPanner = null;
        this.gainNode = null;

        // Memory management for WASM buffers
        this.leftBufferPtr = 0;
        this.rightBufferPtr = 0;

        this.moduleInfo = { title: '...', order: 0, row: 0, bpm: 0, numChannels: 0 };
        this.patternMatrices = {};
        this.isPlaying = false;
        this.isReady = false;
        this.volume = 1.0;

        // Playlist State
        this.playlist = []; // Array of File objects
        this.currentIndex = -1;

        // Visual state
        this.visualState = {
            beatPhase: 0,
            kickTrigger: 0,
            grooveAmount: 0,
            activeChannels: 0,
            channelData: [],
            bpm: 120  // Current estimated BPM
        };

        this.init();
    }

    async init() {
        if (!window.libopenmptReady) {
            console.error("libopenmptReady promise not found.");
            return;
        }
        try {
            const lib = await window.libopenmptReady;
            // Polyfills
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
            if (!lib.stringToUTF8) {
                lib.stringToUTF8 = (jsString) => {
                    const length = (jsString.length << 2) + 1;
                    const ptr = lib._malloc(length);
                    const heap = lib.HEAPU8;
                    let i = 0, j = 0;
                    while (i < jsString.length) {
                        heap[ptr + j++] = jsString.charCodeAt(i++);
                    }
                    heap[ptr + j] = 0;
                    return ptr;
                };
            }
            this.libopenmpt = lib;
            this.isReady = true;
            console.log("AudioSystem initialized.");
        } catch (err) {
            console.error("AudioSystem init failed:", err);
        }
    }

    // --- Playlist Management ---

    async addToQueue(fileList) {
        if (!this.isReady) return;

        const initialLength = this.playlist.length;
        for (let i = 0; i < fileList.length; i++) {
            this.playlist.push(fileList[i]);
            console.log(`Added to queue: ${fileList[i].name}`);
        }

        // If we weren't playing anything, start the first new song
        if (this.currentIndex === -1 || !this.isPlaying) {
            this.playNext(initialLength); // Start from the first new file
        }
    }

    async playNext(forceIndex = null) {
        if (this.playlist.length === 0) return;

        let nextIndex = (forceIndex !== null) ? forceIndex : this.currentIndex + 1;

        if (nextIndex >= this.playlist.length) {
            console.log("Playlist finished. Looping to start.");
            nextIndex = 0;
        }

        this.currentIndex = nextIndex;
        const file = this.playlist[this.currentIndex];

        console.log(`Loading track ${this.currentIndex + 1}/${this.playlist.length}: ${file.name}`);
        await this.loadModule(file);
    }

    // --- Core Loading ---

    async loadModule(file) {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        try {
            const arrayBuffer = await file.arrayBuffer();
            const fileData = new Uint8Array(arrayBuffer);
            this.processModuleData(fileData, file.name);
        } catch (e) {
            console.error("Error reading file:", e);
            // On error, skip to next
            this.playNext();
        }
    }

    processModuleData(fileData, fileName) {
        if (!this.libopenmpt) return;

        // CRITICAL FIX: Stop cleanly before destroying memory
        this.stop(false);

        if (this.currentModulePtr !== 0) {
            this.libopenmpt._openmpt_module_destroy(this.currentModulePtr);
            this.currentModulePtr = 0;
        }

        try {
            const lib = this.libopenmpt;
            const bufferPtr = lib._malloc(fileData.length);
            lib.HEAPU8.set(fileData, bufferPtr);

            const modPtr = lib._openmpt_module_create_from_memory2(bufferPtr, fileData.length, 0, 0, 0, 0, 0, 0, 0);
            lib._free(bufferPtr);

            if (modPtr === 0) {
                throw new Error(`Failed to load module "${fileName}".`);
            }
            this.currentModulePtr = modPtr;

            const titleKeyPtr = lib.stringToUTF8("title");
            const titleValuePtr = lib._openmpt_module_get_metadata(modPtr, titleKeyPtr);
            const title = lib.UTF8ToString(titleValuePtr) || fileName;
            lib._free(titleKeyPtr);
            lib._openmpt_free_string(titleValuePtr);

            this.moduleInfo.title = title;
            this.preCachePatternData(modPtr);
            this.play();

        } catch (e) {
            console.error("Failed to load module:", e);
            this.playNext(); // Skip broken files
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
            console.error("Pattern caching error:", e);
        }
    }

    play() {
        if (this.currentModulePtr === 0 || !this.libopenmpt) return;

        if (!this.audioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
        }

        if (this.isPlaying) return;

        try {
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = this.volume;
            this.gainNode.connect(this.audioContext.destination);

            const lib = this.libopenmpt;
            const modPtr = this.currentModulePtr;

            // Memory Leak Fix: Re-use and manage buffers properly
            if (this.leftBufferPtr) lib._free(this.leftBufferPtr);
            if (this.rightBufferPtr) lib._free(this.rightBufferPtr);

            this.leftBufferPtr = lib._malloc(BUFFER_SIZE * 4);
            this.rightBufferPtr = lib._malloc(BUFFER_SIZE * 4);

            // Store local consts for closure capture
            const leftBufferPtr = this.leftBufferPtr;
            const rightBufferPtr = this.rightBufferPtr;

            this.scriptNode = this.audioContext.createScriptProcessor(BUFFER_SIZE, 0, 2);

            // Capture the current node in closure
            const currentNode = this.scriptNode;

            this.scriptNode.onaudioprocess = (e) => {
                // SAFETY GUARD: Check if we are still the active node
                if (!this.isPlaying || this.scriptNode !== currentNode) return;

                // Check if pointer is valid (rudimentary check)
                if (modPtr === 0) return;

                const frames = lib._openmpt_module_read_float_stereo(modPtr, SAMPLE_RATE, BUFFER_SIZE, leftBufferPtr, rightBufferPtr);

                // Song End Detection
                if (frames === 0) {
                    console.log("Song finished.");
                    // We must break the synchronous loop to load the next song
                    // setTimeout puts this on the next event loop tick
                    setTimeout(() => this.playNext(), 0);

                    // Output silence for this frame
                    const leftOutput = e.outputBuffer.getChannelData(0);
                    const rightOutput = e.outputBuffer.getChannelData(1);
                    leftOutput.fill(0);
                    rightOutput.fill(0);
                    return;
                }

                const leftOutput = e.outputBuffer.getChannelData(0);
                const rightOutput = e.outputBuffer.getChannelData(1);
                leftOutput.set(new Float32Array(lib.HEAPF32.buffer, leftBufferPtr, frames));
                rightOutput.set(new Float32Array(lib.HEAPF32.buffer, rightBufferPtr, frames));
            };

            this.stereoPanner = this.audioContext.createStereoPanner();
            this.scriptNode.connect(this.stereoPanner);
            this.stereoPanner.connect(this.gainNode);

            this.isPlaying = true;

        } catch (e) {
            console.error("Playback failed:", e);
        }
    }

    stop(fullReset = true) {
        // 1. Kill the audio processing immediately
        if (this.scriptNode) {
            this.scriptNode.onaudioprocess = null; // CRITICAL FIX
            this.scriptNode.disconnect();
            this.scriptNode = null;
        }
        if (this.stereoPanner) {
            this.stereoPanner.disconnect();
            this.stereoPanner = null;
        }

        // Memory Leak Fix: Free buffers
        if (this.libopenmpt) {
            if (this.leftBufferPtr) {
                this.libopenmpt._free(this.leftBufferPtr);
                this.leftBufferPtr = 0;
            }
            if (this.rightBufferPtr) {
                this.libopenmpt._free(this.rightBufferPtr);
                this.rightBufferPtr = 0;
            }
        }

        this.isPlaying = false;

        if (fullReset && this.currentModulePtr && this.libopenmpt) {
            try {
                this.libopenmpt._openmpt_module_set_position_order_row(this.currentModulePtr, 0, 0);
            } catch (e) {
                console.warn("Failed to reset position:", e);
            }
        }
    }

    update() {
        if (!this.libopenmpt || this.currentModulePtr === 0 || !this.isPlaying) {
            this.visualState.kickTrigger = decayTowards(this.visualState.kickTrigger, 0, 8, 1 / 60);
            return this.visualState;
        }

        const lib = this.libopenmpt;
        const modPtr = this.currentModulePtr;

        const order = lib._openmpt_module_get_current_order(modPtr);
        const row = lib._openmpt_module_get_current_row(modPtr);
        const bpm = lib._openmpt_module_get_current_estimated_bpm(modPtr);
        const tempo2 = lib._openmpt_module_get_current_tempo2?.(modPtr) ?? bpm;
        const speed = lib._openmpt_module_get_current_speed?.(modPtr) ?? 6;

        this.visualState.beatPhase = (this.visualState.beatPhase + (tempo2 / 60) * (1 / 60)) % 1;
        this.visualState.grooveAmount = decayTowards(this.visualState.grooveAmount, speed % 2 === 0 ? 0 : 0.1, 3, 1 / 60);
        this.visualState.bpm = bpm || 120; // Expose BPM for musical ecosystem effects

        const matrix = this.patternMatrices[order];
        const rowData = matrix?.rows[row] || [];
        const numChannels = matrix?.numChannels || this.moduleInfo.numChannels;

        while (this.visualState.channelData.length < numChannels) {
            this.visualState.channelData.push({
                volume: 0, pan: 0, trigger: 0, note: '', freq: 0, instrument: 0, activeEffect: 0, effectValue: 0
            });
        }

        let anyTrigger = false;

        for (let ch = 0; ch < numChannels; ch++) {
            const vu = lib._openmpt_module_get_current_channel_vu_mono?.(modPtr, ch) ?? 0;
            const vuL = lib._openmpt_module_get_current_channel_vu_left?.(modPtr, ch) ?? vu;
            const vuR = lib._openmpt_module_get_current_channel_vu_right?.(modPtr, ch) ?? vu;
            const pan = Math.max(-1, Math.min(1, vuR - vuL));
            const volume = Math.min(1, vu);

            const cell = rowData[ch];
            const noteMatch = extractNote(cell);
            const trigger = noteMatch ? 1 : 0;
            const freq = noteToFreq(noteMatch);
            const instrument = extractInstrument(cell);
            const { activeEffect, intensity } = decodeEffectCode(cell);

            if (trigger) anyTrigger = true;

            const chState = this.visualState.channelData[ch];
            chState.volume = volume;
            chState.pan = pan;
            chState.trigger = trigger ? 1 : decayTowards(chState.trigger, 0, 10, 1 / 60);
            chState.note = noteMatch || chState.note;
            chState.freq = freq || chState.freq;
            if (trigger && instrument > 0) chState.instrument = instrument;
            chState.activeEffect = activeEffect;
            chState.effectValue = intensity;
        }

        if (anyTrigger) {
            this.visualState.kickTrigger = 1;
        } else {
            this.visualState.kickTrigger = decayTowards(this.visualState.kickTrigger, 0, 8, 1 / 60);
        }

        return this.visualState;
    }
}
