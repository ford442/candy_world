/**
 * @file src/gameplay/objectives/objective-system.ts
 * @brief The Melody state machine (#2028 slice B).
 *
 * A step is satisfied when the player's *current* progress says so (an item count, a discovery,
 * a Night Market stamp, the number of awakened flora), not when an event is counted. Events are
 * only the cue to look again, which is what makes the layer robust:
 *   - a save that already satisfies a step passes it on load;
 *   - nothing is lost to a reload, a lazy chunk that loads late, or a merged world;
 *   - nothing can be counted twice.
 * Consequence: `harvest … count: 3` means "have 3", not "harvest 3 more from now".
 *
 * Present-tense triggers (`visit`, `play-on-beat`) read state that is only true for a moment: the
 * biome the player is in, the current on-beat streak. They pass when an evaluate sees them true
 * while they are the current step, and the step index (which only moves forward and unions by max)
 * is what remembers it. A save cannot satisfy them retroactively, and a replay cannot either.
 *
 * Seasonal Melodies (`season`) are evaluated only in their season. Out of season they keep their
 * step index (shown as dormant); a completed one stays completed, and still satisfies a `prereq`.
 *
 * Rewards are granted once, on the transition to completed made by this system's own advance.
 * Completion that arrives by merge (`apply` of a document or a peer) grants nothing: that state
 * came with its own inventory, which merges by max.
 *
 * The stored step index only moves forward. `UnlockSystem.consume` can lower an item count, but a
 * step already passed stays passed.
 *
 * DOM-free and subscription-free; `index.ts` wires the events. Node tests drive it with a fake
 * snapshot.
 */

import { unionMelodyProgress, type MelodyProgress } from '../../systems/melody-progress.ts';
import type { Melody, MelodyReward, Trigger } from './schema.ts';

/** What the player has right now. Read on every `evaluate`, never cached. */
export interface ObjectiveSnapshot {
    itemCount(itemId: string): number;
    /** A discovery id, or a Night Market stamp id (stamps are discoveries). */
    isDiscovered(id: string): boolean;
    /** Awakened flora so far, of `type` when given. */
    awakenedCount(type?: string): number;
    /** Authored entities placed and still live (`placedEntityCount`), of `type` when given. */
    builtCount?(type?: string): number;
    /** Biome the player stands in right now. */
    currentBiome?(): string;
    /** Current run of consecutive on-beat presses of `action`. */
    beatStreak?(action: string): number;
    /** Current season name (`spring` … `winter`). Without it, seasonal Melodies never activate. */
    season?(): string;
}

export type MelodyEvent = 'started' | 'step' | 'completed';

export interface ObjectiveDeps {
    melodies: readonly Melody[];
    snapshot: ObjectiveSnapshot;
    /**
     * Called for transitions the local `evaluate()` makes, at most once per Melody per call: a
     * Melody that jumps several steps (a save that already satisfies them) announces once. `detail`
     * is the text of the step to do next, for `step`. Never called for state that arrives through
     * `apply`.
     */
    announce(event: MelodyEvent, title: string, detail?: string): void;
    /** Saved state to start from. Taken as is: nothing in it is announced. */
    initial?: Readonly<MelodyProgress> | null;
    /** Give the player `count` of `item` (a Melody reward). Called once per local completion. */
    grant?(item: string, count: number): void;
}

/** `dormant`: a seasonal Melody, unlocked, waiting for its season. */
export type MelodyStatus = 'active' | 'locked' | 'dormant' | 'completed';

/** One Melody as the journal shows it. */
export interface MelodyView {
    id: string;
    title: string;
    status: MelodyStatus;
    /** Steps passed. */
    done: number;
    total: number;
    /** What to do next. Only for an active Melody. */
    current: string | null;
    /** Titles of the prerequisites still open. Only for a locked Melody. */
    needs: string[];
    /** The season a seasonal Melody runs in. */
    season: string | null;
}

export interface ObjectiveSystem {
    /** Advance every active Melody as far as the snapshot allows. Idempotent. */
    evaluate(): void;
    /**
     * Union state from a loaded or merged document. Silent: it may advance a Melody the snapshot
     * now satisfies, but announces nothing.
     */
    apply(progress: Readonly<MelodyProgress>): void;
    getProgress(): MelodyProgress;
    getViews(): MelodyView[];
    /** Called after any change to the state, announced or not. Returns an unsubscribe function. */
    onChange(listener: () => void): () => void;
}

const RANK: Record<MelodyEvent, number> = { started: 0, step: 1, completed: 2 };

export function isSatisfied(trigger: Trigger, snapshot: ObjectiveSnapshot): boolean {
    switch (trigger.kind) {
        case 'harvest':
            return snapshot.itemCount(trigger.item) >= trigger.count;
        case 'awaken':
            return snapshot.awakenedCount(trigger.type) >= trigger.count;
        case 'stamp':
        case 'discover':
            return snapshot.isDiscovered(trigger.id);
        case 'visit':
            return snapshot.currentBiome?.() === trigger.biome;
        case 'play-on-beat':
            return (snapshot.beatStreak?.(trigger.action) ?? 0) >= trigger.count;
        case 'build':
            return (snapshot.builtCount?.(trigger.type) ?? 0) >= trigger.count;
    }
}

export function isInSeason(melody: Melody, snapshot: ObjectiveSnapshot): boolean {
    return !melody.season || snapshot.season?.() === melody.season;
}

export function createObjectiveSystem(deps: ObjectiveDeps): ObjectiveSystem {
    const { melodies, snapshot } = deps;
    // Ids this build does not know (a Melody from a newer build) are kept, so they survive a save.
    const completed = new Set<string>();
    const step = new Map<string, number>();
    const listeners: Array<() => void> = [];

    /** Union `progress` into the state. True if anything changed. */
    function merge(progress: Readonly<MelodyProgress>): boolean {
        const incoming = unionMelodyProgress(progress);
        let changed = false;
        for (const id of incoming.completed) {
            if (!completed.has(id)) {
                completed.add(id);
                changed = true;
            }
            if (step.delete(id)) changed = true;
        }
        for (const id of Object.keys(incoming.step)) {
            if (completed.has(id)) continue;
            const n = incoming.step[id];
            if (n > (step.get(id) ?? -1)) {
                step.set(id, n);
                changed = true;
            }
        }
        return changed;
    }

    function notify(): void {
        for (const listener of listeners.slice()) {
            try {
                listener();
            } catch (err) {
                console.warn('[Objectives] Change listener failed:', err);
            }
        }
    }

    /** One pass over every active Melody, repeated while a completion opens another. */
    function advance(silent: boolean): boolean {
        // Insertion order is the order transitions happened in: a completion is announced before
        // the Melody it opens, whatever order the Melodies are listed in.
        const events = new Map<string, { title: string; event: MelodyEvent; detail?: string }>();
        const rewards: MelodyReward[] = [];
        let again = true;
        while (again) {
            again = false;
            for (const m of melodies) {
                if (completed.has(m.id) || !(m.prereq ?? []).every((p) => completed.has(p)))
                    continue;
                if (!isInSeason(m, snapshot)) continue;
                const tracked = step.has(m.id);
                const from = step.get(m.id) ?? 0;
                let at = from;
                while (at < m.steps.length && isSatisfied(m.steps[at].trigger, snapshot)) at++;

                let event: MelodyEvent | null = null;
                let detail: string | undefined;
                if (at >= m.steps.length) {
                    completed.add(m.id);
                    step.delete(m.id);
                    event = 'completed';
                    if (m.reward) rewards.push(m.reward);
                } else if (at > from) {
                    step.set(m.id, at);
                    event = 'step';
                    detail = m.steps[at].text;
                } else if (!tracked) {
                    step.set(m.id, 0);
                    event = 'started';
                }
                if (!event) continue;
                again = true;
                const prior = events.get(m.id);
                if (!prior || RANK[event] > RANK[prior.event]) {
                    events.set(m.id, { title: m.title, event, detail });
                }
            }
        }

        if (events.size === 0) return false;
        // After the state change, so a grant that re-enters `evaluate` (a harvest listener) sees
        // the Melody completed and cannot grant it again.
        for (const reward of rewards) {
            for (const { item, count } of reward.items) {
                try {
                    deps.grant?.(item, count);
                } catch (err) {
                    console.warn('[Objectives] reward grant failed:', err);
                }
            }
        }
        if (!silent) {
            for (const e of events.values()) {
                try {
                    deps.announce(e.event, e.title, e.detail);
                } catch (err) {
                    console.warn('[Objectives] announce failed:', err);
                }
            }
        }
        return true;
    }

    if (deps.initial) merge(deps.initial);

    // A grant can re-enter (harvest -> onHarvest -> evaluate). The nested call is folded into the
    // running one: it runs once more after the current pass instead of inside it.
    let running = false;
    let rerun = false;
    function run(silent: boolean, merged: boolean): void {
        if (running) {
            rerun = true;
            return;
        }
        running = true;
        let changed = merged;
        try {
            do {
                rerun = false;
                if (advance(silent)) changed = true;
            } while (rerun);
        } finally {
            running = false;
        }
        if (changed) notify();
    }

    return {
        evaluate() {
            run(false, false);
        },
        apply(progress) {
            run(true, merge(progress));
        },
        getProgress() {
            return { completed: [...completed], step: Object.fromEntries(step) };
        },
        getViews() {
            return melodies.map((m): MelodyView => {
                const done = completed.has(m.id);
                const open = (m.prereq ?? []).filter((p) => !completed.has(p));
                const status: MelodyStatus = done
                    ? 'completed'
                    : open.length > 0
                      ? 'locked'
                      : isInSeason(m, snapshot)
                        ? 'active'
                        : 'dormant';
                const passed = done
                    ? m.steps.length
                    : Math.min(step.get(m.id) ?? 0, m.steps.length);
                return {
                    id: m.id,
                    title: m.title,
                    status,
                    done: passed,
                    total: m.steps.length,
                    current: status === 'active' ? (m.steps[passed]?.text ?? null) : null,
                    needs: open.map((p) => melodies.find((x) => x.id === p)?.title ?? p),
                    season: m.season ?? null,
                };
            });
        },
        onChange(listener) {
            listeners.push(listener);
            return () => {
                const i = listeners.indexOf(listener);
                if (i >= 0) listeners.splice(i, 1);
            };
        },
    };
}
