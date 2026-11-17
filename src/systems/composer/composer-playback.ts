/**
 * @file src/systems/composer/composer-playback.ts
 * @brief Which grove pattern the soundtrack plays, and what each heard step triggers (#1976 slice C).
 *
 * The generative engine plays one authored pattern at a time (`GenerativeEngine.setAuthoredPattern`):
 * the editor's draft while it is auditioning, else the pattern of the nearest music stone within
 * earshot, else none (the generated soundtrack). Notes go through the engine's own voices, bus,
 * visuals and note callbacks, so music reactivity follows a pattern exactly as it follows the
 * generated score. This module adds only the two things a pattern has that the score does not:
 *
 * - a row's bound Living Score cue fires on the steps that row plays (`fireScoreCue`), once per
 *   step however many notes the step holds;
 * - the stone's candy key for each voice that plays bobs.
 *
 * No DOM; Three.js only as types. Tests drive it with a fake engine.
 */

import type * as THREE from 'three';
import { resolveStonePattern, type GrovePattern } from '../../world/document/grove-pattern.ts';

/** Within this distance (m) a stone takes over the soundtrack. */
export const HEAR_RADIUS = 14;
/** ...and it keeps it until the player is this far away, so the edge does not flicker. */
export const RELEASE_RADIUS = 17;
/** How far a key bobs (m) when its voice plays, and how fast it settles (per second). */
const KEY_BOB = 0.12;
const KEY_SETTLE = 6;

/** The slice of `GenerativeEngine` playback uses. */
export interface ComposerEngine {
    setAuthoredPattern(pattern: GrovePattern | null): void;
    addStepListener(
        listener: (row: number, events: ReadonlyArray<{ channel: number }>) => void
    ): () => void;
}

/** A live music stone, as the playback system sees it. */
export interface StoneView {
    id: string;
    x: number;
    y: number;
    z: number;
    pattern: GrovePattern;
    keys?: readonly THREE.Object3D[];
}

export type PlaybackSource =
    | { kind: 'none' }
    | { kind: 'audition'; stoneId: string | null }
    | { kind: 'stone'; stoneId: string };

export interface ComposerPlaybackDeps {
    /** `fireScoreCue` from `systems/living-score.ts`. */
    fireCue(id: string): boolean;
}

export class ComposerPlayback {
    private engine: ComposerEngine | null = null;
    private unlisten: (() => void) | null = null;
    private audition: GrovePattern | null = null;
    private auditionStone: string | null = null;
    private nearest: StoneView | null = null;
    private sent: GrovePattern | null = null;
    private readonly bob = new Map<THREE.Object3D, number>();
    private readonly firedScratch = new Set<string>();
    /** Cues fired, in order (diagnostics and tests). */
    readonly cueLog: string[] = [];

    constructor(private readonly deps: ComposerPlaybackDeps) {}

    /** Play through `engine` (or detach with null). */
    attach(engine: ComposerEngine | null): void {
        if (engine === this.engine) return;
        this.unlisten?.();
        this.unlisten = null;
        this.engine?.setAuthoredPattern(null);
        this.engine = engine;
        this.sent = null;
        if (engine) {
            this.unlisten = engine.addStepListener((_row, events) => this.onStep(events));
            this.push();
        }
    }

    get attached(): boolean {
        return this.engine !== null;
    }

    /** The editor's draft plays (whatever stone is near) until `setAudition(null)`. */
    setAudition(pattern: GrovePattern | null, stoneId: string | null = null): void {
        this.audition = pattern;
        this.auditionStone = pattern ? stoneId : null;
        this.push();
    }

    get auditioning(): boolean {
        return this.audition !== null;
    }

    get source(): PlaybackSource {
        if (this.audition) return { kind: 'audition', stoneId: this.auditionStone };
        if (this.nearest) return { kind: 'stone', stoneId: this.nearest.id };
        return { kind: 'none' };
    }

    /** The pattern playing now, if any. */
    get playing(): GrovePattern | null {
        return this.audition ?? this.nearest?.pattern ?? null;
    }

    /** Pick the stone in earshot of `player` (with hysteresis) and play it. */
    update(player: { x: number; y: number; z: number }, stones: Iterable<StoneView>): void {
        let best: StoneView | null = null;
        let bestD2 = HEAR_RADIUS * HEAR_RADIUS;
        let current: StoneView | null = null;
        for (const stone of stones) {
            const dx = stone.x - player.x;
            const dy = stone.y - player.y;
            const dz = stone.z - player.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (this.nearest && stone.id === this.nearest.id) {
                if (d2 <= RELEASE_RADIUS * RELEASE_RADIUS) current = stone;
            }
            if (d2 < bestD2) {
                bestD2 = d2;
                best = stone;
            }
        }
        // The closest stone inside the hear radius wins; failing that, the one playing carries on
        // until the player passes the release radius.
        this.nearest = best ?? current;
        this.push();
    }

    /** Ease bobbed keys back down. */
    settle(dt: number): void {
        for (const [key, amount] of this.bob) {
            const next = amount * Math.exp(-KEY_SETTLE * dt);
            const rest = (key.userData.restY as number | undefined) ?? key.position.y;
            if (next < 0.002) {
                key.position.y = rest;
                this.bob.delete(key);
            } else {
                key.position.y = rest + next;
                this.bob.set(key, next);
            }
        }
    }

    dispose(): void {
        this.attach(null);
        this.bob.clear();
    }

    private push(): void {
        const next = this.playing;
        if (!this.engine || next === this.sent) return;
        this.sent = next;
        this.engine.setAuthoredPattern(next);
    }

    private onStep(events: ReadonlyArray<{ channel: number }>): void {
        const pattern = this.sent;
        if (!pattern || events.length === 0) return;
        const fired = this.firedScratch;
        fired.clear();
        const keys = this.audition ? null : this.nearest?.keys;
        for (const ev of events) {
            const row = pattern.channels[ev.channel];
            if (!row) continue;
            if (row.cue && !fired.has(row.cue)) {
                fired.add(row.cue);
                if (this.deps.fireCue(row.cue)) this.cueLog.push(row.cue);
            }
            const key = keys?.[ev.channel];
            if (key) {
                const rest = (key.userData.restY as number | undefined) ?? key.position.y;
                key.userData.restY = rest;
                key.position.y = rest + KEY_BOB;
                this.bob.set(key, KEY_BOB);
            }
        }
        if (this.cueLog.length > 64) this.cueLog.splice(0, this.cueLog.length - 64);
    }
}

/** Resolved patterns per live stone object, re-resolved only when its raw pattern changes. */
const _resolved = new WeakMap<object, { raw: unknown; pattern: GrovePattern }>();

/** A live stone object as a `StoneView` (null for anything that is not a placed stone). */
export function viewOfStone(obj: THREE.Object3D): StoneView | null {
    const ud = obj.userData as Record<string, unknown>;
    if (ud.isMusicStone !== true) return null;
    const id = typeof ud.mapEntityId === 'string' ? ud.mapEntityId : null;
    if (!id) return null;
    const raw = ud.grovePattern;
    let cached = _resolved.get(obj);
    if (!cached || cached.raw !== raw) {
        cached = { raw, pattern: resolveStonePattern(id, raw) };
        _resolved.set(obj, cached);
    }
    return {
        id,
        x: obj.position.x,
        y: obj.position.y,
        z: obj.position.z,
        pattern: cached.pattern,
        keys: ud.musicStoneKeys as THREE.Object3D[] | undefined,
    };
}
