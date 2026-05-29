import { AudioSystemCore, noteToFreq, extractNote, extractInstrument, decodeEffectCode, VisualState, SCRIPT_PROCESSOR_VISUAL_UPDATE_FREQUENCY, decayTowards, SAMPLE_RATE, PatternRowCell } from './audio-system-core.ts';

export class AudioSystem extends AudioSystemCore {
    private _scratchChannelData?: any[];

    constructor(useScriptProcessorNode: boolean = false) {
        super(useScriptProcessorNode);
    }

    // --- API to register note listener ---
    onNote(callback: (note: string, volume: number, channelIndex: number) => void): void {
        this.onNoteCallback = callback;
    }

    // Backward compatibility alias if needed
    setNoteCallback(callback: (note: string, volume: number, channelIndex: number) => void): void {
        this.onNoteCallback = callback;
    }

    /**
     * Synthesize procedural sound effects matching the Candy World aesthetic
     */
    playSound(name: string, options: { volume?: number, pitch?: number, position?: any } = {}): void {
        if (!this.audioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
        }

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        const t = this.audioContext.currentTime;
        const volume = (options.volume !== undefined ? options.volume : 1.0) * this.volume;
        if (volume <= 0 || this.isMuted) return;

        const pitchMultiplier = options.pitch !== undefined ? options.pitch : 1.0;

        const osc = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        osc.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        // Apply volume with a fast attack to avoid clicks
        gainNode.gain.setValueAtTime(0, t);
        gainNode.gain.linearRampToValueAtTime(volume * 0.5, t + 0.01);

        let duration = 0.1;

        switch (name) {
            case 'jump':
                osc.type = 'sine';
                duration = 0.15;
                osc.frequency.setValueAtTime(400 * pitchMultiplier, t);
                osc.frequency.exponentialRampToValueAtTime(600 * pitchMultiplier, t + duration);
                gainNode.gain.exponentialRampToValueAtTime(0.01, t + duration);
                break;
            case 'impact':
            case 'land':
                osc.type = 'square';
                duration = 0.2;
                osc.frequency.setValueAtTime(150 * pitchMultiplier, t);
                osc.frequency.exponentialRampToValueAtTime(50 * pitchMultiplier, t + duration);
                gainNode.gain.exponentialRampToValueAtTime(0.01, t + duration);
                break;
            case 'pickup':
            case 'chime':
                osc.type = 'triangle';
                duration = 0.3;
                osc.frequency.setValueAtTime(600 * pitchMultiplier, t);
                osc.frequency.setValueAtTime(800 * pitchMultiplier, t + 0.1);
                osc.frequency.setValueAtTime(1200 * pitchMultiplier, t + 0.2);
                gainNode.gain.exponentialRampToValueAtTime(0.01, t + duration);
                break;
            case 'explosion':
                osc.type = 'sawtooth';
                duration = 0.5;
                osc.frequency.setValueAtTime(100 * pitchMultiplier, t);
                osc.frequency.exponentialRampToValueAtTime(40 * pitchMultiplier, t + duration);
                gainNode.gain.exponentialRampToValueAtTime(0.01, t + duration);
                break;
            case 'dash':
                osc.type = 'sine';
                duration = 0.15;
                osc.frequency.setValueAtTime(800 * pitchMultiplier, t);
                osc.frequency.exponentialRampToValueAtTime(200 * pitchMultiplier, t + duration);
                gainNode.gain.exponentialRampToValueAtTime(0.01, t + duration);
                break;
            case 'click':
            case 'creak':
            case 'snare':
            case 'place':
                osc.type = 'square';
                duration = 0.05;
                osc.frequency.setValueAtTime(800 * pitchMultiplier, t);
                osc.frequency.exponentialRampToValueAtTime(100 * pitchMultiplier, t + duration);
                gainNode.gain.exponentialRampToValueAtTime(0.01, t + duration);
                break;
            default:
                osc.type = 'sine';
                duration = 0.1;
                osc.frequency.setValueAtTime(440 * pitchMultiplier, t);
                gainNode.gain.exponentialRampToValueAtTime(0.01, t + duration);
                break;
        }

        osc.start(t);
        osc.stop(t + duration);
    }

    processAudioScriptProcessor(event: AudioProcessingEvent): void {
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

        let anyTrigger = false;

        // ⚡ OPTIMIZATION: Reuse a scratch array of pooled objects to avoid GC allocation
        if (!this._scratchChannelData) {
            this._scratchChannelData = [];
        }

        while (this._scratchChannelData.length < numChannels) {
            this._scratchChannelData.push({
                volume: 0,
                note: '',
                instrument: 0,
                activeEffect: 0,
                effectValue: 0
            });
        }

        for (let ch = 0; ch < numChannels; ch++) {
            const vu = lib._openmpt_module_get_current_channel_vu_mono(modPtr, ch);
            const cell = rowData[ch];
            const noteMatch = extractNote(cell as PatternRowCell | null);
            const instrument = extractInstrument(cell as PatternRowCell | null);
            const { activeEffect, intensity } = decodeEffectCode(cell as PatternRowCell | null);

            if (noteMatch) anyTrigger = true;

            const dest = this._scratchChannelData[ch];
            dest.volume = vu;
            dest.note = noteMatch || '';
            dest.instrument = instrument;
            dest.activeEffect = activeEffect;
            dest.effectValue = intensity;
        }

        const scratchData = this._scratchChannelData.length === numChannels ? this._scratchChannelData : this._scratchChannelData.slice(0, numChannels);
        this.handleVisualUpdate({ bpm, channelData: scratchData, anyTrigger, order, row });
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

    removeTrack(index: number): void {
        if (index < 0 || index >= this.playlist.length) return;

        console.log(`[AudioSystem] Removing track ${index}: ${this.playlist[index].name}`);

        const isCurrent = (index === this.currentIndex);

        if (isCurrent) {
            this.stop(false); // Clean stop
        }

        // Remove from array
        this.playlist.splice(index, 1);

        // Adjust index
        if (this.playlist.length === 0) {
            this.currentIndex = -1;
        } else {
            if (isCurrent) {
                // Determine new index (wrap if needed, though behavior is usually "play next")
                let newIndex = index;
                if (newIndex >= this.playlist.length) {
                    newIndex = 0; // Loop to start
                }
                // Play the track at the new/same index
                this.playNext(newIndex);
            } else if (index < this.currentIndex) {
                // Removed a track before current, shift index down
                this.currentIndex--;
            }
            // If removed after, current index stays same
        }

        if (this.onPlaylistUpdate) {
            this.onPlaylistUpdate(this.playlist);
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
