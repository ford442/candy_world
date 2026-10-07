/**
 * Named time-of-day jumps used by visual regression and the circadian debugger.
 *
 * Lives outside `debug/` because the capture tool depends on it: the debug
 * module only loads with `?debugCircadian=1`, which the tool never passes, so
 * every viewpoint's `timeOfDay` used to be silently ignored.
 *
 * Takes the time-offset ref and game-time getter as arguments rather than
 * importing game-loop-core, so it adds no import cycle.
 */

import { circadianController } from '../systems/circadian-controller.ts';
import { areDebugHooksEnabled } from './config.ts';
import { getCyclePos, isNightCyclePos } from './cycle.ts';

/** Cycle positions (s): dawn and sunset sit on the horizon crossings, day at noon. */
export const TIME_OF_DAY_PRESETS = {
    dawn: 30,
    day: 270,
    sunset: 510,
    night: 780,
} as const;

export type TimeOfDayPreset = keyof typeof TIME_OF_DAY_PRESETS;

function presetPos(tod: string): number {
    return Object.prototype.hasOwnProperty.call(TIME_OF_DAY_PRESETS, tod)
        ? TIME_OF_DAY_PRESETS[tod as TimeOfDayPreset]
        : TIME_OF_DAY_PRESETS.day;
}

/**
 * Move world time to a preset by rewriting the time offset, then snap the
 * circadian controller so a capture doesn't wait out its 3 s ease.
 * Unknown names fall back to `day`. Returns the resulting cycle position.
 */
export function applyTimeOfDayPreset(
    tod: string,
    timeOffset: { value: number },
    gameTime: number
): number {
    const target = presetPos(tod);
    timeOffset.value = target - getCyclePos(gameTime);
    circadianController.setDayTarget(!isNightCyclePos(target));
    for (let i = 0; i < 12; i++) circadianController.update(1.0);
    return target;
}

type TimeOfDayWindow = Window & {
    setTimeOfDay?: (tod: string) => void;
    setCircadianTimeOfDay?: (tod: string) => void;
};

/** Install `window.setTimeOfDay` / `window.setCircadianTimeOfDay` when debug hooks are allowed. */
export function installTimeOfDayHooks(
    timeOffset: { value: number },
    getGameTime: () => number
): void {
    if (typeof window === 'undefined' || !areDebugHooksEnabled()) return;
    const setTimeOfDay = (tod: string): void => {
        applyTimeOfDayPreset(tod, timeOffset, getGameTime());
    };
    const w = window as TimeOfDayWindow;
    w.setTimeOfDay = setTimeOfDay;
    w.setCircadianTimeOfDay = setTimeOfDay;
}
