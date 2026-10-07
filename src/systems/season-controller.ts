/**
 * Season controller: the only writer of season uniforms (docs/SEASONS.md).
 *
 * Runs once per frame from the visuals phase, before weather reads the state.
 * Other systems pull from it (`getSeasonState()`); it imports none of them.
 *
 * Debug and capture:
 *   ?season=spring|summer|autumn|winter   pin a season at its midpoint (never saved)
 *   ?seasonSpeed=N                        run the calendar N× fast from page load
 *   window.setSeason(name | null)         pin / unpin at runtime (dev, CI, ?debug=1)
 */
import { CONFIG, areDebugHooksEnabled, getUrlFlag } from '../core/config.ts';
import { writeSeasonUniforms } from '../foliage/material-core/season-nodes.ts';
import { announce } from '../ui/announcer.ts';
import { getWorldSeed, getWorldSeedVersion } from '../world/world-seed.ts';
import {
    SEASON_NAMES,
    SEASON_ROLE_STRIDE,
    SEASON_ROLES,
    blendSeasonPalette,
    computeSeasonState,
    createSeasonState,
    parseSeasonName,
    prepareSeasonPalette,
    srgbHexToLinear,
    virtualSeasonClock,
    type SeasonName,
    type SeasonState,
} from './season-core.ts';

const SEASON_ARRIVALS: readonly string[] = [
    'Spring has come to Candy World.',
    'Summer has come to Candy World.',
    'Autumn has come to Candy World.',
    'Winter has come to Candy World.',
];

const _state = createSeasonState();
const _roleParams = new Float32Array(SEASON_ROLES.length * SEASON_ROLE_STRIDE);
const _frostRgb = new Float32Array(3);
const _prepared = prepareSeasonPalette(CONFIG.season.palette);

let _initialized = false;
let _seed = 0;
let _seedVersion = -1;
let _pinned = -1;
let _speed = 1;
let _loadMs = 0;
let _lastAnnounced = -1;

type SeasonWindow = Window & { setSeason?: (name: string | null) => void };

function refresh(nowMs: number): void {
    const version = getWorldSeedVersion();
    if (version !== _seedVersion) {
        _seedVersion = version;
        _seed = getWorldSeed();
    }
    computeSeasonState(
        virtualSeasonClock(nowMs, _loadMs, _speed),
        _seed,
        CONFIG.season,
        _pinned,
        _state
    );
    blendSeasonPalette(_state, _prepared, _roleParams);
    writeSeasonUniforms(_roleParams, _frostRgb);
}

export const seasonController = {
    /** Read URL overrides, publish the first frame's uniforms, install debug hooks. */
    init(nowMs: number = Date.now()): void {
        if (_initialized) return;
        _initialized = true;
        _loadMs = nowMs;
        _pinned = parseSeasonName(getUrlFlag('season'));
        const speed = Number(getUrlFlag('seasonSpeed'));
        _speed = Number.isFinite(speed) && speed > 0 ? speed : 1;
        srgbHexToLinear(CONFIG.season.frostColor, _frostRgb, 0);
        refresh(nowMs);
        // The season a session boots into is not news.
        _lastAnnounced = _state.current;

        if (typeof window !== 'undefined' && areDebugHooksEnabled()) {
            (window as SeasonWindow).setSeason = (name) => seasonController.setOverride(name);
        }
    },

    update(nowMs: number): void {
        if (!_initialized) seasonController.init(nowMs);
        refresh(nowMs);
        if (_state.current !== _lastAnnounced) {
            _lastAnnounced = _state.current;
            announce(SEASON_ARRIVALS[_state.current], 'polite');
        }
    },

    /** Pin a season by name, or pass null to return to the calendar. Never saved. */
    setOverride(name: string | null): void {
        _pinned = parseSeasonName(name);
        refresh(Date.now());
        _lastAnnounced = _state.current;
    },

    getName(): SeasonName {
        return SEASON_NAMES[_state.current];
    },
};

/** Live season state. Read-only for callers; the same object every frame. */
export function getSeasonState(): Readonly<SeasonState> {
    return _state;
}
