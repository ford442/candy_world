/**
 * The action layer (#2027): raw device sources in, `ActionState` out.
 *
 * DOM-free so tests drive it directly; `keyboard-mouse.ts` is the browser
 * device and `index.ts` holds the app's instance.
 *
 * Routing: a press goes to the top-most active context with a binding that
 * matches the source and the modifiers held at that moment, and stays routed
 * there until release. The press edge is always delivered to that context
 * (Escape in build mode still cancels a move even though the pause menu opens
 * on the same key). Holding is re-checked every frame: while a blocking
 * context sits above the route, the action reads as released.
 */

import { DEFAULT_CONTEXTS, isRebindableSource } from './bindings.ts';
import {
    ACTION_IDS,
    type ActionId,
    type ActionState,
    type Binding,
    type Device,
    type HoldToggleAction,
    type InputContext,
    type InputContextId,
    type InputSettings,
    type Modifiers,
} from './types.ts';

/** Fixed priority, bottom to top: menu over photo over gizmo over build over gameplay. */
export const CONTEXT_PRIORITY: readonly InputContextId[] = [
    'gameplay',
    'xr',
    'build',
    'gizmo',
    'photo',
    'menu',
];

const MOD_CTRL = 1;
const MOD_SHIFT = 2;
const MOD_ALT = 4;

export function modsMask(m: Modifiers | undefined): number {
    if (!m) return 0;
    return (m.ctrl ? MOD_CTRL : 0) | (m.shift ? MOD_SHIFT : 0) | (m.alt ? MOD_ALT : 0);
}

export function maskToMods(mask: number): Modifiers | undefined {
    if (mask === 0) return undefined;
    return {
        ...(mask & MOD_CTRL ? { ctrl: true } : {}),
        ...(mask & MOD_SHIFT ? { shift: true } : {}),
        ...(mask & MOD_ALT ? { alt: true } : {}),
    };
}

/** `Ctrl+Shift+key:KeyZ`: a binding's source and modifiers as one persistable string. */
export function bindingSpec(source: string, mods: Modifiers | undefined): string {
    return `${mods?.ctrl ? 'Ctrl+' : ''}${mods?.alt ? 'Alt+' : ''}${mods?.shift ? 'Shift+' : ''}${source}`;
}

export function parseSpec(spec: string): { source: string; mods: Modifiers | undefined } {
    const mods: Modifiers = {};
    let rest = spec;
    for (;;) {
        if (rest.startsWith('Ctrl+')) mods.ctrl = true;
        else if (rest.startsWith('Alt+')) mods.alt = true;
        else if (rest.startsWith('Shift+')) mods.shift = true;
        else break;
        rest = rest.slice(rest.indexOf('+') + 1);
    }
    return { source: rest, mods: modsMask(mods) === 0 ? undefined : mods };
}

/** Stable id of one default binding: what an override is keyed by. */
export function bindingKey(context: InputContextId, b: Binding): string {
    return `${context}|${b.action}|${bindingSpec(b.source, b.mods)}${b.axis ? `|${b.axis}${b.scale ?? 1}` : ''}`;
}

export const DEFAULT_SETTINGS: InputSettings = {
    lookSensitivity: { kbm: 1, gamepad: 1, touch: 1, xr: 1 },
    invertY: false,
    holdToggle: { sprint: 'hold', sneak: 'hold' },
};

export interface PersistedInput {
    settings: InputSettings;
    /** bindingKey → bindingSpec of the replacement (`''` = unbound). */
    overrides: Record<string, string>;
}

export interface BindingRow {
    key: string;
    context: InputContextId;
    binding: Binding;
    defaultBinding: Binding;
}

interface Route {
    context: InputContextId;
    bindings: readonly Binding[];
}

interface SourceState {
    down: boolean;
    /** Went down since the last sample, so a tap shorter than a frame still counts. */
    tapped: boolean;
    repeats: number;
    route: Route | null;
}

interface Analog {
    x: number;
    y: number;
    device: Device;
}

type Listener = (state: Readonly<ActionState>) => void;

const newState = (): ActionState => ({
    pressed: false,
    justPressed: false,
    justReleased: false,
    repeated: false,
    value: 0,
    axis: { x: 0, y: 0 },
});

const AXIS_ACTIONS = new Set<ActionId>(['move', 'look', 'build.nudge']);

export class ActionLayer {
    private readonly active = new Map<InputContextId, number>([['gameplay', 1]]);
    private readonly defaults: Record<InputContextId, InputContext>;
    private readonly effective = new Map<InputContextId, readonly Binding[]>();
    private overrides: Record<string, string>;
    private settings: InputSettings;

    private readonly sources = new Map<string, SourceState>();
    private readonly analog = new Map<string, Analog>();
    private readonly states = {} as Record<ActionId, ActionState>;
    private readonly acc = {} as Record<ActionId, ActionState>;
    private readonly prev = {} as Record<ActionId, boolean>;
    private readonly latched: Record<HoldToggleAction, boolean> = { sprint: false, sneak: false };
    private readonly rawPrev: Record<HoldToggleAction, boolean> = { sprint: false, sneak: false };
    private readonly listeners = new Map<ActionId, Set<Listener>>();
    private readonly changeListeners = new Set<() => void>();
    private capture:
        ((spec: { source: string; mods: Modifiers | undefined } | null) => void) | null = null;
    private captureModifier: string | null = null;
    private device: Device = 'kbm';

    constructor(
        persisted: Partial<PersistedInput> = {},
        private readonly persist: (p: PersistedInput) => void = () => {},
        contexts: Record<InputContextId, Omit<InputContext, 'id'>> = DEFAULT_CONTEXTS
    ) {
        this.defaults = {} as Record<InputContextId, InputContext>;
        for (const id of CONTEXT_PRIORITY) this.defaults[id] = { id, ...contexts[id] };
        this.overrides = { ...(persisted.overrides ?? {}) };
        this.settings = mergeSettings(persisted.settings);
        for (const a of ACTION_IDS) {
            this.states[a] = newState();
            this.acc[a] = newState();
            this.prev[a] = false;
        }
    }

    // ---------------------------------------------------------------- contexts

    /** Activate a context; call the returned function (once) to pop it. */
    pushContext(id: InputContextId): () => void {
        this.active.set(id, (this.active.get(id) ?? 0) + 1);
        let popped = false;
        return () => {
            if (popped) return;
            popped = true;
            const n = (this.active.get(id) ?? 0) - 1;
            if (n > 0 || id === 'gameplay') this.active.set(id, Math.max(n, 1));
            else this.active.delete(id);
        };
    }

    isContextActive(id: InputContextId): boolean {
        return this.active.has(id);
    }

    /** Top-most active context. */
    topContext(): InputContextId {
        for (let i = CONTEXT_PRIORITY.length - 1; i >= 0; i--) {
            if (this.active.has(CONTEXT_PRIORITY[i])) return CONTEXT_PRIORITY[i];
        }
        return 'gameplay';
    }

    /** False while a blocking context sits above `id` (or `id` is not active). */
    private reaches(id: InputContextId): boolean {
        if (!this.active.has(id)) return false;
        for (let i = CONTEXT_PRIORITY.length - 1; i >= 0; i--) {
            const c = CONTEXT_PRIORITY[i];
            if (c === id) return true;
            if (this.active.has(c) && this.defaults[c].blocksBelow) return false;
        }
        return false;
    }

    private bindingsOf(id: InputContextId): readonly Binding[] {
        let list = this.effective.get(id);
        if (!list) {
            list = this.defaults[id].bindings.flatMap((b): Binding[] => {
                const spec = this.overrides[bindingKey(id, b)];
                if (spec === undefined) return [b];
                if (spec === '') return [];
                const { source, mods } = parseSpec(spec);
                // Rebound keys match their modifiers exactly, like the defaults that set `mods`.
                return [{ ...b, source, mods: mods ?? (b.mods ? {} : undefined) }];
            });
            this.effective.set(id, list);
        }
        return list;
    }

    private route(source: string, mask: number): Route | null {
        for (let i = CONTEXT_PRIORITY.length - 1; i >= 0; i--) {
            const id = CONTEXT_PRIORITY[i];
            if (!this.active.has(id)) continue;
            let exact: Binding[] | null = null;
            let loose: Binding[] | null = null;
            for (const b of this.bindingsOf(id)) {
                if (b.source !== source) continue;
                if (b.mods === undefined) (loose ??= []).push(b);
                else if (modsMask(b.mods) === mask) (exact ??= []).push(b);
            }
            const hit = exact ?? loose;
            if (hit) return { context: id, bindings: hit };
            if (this.defaults[id].blocksBelow) return null;
        }
        return null;
    }

    // ----------------------------------------------------------------- devices

    /**
     * A source went down (or auto-repeated). Returns true when an action or a
     * rebind capture took it, so the device can `preventDefault`.
     */
    press(source: string, mods: Modifiers | number, device: Device, repeat = false): boolean {
        const mask = typeof mods === 'number' ? mods : modsMask(mods);
        this.device = device;
        if (this.capture && !repeat) {
            if (source === 'key:Escape') {
                this.endCapture(null);
                return true;
            }
            if (isModifierKey(source)) {
                // Shift alone (sprint) or Shift+K: decided by what comes next.
                this.captureModifier = source;
                return true;
            }
            if (isRebindableSource(source)) {
                this.endCapture({ source, mods: maskToMods(mask) });
                return true;
            }
        }
        const existing = this.sources.get(source);
        if (repeat) {
            if (existing?.down) existing.repeats++;
            return !!existing?.route;
        }
        const route = this.route(source, mask);
        if (existing) {
            existing.down = true;
            existing.tapped = true;
            existing.route = route;
        } else {
            this.sources.set(source, { down: true, tapped: true, repeats: 0, route });
        }
        return route !== null;
    }

    release(source: string): void {
        if (this.capture && this.captureModifier === source) {
            this.endCapture({ source, mods: undefined });
            return;
        }
        const s = this.sources.get(source);
        if (s) s.down = false;
    }

    /** Window blur or tab hidden: nothing stays held. */
    releaseAll(): void {
        for (const s of this.sources.values()) s.down = false;
    }

    /** Accumulate an analog delta (mouse motion; sticks later). Look deltas are radians. */
    addAnalog(source: string, x: number, y: number, device: Device): void {
        this.device = device;
        const a = this.analog.get(source);
        if (a) {
            a.x += x;
            a.y += y;
            a.device = device;
        } else this.analog.set(source, { x, y, device });
    }

    /** Would a press of `source` with `mods` reach an action right now? */
    routes(source: string, mods: Modifiers | number): boolean {
        return this.route(source, typeof mods === 'number' ? mods : modsMask(mods)) !== null;
    }

    // ------------------------------------------------------------------ sample

    /** Once per frame, in the scheduler's `input` phase. */
    sample(): void {
        for (const a of ACTION_IDS) {
            const s = this.acc[a];
            s.pressed = false;
            s.repeated = false;
            s.value = 0;
            s.axis.x = 0;
            s.axis.y = 0;
        }

        for (const [source, s] of this.sources) {
            const route = s.route;
            if (route && (s.down || s.tapped) && (s.tapped || this.reaches(route.context))) {
                const repeated = s.repeats > 0 && !s.tapped;
                for (const b of route.bindings) this.contribute(b, 1, 1, repeated);
            }
            s.tapped = false;
            s.repeats = 0;
            if (!s.down) this.sources.delete(source);
        }

        for (const [source, a] of this.analog) {
            const route = this.route(source, 0);
            if (route && this.reaches(route.context)) {
                for (const b of route.bindings) {
                    if (b.action === 'look') {
                        const sens = this.settings.lookSensitivity[a.device] ?? 1;
                        this.contribute(
                            b,
                            a.x * sens,
                            a.y * sens * (this.settings.invertY ? -1 : 1),
                            false
                        );
                    } else this.contribute(b, a.x, a.y, false);
                }
            }
        }
        this.analog.clear();

        for (const a of ACTION_IDS) {
            const acc = this.acc[a];
            if (AXIS_ACTIONS.has(a)) {
                const len = Math.hypot(acc.axis.x, acc.axis.y);
                if (a !== 'look' && len > 1) {
                    acc.axis.x /= len;
                    acc.axis.y /= len;
                }
                acc.value = Math.min(len, a === 'look' ? Infinity : 1);
            } else {
                acc.value = Math.max(-1, Math.min(1, acc.value));
            }
        }

        for (const a of ['sprint', 'sneak'] as const) {
            const raw = this.acc[a].pressed;
            if (this.settings.holdToggle[a] === 'toggle') {
                if (raw && !this.rawPrev[a]) this.latched[a] = !this.latched[a];
                this.acc[a].pressed = this.latched[a];
            } else this.latched[a] = false;
            this.rawPrev[a] = raw;
        }

        for (const a of ACTION_IDS) {
            const acc = this.acc[a];
            const st = this.states[a];
            const was = this.prev[a];
            st.pressed = acc.pressed;
            st.justPressed = acc.pressed && !was;
            st.justReleased = !acc.pressed && was;
            st.repeated = acc.repeated && acc.pressed && !st.justPressed;
            st.value = acc.value;
            st.axis.x = acc.axis.x;
            st.axis.y = acc.axis.y;
            this.prev[a] = acc.pressed;
        }

        for (const [a, set] of this.listeners) {
            const st = this.states[a];
            if (!st.justPressed && !st.justReleased && !st.repeated) continue;
            for (const fn of set) {
                try {
                    fn(st);
                } catch (err) {
                    console.error(`[input] '${a}' handler threw`, err);
                }
            }
        }
    }

    private contribute(b: Binding, x: number, y: number, repeated: boolean): void {
        const s = this.acc[b.action];
        const scale = b.scale ?? 1;
        if (b.source === 'mouse:move' || b.source.startsWith('stick:')) {
            s.axis.x += x * scale;
            s.axis.y += y * scale;
            if (x !== 0 || y !== 0) s.pressed = true;
            return;
        }
        s.pressed = true;
        s.repeated ||= repeated;
        if (b.axis) s.axis[b.axis] += scale;
        else s.value += scale;
    }

    // -------------------------------------------------------------- game side

    get(a: ActionId): Readonly<ActionState> {
        return this.states[a];
    }

    /** Called from `sample()` when `a` is pressed, released or auto-repeats. */
    onAction(a: ActionId, fn: Listener): () => void {
        let set = this.listeners.get(a);
        if (!set) this.listeners.set(a, (set = new Set()));
        set.add(fn);
        return () => void set.delete(fn);
    }

    /** `onAction` for the press edge only (and auto-repeats with `repeat: true`). */
    onPress(a: ActionId, fn: Listener, opts: { repeat?: boolean } = {}): () => void {
        return this.onAction(a, (s) => {
            if (s.justPressed || (opts.repeat && s.repeated)) fn(s);
        });
    }

    /** The device that last produced input: drives button-prompt glyphs. */
    lastDevice(): Device {
        return this.device;
    }

    // -------------------------------------------------------------- rebinding

    getSettings(): Readonly<InputSettings> {
        return this.settings;
    }

    updateSettings(patch: Partial<InputSettings>): void {
        this.settings = mergeSettings({ ...this.settings, ...patch });
        this.save();
    }

    /** Every rebindable keyboard/mouse binding, in context then table order. */
    listBindings(): BindingRow[] {
        const rows: BindingRow[] = [];
        for (const context of CONTEXT_PRIORITY) {
            for (const def of this.defaults[context].bindings) {
                if (!isRebindableSource(def.source)) continue;
                const key = bindingKey(context, def);
                const spec = this.overrides[key];
                const binding: Binding =
                    spec === undefined
                        ? def
                        : spec === ''
                          ? { ...def, source: '' }
                          : { ...def, ...parseSpec(spec) };
                rows.push({ key, context, binding, defaultBinding: def });
            }
        }
        return rows;
    }

    /**
     * Point one binding at a new source. Returns the other bindings in the same
     * context that already use it, so the UI can say so.
     */
    rebind(key: string, source: string, mods?: Modifiers): BindingRow[] {
        const row = this.listBindings().find((r) => r.key === key);
        if (!row) return [];
        const spec = source === '' ? '' : bindingSpec(source, mods);
        if (spec === bindingSpec(row.defaultBinding.source, row.defaultBinding.mods)) {
            delete this.overrides[key];
        } else this.overrides[key] = spec;
        this.effective.clear();
        this.save();
        const mask = modsMask(mods);
        return this.listBindings().filter(
            (r) =>
                r.key !== key &&
                r.context === row.context &&
                r.binding.source === source &&
                source !== '' &&
                (r.binding.mods === undefined || modsMask(r.binding.mods) === mask)
        );
    }

    resetBindings(): void {
        this.overrides = {};
        this.effective.clear();
        this.save();
    }

    /** The next key or mouse button goes to `fn` instead of the game; Escape cancels (null). */
    captureNext(
        fn: (spec: { source: string; mods: Modifiers | undefined } | null) => void
    ): () => void {
        this.capture?.(null);
        this.capture = fn;
        this.captureModifier = null;
        return () => {
            if (this.capture === fn) this.capture = null;
        };
    }

    isCapturing(): boolean {
        return this.capture !== null;
    }

    private endCapture(spec: { source: string; mods: Modifiers | undefined } | null): void {
        const fn = this.capture;
        this.capture = null;
        this.captureModifier = null;
        fn?.(spec);
    }

    /** Settings or bindings changed (the rebinding UI re-renders). */
    onChange(fn: () => void): () => void {
        this.changeListeners.add(fn);
        return () => void this.changeListeners.delete(fn);
    }

    private save(): void {
        this.persist({ settings: this.settings, overrides: { ...this.overrides } });
        for (const fn of this.changeListeners) fn();
    }
}

function isModifierKey(source: string): boolean {
    return /^key:(Shift|Control|Alt|Meta)(Left|Right)$/.test(source);
}

function mergeSettings(s: Partial<InputSettings> | undefined): InputSettings {
    return {
        lookSensitivity: { ...DEFAULT_SETTINGS.lookSensitivity, ...(s?.lookSensitivity ?? {}) },
        invertY: s?.invertY ?? DEFAULT_SETTINGS.invertY,
        holdToggle: { ...DEFAULT_SETTINGS.holdToggle, ...(s?.holdToggle ?? {}) },
    };
}
