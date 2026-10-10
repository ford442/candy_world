
import { AudioSystem } from '../audio/audio-system-playback.ts';
import { nightGateFromBias } from './atmosphere-reactivity-core.ts';
import { getBiomeUniforms, LuminousPlantUniforms } from './biome-uniforms.ts';
import { kickDrumGeyserBatcher } from '../foliage/kick-drum-geyser-batcher.ts';
import { getWeatherSystem } from './weather/lazy.ts';
import { FaunaSystem } from './fauna/fauna-system.ts';

export interface ScoreCue {
    id: string;
    biome: string;
    channel: number;
    instrument?: number;
    note?: string;
    rowMod?: number;
    event: string;
}

// Readonly struct arrays to avoid allocations on iteration
let cueChannels: number[] = [];
let cueBiomes: string[] = [];
let cueInstruments: number[] = [];
let cueNotes: string[] = [];
let cueRowMods: number[] = [];
let cueEvents: string[] = [];
let cueIds: string[] = [];

let _cuesLoaded = false;
let initialized = false;

// Debug tracking
const debugCues: string[] = [];
let debugCurrentOrder = 0;
let debugCurrentRow = 0;

export async function initLivingScore(): Promise<void> {
    try {
        const res = await fetch('/assets/score-cues.json');
        if (!res.ok) return;
        const data = await res.json();
        if (data && Array.isArray(data.cues)) {
            const cues = data.cues as ScoreCue[];
            for (const cue of cues) {
                cueIds.push(cue.id);
                cueBiomes.push(cue.biome);
                cueChannels.push(cue.channel);
                cueInstruments.push(cue.instrument !== undefined ? cue.instrument : -1);
                cueNotes.push(cue.note || '');
                cueRowMods.push(cue.rowMod || 0);
                cueEvents.push(cue.event);
            }
            _cuesLoaded = true;
        }
    } catch (e) {
        console.warn('Living Score: failed to load score-cues.json', e);
    }
}

// We process the edge queue built by onRowEdge listener
interface EdgeEvent {
    order: number;
    row: number;
    channels: any[];
}

let pendingEdge: EdgeEvent | null = null;

export function attachLivingScoreAudioListener(audioSystem: AudioSystem): void {
    if (initialized) return;
    audioSystem.onRowEdge = (order, row, channelData) => {
        pendingEdge = { order, row, channels: channelData };
        debugCurrentOrder = order;
        debugCurrentRow = row;
    };
    initialized = true;
}

let sugarCavesShimmerEnvelope = 0;

export function updateLivingScore(audioSystem: AudioSystem, dayNightBias: number, dt: number): void {
    if (!_cuesLoaded) return;
    if (!initialized) attachLivingScoreAudioListener(audioSystem);

    // Apply envelope decays for luminous plants and cave shimmer
    if (LuminousPlantUniforms.intensity) {
        LuminousPlantUniforms.intensity.value = Math.max(0.1, LuminousPlantUniforms.intensity.value - dt * 1.5);
    }

    // We maintain our own envelope for sugar cave shimmer since bindings overwrite it
    sugarCavesShimmerEnvelope = Math.max(0, sugarCavesShimmerEnvelope - dt * 2.0);
    if (sugarCavesShimmerEnvelope > 0) {
        getBiomeUniforms('sugar_caves').shimmer.value = Math.max(
            getBiomeUniforms('sugar_caves').shimmer.value,
            sugarCavesShimmerEnvelope
        );
    }

    if (!pendingEdge) return;
    const { row, channels } = pendingEdge;
    pendingEdge = null; // Consume

    const nightGate = nightGateFromBias(dayNightBias);
    const marketGate = 1.0 - dayNightBias;

    for (let i = 0; i < cueChannels.length; i++) {
        const channel = cueChannels[i];
        const src = channels[channel];
        if (!src) continue;

        const inst = src.instrument;
        const noteStr = src.note || '';

        let match = true;

        if (cueInstruments[i] !== -1 && inst !== cueInstruments[i]) {
            match = false;
        }
        if (match && cueNotes[i] !== '' && noteStr !== cueNotes[i]) {
            match = false;
        }
        if (match && cueRowMods[i] > 0 && (row % cueRowMods[i]) !== 0) {
            match = false;
        }

        if (match && (inst > 0 || noteStr !== '')) {
            fireScoreEvent(i, nightGate, marketGate);
            recordDebugCue(cueIds[i]);
        }
    }

    if (hasUrlFlag('debugScore')) {
        updateScoreDebugUI();
    }
}

function fireScoreEvent(cueIndex: number, nightGate: number, marketGate: number) {
    const event = cueEvents[cueIndex];

    switch (event) {
        case 'lanternPhrase':
            getBiomeUniforms('night_market').shimmer.value = Math.max(
                getBiomeUniforms('night_market').shimmer.value,
                1.0 * marketGate
            );
            break;

        case 'geyserBurst':
            if (kickDrumGeyserBatcher && typeof kickDrumGeyserBatcher.triggerErupt === 'function') {
                kickDrumGeyserBatcher.triggerErupt();
            }
            break;

        case 'cavePulse':
            sugarCavesShimmerEnvelope = 1.0 * nightGate;
            break;

        case 'faunaImpulse':
            const fsInst = FaunaSystem.getInstance();
            if (typeof (fsInst as any).applyScoreImpulse === 'function') {
                (fsInst as any).applyScoreImpulse(5.0);
            }
            break;

        case 'weatherBump':
            const ws = getWeatherSystem();
            if (ws) {
                ws.intensity = Math.min(1.0, ws.intensity + 0.1);
            }
            break;
    }
}

function recordDebugCue(id: string) {
    debugCues.unshift(id);
    if (debugCues.length > 8) {
        debugCues.pop();
    }
}

import { hasUrlFlag } from '../core/config/url-flags.ts';

export function getLivingScoreDebugState() {
    return {
        order: debugCurrentOrder,
        row: debugCurrentRow,
        lastFiredCues: debugCues
    };
}

// Minimal overlay for ?debugScore=1
let scoreDebugOverlay: HTMLElement | null = null;

function updateScoreDebugUI() {
    if (!scoreDebugOverlay) {
        if (!hasUrlFlag('debugScore')) return;
        scoreDebugOverlay = document.createElement('div');
        Object.assign(scoreDebugOverlay.style, {
            position: 'fixed', bottom: '10px', right: '10px',
            background: 'rgba(0,0,0,0.8)', color: '#0f0',
            padding: '10px', fontFamily: 'monospace', fontSize: '12px',
            zIndex: '9999', pointerEvents: 'none'
        });
        document.body.appendChild(scoreDebugOverlay);
    }

    const state = getLivingScoreDebugState();
    scoreDebugOverlay.innerHTML = `
        <strong>Living Score</strong><br>
        Order: ${state.order}<br>
        Row: ${state.row}<br>
        Cues:<br>
        ${state.lastFiredCues.map(c => `- ${c}`).join('<br>')}
    `;
}
