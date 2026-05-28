export const SAMPLE_RATE = 44100;
export const SCRIPT_PROCESSOR_VISUAL_UPDATE_FREQUENCY = 10; // Process visuals every Nth callback to reduce overhead

// Helper functions
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const decayTowards = (value: number, target: number, rate: number, dt: number): number => lerp(value, target, 1 - Math.exp(-rate * dt));

export const noteToFreq = (note: string | null): number => {
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
export const extractNote = (cell: PatternRowCell | null): string | undefined => cell?.text?.match(/[A-G][#-]?\d/)?.[0];

export const extractInstrument = (cell: PatternRowCell | null): number => {
    if (!cell || !cell.text) return 0;
    const match = cell.text.match(/[A-G\.-][#\.-][\d\.-]\s+(\d+|[0-9A-F]{2})/i);
    if (match) return parseInt(match[1], 10) || parseInt(match[1], 16) || 0;
    return 0;
};

export const decodeEffectCode = (cell: PatternRowCell | null): { activeEffect: number, intensity: number } => {
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

export interface ModuleInfo {
    title: string;
    order: number;
    row: number;
    bpm: number;
    numChannels: number;
}

export interface PatternRowCell {
    text: string;
}

export interface PatternMatrix {
    rows: PatternRowCell[][];
    numRows: number;
    numChannels: number;
}

export interface LibOpenMPT {
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

export abstract class AudioSystemCore {
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
    protected scriptProcessorCallbackCount: number;

    // Stop guard flag to prevent concurrent calls
    protected isStopping: boolean;

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

    protected async initWorkletMode(): Promise<void> {
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

        // Handle worklet errors
        this.workletNode.onprocessorerror = (e) => {
            console.error('[AudioSystem] AudioWorklet processor error:', e);
            this.isReady = false;
        };

        // Wire up messages from the audio thread
        this.workletNode.port.onmessage = (event) => {
            const { type, data, error } = event.data || {};
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
            } else if (type === 'ERROR') {
                console.error("AudioSystem: Worklet Error:", error);
                // Fall back to ScriptProcessorNode mode if Worklet fails
                console.warn("AudioSystem: Falling back to ScriptProcessorNode mode due to Worklet error.");
                this.useScriptProcessorNode = true;
                this.cleanupWorklet();
                this.initScriptProcessorMode().catch(e => {
                    console.error("AudioSystem: ScriptProcessor fallback also failed:", e);
                });
            }
        };
    }

    protected async initScriptProcessorMode(): Promise<void> {
        console.log('[AudioSystem] Using ScriptProcessorNode (compatibility mode)');
        if (window.setLoadingStatus) window.setLoadingStatus("Audio ScriptProcessor Ready...");

        // Wait for libopenmpt to be ready — 5 s timeout for Silent Mode fallback
        if (!window.libopenmpt) {
            console.log('[AudioSystem] Waiting for libopenmpt...');
            try {
                await Promise.race([
                    window.libopenmptReady,
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error('libopenmpt init timeout')), 5000)
                    ),
                ]);
            } catch (err) {
                console.warn('[AudioSystem] WASM failed, starting in Silent Mode:', err);
                window.libopenmpt = null;
                this.isReady = true;
                return;
            }
        }

        if (!window.libopenmpt) {
            console.warn('[AudioSystem] libopenmpt unavailable, starting in Silent Mode.');
            this.isReady = true;
            return;
        }

        this.libopenmpt = window.libopenmpt;

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

    protected cleanupWorklet(): void {
        try {
            if (this.workletNode) {
                this.workletNode.port.postMessage({ type: 'STOP' });
                this.workletNode.disconnect();
                this.workletNode = null;
            }
        } catch (e) {
            console.warn('[AudioSystem] Error cleaning up worklet:', e);
        }
        this.workletNode = null;
    }

    // Abstract methods to be implemented by child class
    abstract handleVisualUpdate(data: any): void;
    abstract playNext(forceIndex?: number | null): Promise<void>;
    abstract processAudioScriptProcessor(event: AudioProcessingEvent): void;
}
