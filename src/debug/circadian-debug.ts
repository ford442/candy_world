/**
 * @file src/debug/circadian-debug.ts
 * @brief Optional circadian day/night plant-pose debugger.
 *
 * Enabled via URL flag:
 *   ?debugCircadian=1  — HUD overlay + screen tint by circadian phase
 *
 * Mirrors the ground-debug pattern: zero cost unless the flag is present.
 * Lists batcher coverage (PlantPoseMachine vs TSL uCircadian / uTwilight)
 * and live uniform values so Palette can spot species that stay "always awake".
 */

import { circadianController } from '../systems/circadian-controller.ts';
import { uCircadianPhase, uCircadianPoseOffset } from '../systems/biome-uniforms.ts';
import { uTwilight } from '../foliage/sky.ts';
import { getDayNightBias } from '../core/cycle.ts';
import { CYCLE_DURATION } from '../core/config.ts';

const _hasFlag = (key: string): boolean => {
    try {
        return new URLSearchParams(window.location.search).get(key) === '1';
    } catch {
        return false;
    }
};

const DEBUG_CIRCADIAN = _hasFlag('debugCircadian');

/** Coverage matrix — keep in sync when wiring new batchers. */
export const CIRCADIAN_COVERAGE: ReadonlyArray<{
    batcher: string;
    pose: 'PlantPoseMachine' | 'uCircadianPoseOffset' | 'uCircadianPhase droop' | 'none';
    glow: 'dayGlow' | 'nightGlow' | 'uTwilight only' | 'none';
    rhythm: 'diurnal' | 'nocturnal' | 'event';
}> = [
    { batcher: 'simple-flower', pose: 'PlantPoseMachine', glow: 'dayGlow', rhythm: 'diurnal' },
    { batcher: 'flower', pose: 'PlantPoseMachine', glow: 'uTwilight only', rhythm: 'diurnal' },
    { batcher: 'arpeggio', pose: 'PlantPoseMachine', glow: 'none', rhythm: 'diurnal' },
    { batcher: 'portamento', pose: 'PlantPoseMachine', glow: 'dayGlow', rhythm: 'diurnal' },
    { batcher: 'tree', pose: 'uCircadianPoseOffset', glow: 'dayGlow', rhythm: 'diurnal' },
    { batcher: 'mushroom', pose: 'uCircadianPoseOffset', glow: 'nightGlow', rhythm: 'nocturnal' },
    { batcher: 'glass-mushroom', pose: 'uCircadianPoseOffset', glow: 'nightGlow', rhythm: 'nocturnal' },
    { batcher: 'luminous-plant', pose: 'uCircadianPoseOffset', glow: 'nightGlow', rhythm: 'nocturnal' },
    { batcher: 'gem-fruit', pose: 'uCircadianPoseOffset', glow: 'nightGlow', rhythm: 'nocturnal' },
    { batcher: 'wisteria', pose: 'uCircadianPhase droop', glow: 'nightGlow', rhythm: 'nocturnal' },
    { batcher: 'subwoofer-lotus', pose: 'uCircadianPoseOffset', glow: 'dayGlow', rhythm: 'event' },
    { batcher: 'kick-drum-geyser', pose: 'uCircadianPoseOffset', glow: 'none', rhythm: 'event' },
    { batcher: 'lantern', pose: 'none', glow: 'nightGlow', rhythm: 'nocturnal' },
];

let _panel: HTMLElement | null = null;
let _tint: HTMLElement | null = null;
let _lastUpdateMs = 0;
let _timeOffset: { value: number } | null = null;
let _getGameTime: () => number = () => 0;

export function isCircadianDebugEnabled(): boolean {
    return DEBUG_CIRCADIAN;
}

/** Initialize HUD + tint. Call once after the scene is available. */
export function initCircadianDebug(opts?: {
    timeOffset: { value: number };
    getGameTime: () => number;
}): void {
    if (opts) {
        _timeOffset = opts.timeOffset;
        _getGameTime = opts.getGameTime;
    }

    try {
        (window as any).setTimeOfDay = setCircadianTimeOfDay;
        (window as any).setCircadianTimeOfDay = setCircadianTimeOfDay;
    } catch {
        /* non-browser */
    }

    if (!DEBUG_CIRCADIAN) return;

    _panel = document.createElement('div');
    _panel.id = 'circadian-debug-panel';
    _panel.style.cssText = [
        'position:fixed', 'right:8px', 'top:8px', 'z-index:10000',
        'font:11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
        'color:#fff', 'background:rgba(8,12,20,0.72)',
        'padding:8px 10px', 'border-radius:6px', 'pointer-events:none',
        'max-width:340px', 'max-height:70vh', 'overflow:auto',
        'backdrop-filter:blur(4px)',
    ].join(';');
    document.body.appendChild(_panel);

    _tint = document.createElement('div');
    _tint.id = 'circadian-debug-tint';
    _tint.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:9998',
        'pointer-events:none', 'mix-blend-mode:soft-light',
        'transition:background-color 0.4s linear',
    ].join(';');
    document.body.appendChild(_tint);

    (window as any).__circadianCoverage = CIRCADIAN_COVERAGE;
    (window as any).logCircadianCoverage = () => {
        console.table(CIRCADIAN_COVERAGE);
        return CIRCADIAN_COVERAGE;
    };

    console.log('[circadian-debug] Enabled — ?debugCircadian=1');
}

/**
 * Per-frame update (cheap; throttled to ~8 Hz for the HTML panel).
 * Call from the visuals tick when debug is enabled.
 */
export function updateCircadianDebug(dayNightBias: number): void {
    if (!DEBUG_CIRCADIAN || !_panel || !_tint) return;

    const phase = circadianController.getPhase();
    const poseOff = (uCircadianPoseOffset as any).value as number;
    const twilight = (uTwilight as any).value as number;
    const uniformPhase = (uCircadianPhase as any).value as number;

    // Screen tint: warm amber by day → cool indigo by night (tinting "batcher state")
    const night = 1.0 - phase;
    const r = Math.round(255 * (0.55 * phase + 0.12));
    const g = Math.round(255 * (0.42 * phase + 0.18 * night));
    const b = Math.round(255 * (0.55 * night + 0.18 * phase));
    const a = 0.18 + 0.12 * Math.abs(phase - 0.5) * 2;
    _tint.style.backgroundColor = `rgba(${r},${g},${b},${a.toFixed(3)})`;

    const now = performance.now();
    if (now - _lastUpdateMs < 120) return;
    _lastUpdateMs = now;

    const rows = CIRCADIAN_COVERAGE.map((c) => {
        const hue =
            c.rhythm === 'nocturnal' ? '#9ad7ff' :
            c.rhythm === 'diurnal' ? '#ffe29a' : '#d5c2ff';
        return `<tr style="color:${hue}"><td>${c.batcher}</td><td>${c.pose}</td><td>${c.glow}</td><td>${c.rhythm}</td></tr>`;
    }).join('');

    _panel.innerHTML = [
        `<div style="font-weight:700;margin-bottom:4px">Circadian Debug</div>`,
        `<div>phase <b>${phase.toFixed(3)}</b> (ctrl) / ${uniformPhase.toFixed(3)} (u)</div>`,
        `<div>dayNightBias <b>${dayNightBias.toFixed(3)}</b></div>`,
        `<div>uCircadianPoseOffset <b>${poseOff.toFixed(3)}</b></div>`,
        `<div>uTwilight <b>${twilight.toFixed(3)}</b></div>`,
        `<div style="margin:6px 0 2px;opacity:0.8">Coverage matrix</div>`,
        `<table style="border-collapse:collapse;width:100%;font-size:10px">`,
        `<tr style="opacity:0.7"><td>batcher</td><td>pose</td><td>glow</td><td>rhythm</td></tr>`,
        rows,
        `</table>`,
        `<div style="margin-top:6px;opacity:0.65">tint = day amber / night indigo</div>`,
    ].join('');
}

/**
 * Force cycle position for visual regression / debug.
 * `tod`: dawn | day | sunset | night
 */
export function setCircadianTimeOfDay(tod: string): void {
    if (!_timeOffset) {
        console.warn('[circadian-debug] setCircadianTimeOfDay: not initialized');
        return;
    }
    const map: Record<string, number> = {
        dawn: 30,
        day: 270,
        sunset: 510,
        night: 780,
    };
    const target = map[tod] ?? map.day;
    _timeOffset.value = target - (_getGameTime() % CYCLE_DURATION);
    circadianController.setDayTarget(tod === 'day' || tod === 'dawn');
    // Snap controller toward target so VR frames don't wait for the 3s lerp.
    for (let i = 0; i < 12; i++) circadianController.update(1.0);
}

/** Live day/night bias from current clock (debug / VR). */
export function sampleDayNightBias(): number {
    return getDayNightBias(_getGameTime() + (_timeOffset?.value ?? 0));
}
