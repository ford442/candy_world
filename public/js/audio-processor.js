// public/js/audio-processor.js

// 1. Use ES Module Import instead of importScripts
// Note: This expects libopenmpt.js to be accessible at /js/libopenmpt.js
import '/js/libopenmpt.js'; 

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
        
        this.moduleInfo = { numChannels: 0 };
        this.patternMatrices = {};
        
        this.port.onmessage = this.handleMessage.bind(this);
        
        this.initLib();
    }
    
    async initLib() {
        try {
            // 2. Check for the global object
            // Since we are in a module, we look for it on 'self' or 'globalThis'
            // NOTE: You must modify libopenmpt.js to ensure it attaches to 'self' (see Step 2 below)
            const libFactory = self.libopenmpt || globalThis.libopenmpt;

            if (typeof libFactory !== 'undefined') {
                const lib = await libFactory({
                    locateFile: (path) => '/js/' + path // Help it find the .wasm file
                });
                
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
                
                this.libopenmpt = lib;
                this.isReady = true;
                this.port.postMessage({ type: 'READY' });
            } else {
                console.error("libopenmpt global not found. Ensure public/js/libopenmpt.js assigns 'self.libopenmpt = ...'");
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
            this.libopenmpt._openmpt_module_destroy(this.currentModulePtr);
            this.currentModulePtr = 0;
        }
        if (this.libopenmpt) {
            if (this.leftBufferPtr) this.libopenmpt._free(this.leftBufferPtr);
            if (this.rightBufferPtr) this.libopenmpt._free(this.rightBufferPtr);
            this.leftBufferPtr = 0;
            this.rightBufferPtr = 0;
        }
    }
    
    loadModule(fileData, fileName) {
        if (!this.isReady) return;
        this.stop(); 
        
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
            return true;
        }

        const lib = this.libopenmpt;
        const modPtr = this.currentModulePtr;
        const sampleRate = globalThis.sampleRate; // Worklet Global
        const bufferSize = output[0].length;

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
        
        // Optimize: use subarray if possible, but loop is safe
        for (let i = 0; i < bufferSize; i++) {
            leftChannel[i] = heap[(this.leftBufferPtr >> 2) + i];
            if (rightChannel) rightChannel[i] = heap[(this.rightBufferPtr >> 2) + i];
        }
        
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
        
        this.port.postMessage({
            type: 'VISUAL_UPDATE',
            data: { bpm, channelData, anyTrigger }
        });
    }
}

registerProcessor('chiptune-processor', ChiptuneProcessor);
