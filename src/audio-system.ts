// Ported and converted from audio-system.js
const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4096;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const decayTowards = (value: number, target: number, rate: number, dt: number) => lerp(value, target, 1 - Math.exp(-rate * dt));
interface ChannelState { note?: string; trigger?: number; volume?: number; freq?: number; pan?: number; activeEffect?: number; }
const extractNote = (cell?: { text?: string }) => cell?.text?.match(/[A-G][#-]?\d/)?.[0];
const noteToFreq = (note: string | undefined) => {
  if (!note) return 0;
  const n = note.toUpperCase();
  const map: Record<string, number> = { C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11 };
  const match = n.match(/^([A-G](?:#|B)?)\-?(\d)$/);
  if (!match) return 0;
  const semitone = map[match[1]] ?? 0;
  const midi = (parseInt(match[2], 10) + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
};
function decodeEffectCode(cell?: { text?: string }) { if (!cell?.text) return { activeEffect: 0, intensity: 0 }; const text = cell.text.trim().toUpperCase(); const match = text.match(/([0-9A-F])([0-9A-F]{2})/); if (!match) return { activeEffect: 0, intensity: 0 }; const code = match[1]; const value = parseInt(match[2], 16) / 255; switch (code) { case '4': return { activeEffect: 1, intensity: value }; case '3': return { activeEffect: 2, intensity: value }; case '7': return { activeEffect: 3, intensity: value }; case '0': if (match[2] !== '00') return { activeEffect: 4, intensity: value }; break; case 'R': return { activeEffect: 5, intensity: value }; default: break; } return { activeEffect: 0, intensity: value }; }
export class AudioSystem {
  libopenmpt: any = null;
  currentModulePtr = 0;
  audioContext: AudioContext | null = null;
  scriptNode: ScriptProcessorNode | null = null;
  stereoPanner: StereoPannerNode | null = null;
  gainNode: GainNode | null = null;
  moduleInfo = { title: '...', order: 0, row: 0, bpm: 0, numChannels: 0 };
  patternMatrices: Record<number, any> = {};
  channelStates: ChannelState[] = [];
  isPlaying = false;
  isReady = false;
  volume = 1.0;
  visualState: { beatPhase: number; kickTrigger: number; grooveAmount: number; activeChannels: number; channelData: ChannelState[] } = { beatPhase: 0, kickTrigger: 0, grooveAmount: 0, activeChannels: 0, channelData: [] };
  
  constructor() {
    // No-op
  }

  async init() {
    if (!window.libopenmptReady) { console.error('libopenmptReady promise not found.'); return; }
    try { 
      const lib = await (window as any).libopenmptReady; 
      if (lib && typeof lib.stringToUTF8 === 'function') {
        this.libopenmpt = lib; 
        this.isReady = true; 
        console.log('AudioSystem initialized.'); 
      } else {
        console.error('libopenmpt library is not valid or complete.');
      }
    } catch (err) { console.error('AudioSystem init failed:', err); }
  }
  async loadModule(file: File) { if (!this.isReady) return; const arrayBuffer = await file.arrayBuffer(); const fileData = new Uint8Array(arrayBuffer); this.processModuleData(fileData, file.name); }
  processModuleData(fileData: Uint8Array, fileName: string) { if (!this.libopenmpt || !this.isReady) return; this.stop(false); if (this.currentModulePtr !== 0) { this.libopenmpt._openmpt_module_destroy(this.currentModulePtr); this.currentModulePtr = 0; } try { const lib = this.libopenmpt; const bufferPtr = lib._malloc(fileData.length); lib.HEAPU8.set(fileData, bufferPtr); const modPtr = lib._openmpt_module_create_from_memory2(bufferPtr, fileData.length, 0, 0, 0, 0, 0, 0, 0); lib._free(bufferPtr); if (modPtr === 0) throw new Error(`Failed to load module "${fileName}".`); this.currentModulePtr = modPtr; const titleKeyPtr = lib.stringToUTF8('title'); const titleValuePtr = lib._openmpt_module_get_metadata(modPtr, titleKeyPtr); const title = lib.UTF8ToString(titleValuePtr) || fileName; lib._free(titleKeyPtr); lib._openmpt_free_string(titleValuePtr); this.moduleInfo.title = title; this.preCachePatternData(modPtr); this.play(); } catch (e) { console.error('Failed to load module:', e); } }
  preCachePatternData(modPtr: number) { const lib = this.libopenmpt; this.patternMatrices = {}; try { const numOrders = lib._openmpt_module_get_num_orders(modPtr); const numChannels = lib._openmpt_module_get_num_channels(modPtr); this.moduleInfo.numChannels = numChannels; for (let o = 0; o < numOrders; o++) { const pattern = lib._openmpt_module_get_order_pattern(modPtr, o); if (pattern >= lib._openmpt_module_get_num_patterns(modPtr)) continue; const numRows = lib._openmpt_module_get_pattern_num_rows(modPtr, pattern); const matrixRows: any[] = []; for (let r = 0; r < numRows; r++) { const rowCells: any[] = []; for (let c = 0; c < numChannels; c++) { const commandPtr = lib._openmpt_module_format_pattern_row_channel(modPtr, pattern, r, c, 0, 1); const commandStr = lib.UTF8ToString(commandPtr); lib._openmpt_free_string(commandPtr); const raw = (commandStr || '').trim(); rowCells.push({ text: raw }); } matrixRows.push(rowCells); } this.patternMatrices[o] = { rows: matrixRows, numRows, numChannels }; } } catch (e) { console.error('Pattern caching error:', e); } }
  play() { if (this.currentModulePtr === 0 || !this.libopenmpt) return; if (!this.audioContext) { const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext; this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE }); } if (this.audioContext.state === 'suspended') this.audioContext.resume(); if (this.isPlaying) return; try { this.gainNode = this.audioContext.createGain(); this.gainNode.gain.value = this.volume; this.gainNode.connect(this.audioContext.destination); const lib = this.libopenmpt; const modPtr = this.currentModulePtr; const leftBufferPtr = lib._malloc(BUFFER_SIZE * 4); const rightBufferPtr = lib._malloc(BUFFER_SIZE * 4); this.scriptNode = this.audioContext.createScriptProcessor(BUFFER_SIZE, 0, 2); this.scriptNode.onaudioprocess = (e: AudioProcessingEvent) => { if (!this.isPlaying) return; const frames = lib._openmpt_module_read_float_stereo(modPtr, SAMPLE_RATE, BUFFER_SIZE, leftBufferPtr, rightBufferPtr); if (frames === 0) { lib._openmpt_module_set_position_order_row(modPtr, 0, 0); return; } const leftOutput = e.outputBuffer.getChannelData(0); const rightOutput = e.outputBuffer.getChannelData(1); leftOutput.set(new Float32Array(lib.HEAPF32.buffer, leftBufferPtr, frames)); rightOutput.set(new Float32Array(lib.HEAPF32.buffer, rightBufferPtr, frames)); }; this.stereoPanner = this.audioContext.createStereoPanner(); this.scriptNode.connect(this.stereoPanner); this.stereoPanner.connect(this.gainNode); this.isPlaying = true; console.log('Playback started.'); } catch (e) { console.error('Playback failed:', e); } }
  stop(fullReset = true) { if (this.scriptNode) { this.scriptNode.disconnect(); this.scriptNode = null; } if (this.stereoPanner) { this.stereoPanner.disconnect(); this.stereoPanner = null; } this.isPlaying = false; if (fullReset && this.currentModulePtr && this.libopenmpt) { this.libopenmpt._openmpt_module_set_position_order_row(this.currentModulePtr, 0, 0); } }
  update() { if (!this.libopenmpt || this.currentModulePtr === 0 || !this.isPlaying) { this.visualState.kickTrigger = decayTowards(this.visualState.kickTrigger, 0, 8, 1/60); return this.visualState; } const lib = this.libopenmpt; const modPtr = this.currentModulePtr; const order = lib._openmpt_module_get_current_order(modPtr); const row = lib._openmpt_module_get_current_row(modPtr); const bpm = lib._openmpt_module_get_current_estimated_bpm(modPtr); const tempo2 = lib._openmpt_module_get_current_tempo2?.(modPtr) ?? bpm; const speed = lib._openmpt_module_get_current_speed?.(modPtr) ?? 6; this.visualState.beatPhase = (this.visualState.beatPhase + (tempo2 / 60) * (1 / 60)) % 1; this.visualState.grooveAmount = decayTowards(this.visualState.grooveAmount, speed % 2 === 0 ? 0 : 0.1, 3, 1/60); const matrix = this.patternMatrices[order]; const rowData = matrix?.rows[row] || []; const numChannels = matrix?.numChannels || this.moduleInfo.numChannels; while (this.visualState.channelData.length < numChannels) { this.visualState.channelData.push({ volume: 0, trigger: 0, note: '', freq: 0 }); } let anyTrigger = false; for (let ch = 0; ch < numChannels; ch++) { const vu = lib._openmpt_module_get_current_channel_vu_mono?.(modPtr, ch) ?? 0; const volume = Math.min(1, vu); const cell = rowData[ch]; const noteMatch = extractNote(cell); const trigger = noteMatch ? 1 : 0; const freq = noteToFreq(noteMatch); if (trigger) anyTrigger = true; const chState = this.visualState.channelData[ch]; chState.volume = volume; chState.trigger = trigger ? 1 : decayTowards(chState.trigger, 0, 10, 1/60); chState.note = noteMatch || chState.note; chState.freq = freq || chState.freq; } if (anyTrigger) { this.visualState.kickTrigger = 1; } else { this.visualState.kickTrigger = decayTowards(this.visualState.kickTrigger, 0, 8, 1/60); } return this.visualState; }
}
