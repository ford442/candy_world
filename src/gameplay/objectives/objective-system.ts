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
 * The stored step index only moves forward. `UnlockSystem.consume` can lower an item count, but a
 * step already passed stays passed.
 *
 * DOM-free and subscription-free; `index.ts` wires the events. Node tests drive it with a fake
 * snapshot.
 */

import { unionMelodyProgress, type MelodyProgress } from '../../systems/melody-progress.ts';
import type { Melody, Trigger } from './schema.ts';

/** What the player has right now. Read on every `evaluate`, never cached. */
export interface ObjectiveSnapshot {
    itemCount(itemId: string): number;
    /** A discovery id, or a Night Market stamp id (stamps are discoveries). */
    isDiscovered(id: string): boolean;
    /** Awakened flora so far, of `type` when given. */
    awakenedCount(type?: string): number;
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
}

export type MelodyStatus = 'active' | 'locked' | 'completed';

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
    }
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
        let again = true;
        while (again) {
            again = false;
            for (const m of melodies) {
                if (completed.has(m.id) || !(m.prereq ?? []).every((p) => completed.has(p)))
                    continue;
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

    return {
        evaluate() {
            if (advance(false)) notify();
        },
        apply(progress) {
            const merged = merge(progress);
            const advanced = advance(true);
            if (merged || advanced) notify();
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
                      : 'active';
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
