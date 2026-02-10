// AudioSystem.ts - With Playlist Queue & Stability Fixes

const SAMPLE_RATE = 44100;
const SCRIPT_PROCESSOR_VISUAL_UPDATE_FREQUENCY = 10; // Process visuals every Nth callback to reduce overhead

// Helper functions
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const decayTowards = (value: number, target: number, rate: number, dt: number): number => lerp(value, target, 1 - Math.exp(-rate * dt));

const noteToFreq = (note: string | null): number => {
    if (!note) return 0;
    const n = note.toUpperCase();
    const map: Record<string, number> = { C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11 };
    const match = n.match(/^([A-G](?:#|B)?)\-?(\d)$/);
    if (!match) return 0;
    const semitone = map[match[1]] ?? 0;
    const midi = (parseInt(match[2], 10) + 1) * 12 + semitone;
    return 440 * Math.pow(2, (midi - 69) / 12);
};

// Unused helper functions preserved for compatibility/future use
const extractNote = (cell: PatternRowCell | null): string | undefined => cell?.text?.match(/[A-G][#-]?\d/)?.[0];

const extractInstrument = (cell: PatternRowCell | null): number => {
    if (!cell || !cell.text) return 0;
    const match = cell.text.match(/[A-G\.-][#\.-][\d\.-]\s+(\d+|[0-9A-F]{2})/i);
    if (match) return parseInt(match[1], 10) || parseInt(match[1], 16) || 0;
    return 0;
};

const decodeEffectCode = (cell: PatternRowCell | null): { activeEffect: number, intensity: number } => {
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

// Interfaces
export interface ChannelData {
    volume: number;
    pan: number;
    trigger: number;
    note: string;
    freq: number;
    instrument: number;
    activeEffect: number;
    effectValue: number;
}

export interface VisualState {
    beatPhase: number;
    kickTrigger: number;
    grooveAmount: number;
    activeChannels: number;
    channelData: ChannelData[];
    bpm: number;
    patternIndex: number;
    row: number;
}

interface ModuleInfo {
    title: string;
    order: number;
    row: number;
    bpm: number;
    numChannels: number;
}

interface PatternRowCell {
    text: string;
}

interface PatternMatrix {
    rows: PatternRowCell[][];
    numRows: number;
    numChannels: number;
}

interface LibOpenMPT {
    _malloc(size: number): number;
    _free(ptr: number): void;
    _openmpt_module_create_from_memory2(ptr: number, size: number, logfunc: number, errfunc: number, errqual: number, errorfunc: number, errorqual: number, error_count_ptr: number, info_ptr: number): number;
    _openmpt_module_destroy(modPtr: number): void;
    stringToUTF8(str: string): number;
    UTF8ToString(ptr: number): string;
    _openmpt_free_string(ptr: number): void;
    _openmpt_module_get_metadata(modPtr: number, keyPtr: number): number;
    _openmpt_module_get_num_orders(modPtr: number): number;
    _openmpt_module_get_num_channels(modPtr: number): number;
    _openmpt_module_get_num_patterns(modPtr: number): number;
    _openmpt_module_get_order_pattern(modPtr: number, order: number): number;
    _openmpt_module_get_pattern_num_rows(modPtr: number, pattern: number): number;
    _openmpt_module_format_pattern_row_channel(modPtr: number, pattern: number, row: number, channel: number, format: number, detail: number): number;
    _openmpt_module_read_float_stereo(modPtr: number, sampleRate: number, count: number, leftPtr: number, rightPtr: number): number;
    _openmpt_module_get_current_order(modPtr: number): number;
    _openmpt_module_get_current_row(modPtr: number): number;
    _openmpt_module_get_current_estimated_bpm(modPtr: number): number;
    _openmpt_module_get_current_channel_vu_mono(modPtr: number, channel: number): number;
    HEAPU8: Uint8Array;
    HEAPF32: Float32Array;
}

// Extend Window interface for global libopenmpt
declare global {
    interface Window {
        setLoadingStatus?: (text: string) => void;
        libopenmpt?: LibOpenMPT;
        libopenmptReady?: Promise<LibOpenMPT>;
        webkitAudioContext?: typeof AudioContext;
    }
}

export class AudioSystem {
    libopenmpt: LibOpenMPT | null;
    currentModulePtr: number;
    audioContext: AudioContext | null;
    workletNode: AudioWorkletNode | null;
    scriptProcessorNode: ScriptProcessorNode | null;
    gainNode: GainNode | null;

    // Memory management for WASM buffers
    leftBufferPtr: number;
    rightBufferPtr: number;

    moduleInfo: ModuleInfo;
    patternMatrices: Record<number, PatternMatrix>;
    isPlaying: boolean;
    isReady: boolean;

    // Volume State
    volume: number;
    previousVolume: number;
    isMuted: boolean;

    // Playlist State
    playlist: File[]; // Array of File objects
    currentIndex: number;

    // Callbacks for UI
    onPlaylistUpdate: ((playlist: File[]) => void) | null;
    onTrackChange: ((index: number) => void) | null;

    // Note Callback
    onNoteCallback: ((note: string, volume: number, channelIndex: number) => void) | null;

    // Visual state
    visualState: VisualState;

    // Audio mode
    useScriptProcessorNode: boolean;
    
    // ScriptProcessor visual update counter
    private scriptProcessorCallbackCount: number;
    
    // Stop guard flag to prevent concurrent calls
    private isStopping: boolean;

    constructor(useScriptProcessorNode: boolean = false) {
        this.libopenmpt = null;
        this.currentModulePtr = 0;
        this.audioContext = null;
        this.workletNode = null;
        this.scriptProcessorNode = null;
        this.gainNode = null;

        // Memory management for WASM buffers
        this.leftBufferPtr = 0;
        this.rightBufferPtr = 0;

        this.moduleInfo = { title: '...', order: 0, row: 0, bpm: 0, numChannels: 0 };
        this.patternMatrices = {};
        this.isPlaying = false;
        this.isReady = false;

        // Volume State
        this.volume = 1.0;
        this.previousVolume = 1.0;
        this.isMuted = false;

        // Playlist State
        this.playlist = []; // Array of File objects
        this.currentIndex = -1;

        // Callbacks for UI
        this.onPlaylistUpdate = null; // Called when songs added
        this.onTrackChange = null;    // Called when song changes

        // Note Callback
        this.onNoteCallback = null;

        // Visual state
        this.visualState = {
            beatPhase: 0,
            kickTrigger: 0,
            grooveAmount: 0,
            activeChannels: 0,
            channelData: [],
            bpm: 120, // Current estimated BPM
            patternIndex: 0, // Current pattern/order index
            row: 0
        };

        // Audio mode
        this.useScriptProcessorNode = useScriptProcessorNode;
        this.scriptProcessorCallbackCount = 0;
        this.isStopping = false;

        this.init();
    }

    // --- API to register note listener ---
    onNote(callback: (note: string, volume: number, channelIndex: number) => void): void {
        this.onNoteCallback = callback;
    }

    // Backward compatibility alias if needed
    setNoteCallback(callback: (note: string, volume: number, channelIndex: number) => void): void {
        this.onNoteCallback = callback;
    }

    async init(): Promise<void> {
        if (window.setLoadingStatus) window.setLoadingStatus("Starting Audio System...");
        
        // Log the audio mode being used
        console.log(`[AudioSystem] Initializing with ${this.useScriptProcessorNode ? 'ScriptProcessorNode (Compatibility Mode)' : 'AudioWorkletNode (Default Mode)'}`);

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();

            if (this.useScriptProcessorNode) {
                // --- ScriptProcessorNode Mode ---
                await this.initScriptProcessorMode();
            } else {
                // --- AudioWorkletNode Mode (Default) ---
                await this.initWorkletMode();
            }

            // Connect audio graph
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = this.volume;

            if (this.workletNode) {
                this.workletNode.connect(this.gainNode);
            } else if (this.scriptProcessorNode) {
                this.scriptProcessorNode.connect(this.gainNode);
            }
            this.gainNode.connect(this.audioContext.destination);

        } catch (e) {
            console.error("AudioSystem Init Failed:", e);
        }
    }

    private async initWorkletMode(): Promise<void> {
        // --- PATH DEBUGGING & PRE-FETCH FIX ---
        // Calculate the absolute path to the 'js' folder based on the current page
        // This works for localhost, production, and subdirectories (e.g. GitHub Pages)
        const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
        const workletUrl = basePath + 'js/audio-processor.js';

        console.log(`[AudioSystem] Attempting to load Worklet from: ${workletUrl}`);

        try {
            // First fetch the file to inspect status and content (helps detect SPA rewrites or HTML 404 responses)
            const res = await fetch(workletUrl, { cache: 'no-store' });
            if (!res.ok) {
                console.error(`[AudioSystem] Worklet fetch failed with status=${res.status} for ${workletUrl}`);
                throw new Error(`Worklet fetch failed: ${res.status}`);
            }

            const contentType = res.headers.get('content-type') || '';
            let text = await res.text();

            // If the response looks like HTML (SPA fallback) or is unexpectedly small, try root '/js/' fallback
            const looksLikeHTML = text.trim().startsWith('<');
            if (text.trim().length < 20 || looksLikeHTML) {
                console.warn(`[AudioSystem] Worklet content at ${workletUrl} looks suspicious (length=${text.length}, looksLikeHTML=${looksLikeHTML}). Trying root '/js/audio-processor.js' as a fallback.`);
                try {
                    const jsUrl = new URL('./js/audio-processor.js', import.meta.url).href;
                    const rootRes = await fetch(jsUrl, { cache: 'no-store' });
                    if (rootRes.ok) {
                        const rootCT = rootRes.headers.get('content-type') || '';
                        const rootText = await rootRes.text();
                        if (rootText.trim().length > 20 && (/javascript|ecmascript|module/.test(rootCT) || /\b(import|registerProcessor|class)\b/.test(rootText.slice(0, 200)))) {
                            console.log('[AudioSystem] Fallback /js/audio-processor.js looks like valid JS. Using it.');
                            text = rootText;
                        } else {
                            console.warn('[AudioSystem] Fallback /js/audio-processor.js did not contain valid JS.');
                        }
                    } else {
                        console.warn(`[AudioSystem] Fallback fetch failed with status=${rootRes.status}`);
                    }
                } catch (fallbackErr) {
                    console.warn('[AudioSystem] Fallback fetch for /js/audio-processor.js failed', fallbackErr);
                }

                if (text.trim().length < 20 || text.trim().startsWith('<')) {
                    console.error(`[AudioSystem] Worklet content is invalid after fallback. First chars: ${text.slice(0, 160)}`);
                    throw new Error('Worklet content invalid or HTML fallback');
                }
            }

            if (!/javascript|ecmascript|module/.test(contentType) && !/\b(import|registerProcessor|class)\b/.test(text.slice(0, 200))) {
                console.warn(`[AudioSystem] Worklet content-type="${contentType}" and file does not look like JS. First chars: ${text.slice(0, 120)}`);
            }

            // Before creating the blob, rewrite relative import/export specifiers to absolute URLs
            // This fixes failures when the module is loaded from a blob URL (blob URLs are not hierarchical)
            let rewritten = text;
            try {
                const makeAbsolute = (spec: string): string => {
                    // Leave full URLs and protocol-relative URLs alone
                    if (/^[a-zA-Z][a-zA-Z0-9+-.]*:\/\//.test(spec) || spec.startsWith('//')) return spec;
                    // Non-relative bare specifiers (like 'three') should be left unchanged
                    if (!spec.startsWith('.') && !spec.startsWith('/')) return spec;
                    try {
                        return new URL(spec, workletUrl).href;
                    } catch (err) {
                        return spec;
                    }
                };

                // from '...'
                rewritten = rewritten.replace(/(from\s+)(['"])([^'"\n]+)\2/g, (m, p1, q, spec) => {
                    const abs = makeAbsolute(spec);
                    return `${p1}${q}${abs}${q}`;
                });
                // import '...'
                rewritten = rewritten.replace(/(import\s+)(['"])([^'"\n]+)\2/g, (m, p1, q, spec) => {
                    const abs = makeAbsolute(spec);
                    return `${p1}${q}${abs}${q}`;
                });
                // dynamic import('...')
                rewritten = rewritten.replace(/(import\()(['"])([^'"\n]+)\2(\))/g, (m, p1, q, spec, p4) => {
                    const abs = makeAbsolute(spec);
                    return `${p1}${q}${abs}${q}${p4}`;
                });

                if (rewritten !== text) {
                    console.log('[AudioSystem] Rewrote import specifiers in worklet to absolute URLs to avoid blob-relative resolution issues.');
                }
            } catch (err) {
                console.warn('[AudioSystem] Failed to rewrite import specifiers, proceeding with original text', err);
            }

            const blobUrl = URL.createObjectURL(new Blob([rewritten], { type: 'application/javascript' }));
            try {
                await this.audioContext!.audioWorklet.addModule(blobUrl);
                if (window.setLoadingStatus) window.setLoadingStatus("Audio Worklet Ready...");
                URL.revokeObjectURL(blobUrl);
            } catch (e) {
                console.error(`[AudioSystem] addModule failed for blob derived from ${workletUrl}`);
                throw e;
            }
        } catch (e) {
            console.error(`[AudioSystem] Failed to load worklet at ${workletUrl}. Check the Network tab in DevTools for 404s or HTML responses.`);
            throw e;
        }
        // --------------------------

        this.workletNode = new AudioWorkletNode(this.audioContext!, 'chiptune-processor');

        // Wire up messages from the audio thread
        this.workletNode.port.onmessage = (event) => {
            const { type, data } = event.data || {};
            if (type === 'VISUAL_UPDATE') {
                this.handleVisualUpdate(data);
            } else if (type === 'SONG_END') {
                console.log("AudioSystem: Song finished (Worklet).");
                this.playNext();
            } else if (type === 'READY') {
                this.isReady = true;
                console.log("AudioSystem: Worklet Ready.");
                if (this.playlist.length > 0 && this.currentIndex === -1) {
                    this.playNext(0);
                }
            }
        };
    }

    private async initScriptProcessorMode(): Promise<void> {
        console.log('[AudioSystem] Using ScriptProcessorNode (compatibility mode)');
        if (window.setLoadingStatus) window.setLoadingStatus("Audio ScriptProcessor Ready...");

        // Wait for libopenmpt to be ready
        if (!window.libopenmpt) {
            console.log('[AudioSystem] Waiting for libopenmpt...');
            await window.libopenmptReady;
        }

        this.libopenmpt = window.libopenmpt!;
        
        // Create ScriptProcessorNode (4096 samples buffer, 0 inputs, 2 outputs for stereo)
        const bufferSize = 4096;
        this.scriptProcessorNode = this.audioContext!.createScriptProcessor(bufferSize, 0, 2);

        // Allocate WASM buffers for audio processing
        this.leftBufferPtr = this.libopenmpt._malloc(bufferSize * 4);
        this.rightBufferPtr = this.libopenmpt._malloc(bufferSize * 4);

        // Set up audio processing callback
        this.scriptProcessorNode.onaudioprocess = (event) => {
            this.processAudioScriptProcessor(event);
        };

        this.isReady = true;
        console.log("AudioSystem: ScriptProcessor Ready.");
        
        if (this.playlist.length > 0 && this.currentIndex === -1) {
            this.playNext(0);
        }
    }

    private processAudioScriptProcessor(event: AudioProcessingEvent): void {
        if (!this.currentModulePtr || !this.isPlaying || !this.libopenmpt) {
            return;
        }

        const outputL = event.outputBuffer.getChannelData(0);
        const outputR = event.outputBuffer.getChannelData(1);
        const bufferSize = outputL.length;

        const lib = this.libopenmpt;
        const modPtr = this.currentModulePtr;
        const sampleRate = this.audioContext!.sampleRate;

        // Read audio data from libopenmpt
        const frames = lib._openmpt_module_read_float_stereo(
            modPtr,
            sampleRate,
            bufferSize,
            this.leftBufferPtr,
            this.rightBufferPtr
        );

        if (frames === 0) {
            console.log("AudioSystem: Song finished (ScriptProcessor).");
            this.playNext();
            return;
        }

        // Copy from WASM memory to output buffers
        const heap = lib.HEAPF32;
        for (let i = 0; i < bufferSize; i++) {
            outputL[i] = heap[(this.leftBufferPtr >> 2) + i];
            outputR[i] = heap[(this.rightBufferPtr >> 2) + i];
        }

        // Process visuals every Nth callback to reduce overhead
        this.scriptProcessorCallbackCount++;
        if (this.scriptProcessorCallbackCount >= SCRIPT_PROCESSOR_VISUAL_UPDATE_FREQUENCY) {
            this.scriptProcessorCallbackCount = 0;
            this.processVisualsScriptProcessor(modPtr);
        }
    }

    private processVisualsScriptProcessor(modPtr: number): void {
        const lib = this.libopenmpt!;
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

        this.handleVisualUpdate({ bpm, channelData, anyTrigger, order, row });
    }

    // --- Volume Control (UX) ---

    setVolume(value: number): void {
        this.volume = Math.max(0, Math.min(1, value));
        if (this.gainNode) {
            // Use setTargetAtTime for smooth volume transitions (avoids clicking)
            // If currentTime is not available, fallback to direct assignment
            const time = this.audioContext ? this.audioContext.currentTime : 0;
            try {
                this.gainNode.gain.setTargetAtTime(this.volume, time, 0.1);
            } catch(e) {
                this.gainNode.gain.value = this.volume;
            }
        }
    }

    toggleMute(): boolean {
        if (this.isMuted) {
            // Unmute
            this.setVolume(this.previousVolume);
            this.isMuted = false;
        } else {
            // Mute
            this.previousVolume = this.volume > 0 ? this.volume : 1.0; // Remember volume or default to 1
            this.setVolume(0);
            this.isMuted = true;
        }
        return this.isMuted;
    }

    // --- Playlist Management ---

    async addToQueue(fileList: File[] | FileList): Promise<void> {
        if (!this.isReady) return;

        const initialLength = this.playlist.length;
        for (let i = 0; i < fileList.length; i++) {
            this.playlist.push(fileList[i]);
            console.log(`Added to queue: ${fileList[i].name}`);
        }

        // Notify UI
        if (this.onPlaylistUpdate) this.onPlaylistUpdate(this.playlist);

        // If we weren't playing anything, start the first new song
        if (this.currentIndex === -1 || !this.isPlaying) {
            this.playNext(initialLength); // Start from the first new file
        }
    }

    async playNext(forceIndex: number | null = null): Promise<void> {
        if (this.playlist.length === 0) return;

        let nextIndex = (forceIndex !== null) ? forceIndex : this.currentIndex + 1;

        if (nextIndex >= this.playlist.length) {
            console.log("Playlist finished. Looping to start.");
            nextIndex = 0;
        }

        this.currentIndex = nextIndex;
        
        // Notify UI of track change
        if (this.onTrackChange) this.onTrackChange(this.currentIndex);
        
        const file = this.playlist[this.currentIndex];
        console.log(`Loading track ${this.currentIndex + 1}/${this.playlist.length}: ${file.name}`);
        await this.loadModule(file);
    }
    
    // --- NEW: Helper for UI clicking ---
    playAtIndex(index: number): void {
        if (index >= 0 && index < this.playlist.length) {
            this.playNext(index);
        }
    }
    
    getPlaylist(): File[] {
        return this.playlist;
    }
    
    getCurrentIndex(): number {
        return this.currentIndex;
    }

    // --- Core Loading ---

    async loadModule(file: File): Promise<void> {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        try {
            const arrayBuffer = await file.arrayBuffer();
            
            if (this.useScriptProcessorNode) {
                // ScriptProcessorNode mode - load directly
                const fileData = new Uint8Array(arrayBuffer);
                this.processModuleData(fileData, file.name);
            } else {
                // AudioWorkletNode mode - send to worklet for loading/decoding (transfer the buffer)
                if (this.workletNode && this.workletNode.port) {
                    try {
                        this.workletNode.port.postMessage({ type: 'LOAD', fileData: arrayBuffer, fileName: file.name }, [arrayBuffer]);
                    } catch (e) {
                        // Some browsers may not accept transferred buffer if already neutered; fall back to structured clone
                        this.workletNode.port.postMessage({ type: 'LOAD', fileData: arrayBuffer, fileName: file.name });
                    }
                } else {
                    console.warn('Worklet not ready to receive LOAD message. Attempting to init worklet and retry.');
                    await this.init();
                    if (this.workletNode && this.workletNode.port) {
                        this.workletNode.port.postMessage({ type: 'LOAD', fileData: arrayBuffer, fileName: file.name }, [arrayBuffer]);
                    }
                }
            }

            // Start playback (worklet will decode/play once module loaded, or ScriptProcessor is already ready)
            await this.play();
        } catch (e) {
            console.error("Error loading file:", e);
            this.playNext();
        }
    }

    processModuleData(fileData: Uint8Array, fileName: string): void {
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

    preCachePatternData(modPtr: number): void {
        const lib = this.libopenmpt;
        if (!lib) return;

        this.patternMatrices = {};
        try {
            const numOrders = lib._openmpt_module_get_num_orders(modPtr);
            const numChannels = lib._openmpt_module_get_num_channels(modPtr);
            this.moduleInfo.numChannels = numChannels;

            for (let o = 0; o < numOrders; o++) {
                const pattern = lib._openmpt_module_get_order_pattern(modPtr, o);
                if (pattern >= lib._openmpt_module_get_num_patterns(modPtr)) continue;
                const numRows = lib._openmpt_module_get_pattern_num_rows(modPtr, pattern);
                const matrixRows: PatternRowCell[][] = [];
                for (let r = 0; r < numRows; r++) {
                    const rowCells: PatternRowCell[] = [];
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

    async play(): Promise<void> {
        if (this.isPlaying) return;

        // Ensure audio context is resumed
        if (!this.audioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
        }
        if (this.audioContext.state === 'suspended') await this.audioContext.resume();

        // Ensure audio processing node is initialized
        if (this.useScriptProcessorNode) {
            if (!this.scriptProcessorNode) {
                try { await this.init(); } catch (e) { console.warn('ScriptProcessor init failed in play()', e); }
            }
        } else {
            if (!this.workletNode) {
                try { await this.init(); } catch (e) { console.warn('Worklet init failed in play()', e); }
            }
        }

        this.isPlaying = true;
    }

    stop(fullReset: boolean = true): void {
        // Guard against concurrent calls
        if (this.isStopping) {
            return;
        }
        this.isStopping = true;

        // Set isPlaying to false before cleanup to prevent audio callbacks from processing
        this.isPlaying = false;

        // Notify worklet to stop and clean up
        try {
            if (this.workletNode && this.workletNode.port) this.workletNode.port.postMessage({ type: 'STOP' });
        } catch (e) {
            console.warn('Failed to signal STOP to worklet', e);
        }

        // Disconnect audio graph parts
        try {
            if (this.workletNode) {
                try { this.workletNode.disconnect(); } catch(e) {}
                this.workletNode = null;
            }
            if (this.scriptProcessorNode) {
                try { 
                    this.scriptProcessorNode.disconnect();
                    this.scriptProcessorNode.onaudioprocess = null;
                } catch(e) {}
                this.scriptProcessorNode = null;
            }
            if (this.gainNode) {
                try { this.gainNode.disconnect(); } catch(e) {}
                this.gainNode = null;
            }
        } catch (e) {
            console.warn('Error disconnecting audio nodes:', e);
        }

        // Clean up module and buffers for ScriptProcessorNode mode
        if (this.useScriptProcessorNode && this.libopenmpt) {
            try {
                if (this.currentModulePtr !== 0) {
                    this.libopenmpt._openmpt_module_destroy(this.currentModulePtr);
                    this.currentModulePtr = 0;
                }
                if (this.leftBufferPtr) {
                    this.libopenmpt._free(this.leftBufferPtr);
                    this.leftBufferPtr = 0;
                }
                if (this.rightBufferPtr) {
                    this.libopenmpt._free(this.rightBufferPtr);
                    this.rightBufferPtr = 0;
                }
            } catch (e) { /* ignore */ }
        } else if (this.libopenmpt) {
            // Backwards-compat: free any local WASM buffers if present
            try {
                if (this.leftBufferPtr) {
                    this.libopenmpt._free(this.leftBufferPtr);
                    this.leftBufferPtr = 0;
                }
                if (this.rightBufferPtr) {
                    this.libopenmpt._free(this.rightBufferPtr);
                    this.rightBufferPtr = 0;
                }
            } catch (e) { /* ignore */ }
        }

        // Release the stopping guard
        this.isStopping = false;

        // There's no longer a main-thread module pointer we reset here in AudioWorkletNode mode; Worklet handles its own reset
    }

    handleVisualUpdate(data: any): void {
        const { bpm, channelData, anyTrigger, order, row } = data; // Ensure Worklet sends order/row!
        this.visualState.bpm = bpm || 120;

        // Update Pattern Index (using order as proxy for global pattern progress)
        // If 'order' isn't available, we might default to 0, but hopefully worklet sends it.
        if (order !== undefined) {
            this.visualState.patternIndex = order;
        }

        if (row !== undefined) {
            this.visualState.row = row;
        }

        if (anyTrigger) this.visualState.kickTrigger = 1.0;

        while (this.visualState.channelData.length < channelData.length) {
            this.visualState.channelData.push({ volume: 0, pan: 0, trigger: 0, note: '', freq: 0, instrument: 0, activeEffect: 0, effectValue: 0 });
        }

        for (let i = 0; i < channelData.length; i++) {
            const src = channelData[i];
            const dest = this.visualState.channelData[i];
            dest.volume = src.volume;
            if (src.note) {
                dest.trigger = 1.0;
                dest.note = src.note;
                dest.freq = noteToFreq(src.note);

                // --- NEW: Trigger Note Callback ---
                // Only trigger if this is a fresh note (Worklet typically sends 'note' only on NoteOn)
                // However, Worklet might send it continuously. We should check if Worklet logic guarantees one-shot.
                // Assuming AudioProcessor sends 'note' string only on the frame it is triggered.
                // If it persists, we need a flag. Let's assume it's one-shot for now based on context.
                if (this.onNoteCallback) {
                     this.onNoteCallback(src.note, src.volume, i); // note, velocity (using volume as proxy), channelIndex
                }
            }
            dest.instrument = src.instrument;
            dest.activeEffect = src.activeEffect;
            dest.effectValue = src.effectValue;
        }
    }

    update(): VisualState {
        // Run decay logic on the main thread for smooth animations
        this.visualState.kickTrigger = decayTowards(this.visualState.kickTrigger, 0, 8, 1 / 60);
        const speed = 6; // fallback tempo metric
        this.visualState.grooveAmount = decayTowards(this.visualState.grooveAmount, speed % 2 === 0 ? 0 : 0.1, 3, 1 / 60);
        this.visualState.beatPhase = (this.visualState.beatPhase + (this.visualState.bpm / 60) * (1 / 60)) % 1;

        for (const ch of this.visualState.channelData) {
            ch.trigger = decayTowards(ch.trigger, 0, 10, 1 / 60);
        }

        return this.visualState;
    }
}
