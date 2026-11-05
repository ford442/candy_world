/**
 * Gamepad device (#2027 slice 2): `navigator.getGamepads()` → raw sources on
 * the layer, polled once per frame from the `input-actions` system just
 * before the layer samples (`frame.ts`).
 *
 * Standard Gamepad mapping only (Xbox, PlayStation and most pads in Chrome):
 * buttons become `pad:<name>` sources (`PAD_BUTTONS` in bindings.ts), the
 * sticks `stick:left` / `stick:right` after a radial deadzone, and the
 * triggers press past a threshold and carry their pull as the action's
 * `value`. Held buttons auto-repeat like a keyboard key, so `onPress(...,
 * { repeat: true })` works on a d-pad. Holding View is the pad's `ctrl`.
 *
 * DOM-light: the navigator and the event target are injected so tests drive
 * it with a fake `getGamepads`.
 */

import type { ActionLayer } from './action-layer.ts';
import { PAD_BUTTONS, type PadStyle } from './bindings.ts';
import type { RumbleActuator } from './gamepad-haptics.ts';

/** Right stick at full deflection turns this fast, in radians per second, at sensitivity 1. */
export const STICK_LOOK_RAD_PER_SEC = 2.6;
/** Pitch turns a little slower than yaw, as most console games do. */
const PITCH_RATIO = 0.75;
/** A trigger presses past this pull and releases below the lower one. */
export const TRIGGER_PRESS = 0.35;
export const TRIGGER_RELEASE = 0.25;
/** A held button repeats after this long, then at this interval (seconds). */
export const REPEAT_DELAY = 0.4;
export const REPEAT_INTERVAL = 0.12;
/** Frames longer than this (a stall, a backgrounded tab) don't fling the camera. */
const MAX_DT = 0.1;

const MOD_CTRL = 1;
const VIEW = PAD_BUTTONS.indexOf('back');
const TRIGGERS = new Set<number>([PAD_BUTTONS.indexOf('lt'), PAD_BUTTONS.indexOf('rt')]);

/** The part of the Gamepad API the device reads. */
export interface PadLike {
    readonly index: number;
    readonly id: string;
    readonly mapping: string;
    readonly connected: boolean;
    readonly axes: readonly number[];
    readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
    readonly vibrationActuator?: RumbleActuator | null;
}

export interface GamepadNavigator {
    getGamepads(): readonly (PadLike | null)[];
}

export interface PadEvents {
    addEventListener(type: string, fn: (e: Event) => void): void;
    removeEventListener(type: string, fn: (e: Event) => void): void;
}

export interface GamepadDeviceOptions {
    nav?: GamepadNavigator | null;
    events?: PadEvents | null;
    /** Spoken on connect and disconnect (the live region). */
    announce?: (message: string) => void;
}

/**
 * Radial deadzone: below `deadzone` the stick is centered; above it the
 * magnitude is rescaled to 0–1 so there is no jump at the edge. Direction is
 * kept, so diagonals aren't snapped to the axes as a per-axis deadzone would.
 */
export function radialDeadzone(
    x: number,
    y: number,
    deadzone: number,
    out: { x: number; y: number } = { x: 0, y: 0 }
): { x: number; y: number } {
    const len = Math.sqrt(x * x + y * y);
    if (len <= deadzone || len === 0) {
        out.x = 0;
        out.y = 0;
        return out;
    }
    const scaled = (Math.min(len, 1) - deadzone) / (1 - deadzone);
    out.x = (x / len) * scaled;
    out.y = (y / len) * scaled;
    return out;
}

/** Look response: magnitude^exponent along the stick's direction (1 is linear). */
export function applyLookCurve(
    v: { x: number; y: number },
    exponent: number
): { x: number; y: number } {
    const len = Math.sqrt(v.x * v.x + v.y * v.y);
    if (len === 0 || exponent === 1) return v;
    const k = Math.pow(len, exponent) / len;
    v.x *= k;
    v.y *= k;
    return v;
}

/** Sony pads (vendor 054c) show PlayStation names; everything else Xbox ones. */
export function padStyleOf(id: string): PadStyle {
    return /054c|playstation|dualsense|dualshock/i.test(id) ? 'playstation' : 'xbox';
}

/** `Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e …)` → `Xbox Wireless Controller`. */
function shortName(id: string): string {
    const name = id.replace(/\s*\(.*$/, '').trim();
    return name || 'Gamepad';
}

interface Held {
    /** Seconds until the next auto-repeat. */
    repeatIn: number;
}

export class GamepadDevice {
    private readonly nav: GamepadNavigator | null;
    private readonly events: PadEvents | null;
    private readonly announce: (message: string) => void;
    private readonly known = new Map<number, string>();
    private readonly unsupported = new Set<number>();
    private readonly held = new Map<string, Held>();
    private readonly next = new Map<string, number>();
    private readonly _stick = { x: 0, y: 0 };
    private lastTime: number | null = null;
    /** One `getGamepads()` scan before any connect event, for a pad pressed before attach. */
    private scanPending = true;
    private style: PadStyle = 'xbox';
    private readonly onConnect = (e: Event) => this.connected((e as GamepadEvent).gamepad);
    private readonly onDisconnect = (e: Event) =>
        this.disconnected((e as GamepadEvent).gamepad.index);

    constructor(
        private readonly layer: ActionLayer,
        opts: GamepadDeviceOptions = {}
    ) {
        this.nav = opts.nav ?? null;
        this.events = opts.events ?? null;
        this.announce = opts.announce ?? (() => {});
        this.events?.addEventListener('gamepadconnected', this.onConnect);
        this.events?.addEventListener('gamepaddisconnected', this.onDisconnect);
    }

    detach(): void {
        this.events?.removeEventListener('gamepadconnected', this.onConnect);
        this.events?.removeEventListener('gamepaddisconnected', this.onDisconnect);
        this.releaseHeld();
        this.known.clear();
    }

    /** At least one usable pad is connected. Polling is skipped until then. */
    isConnected(): boolean {
        return this.known.size > 0;
    }

    /** Glyph family of the last pad that connected. */
    padStyle(): PadStyle {
        return this.style;
    }

    /** The connected pads, for haptics. */
    pads(): PadLike[] {
        const out: PadLike[] = [];
        if (!this.nav) return out;
        for (const p of this.nav.getGamepads()) {
            if (p && p.connected && this.known.has(p.index)) out.push(p);
        }
        return out;
    }

    /** `gamepadconnected`: also exposed so a pad already plugged in is found by `poll()`. */
    connected(pad: PadLike): void {
        if (this.known.has(pad.index) || this.unsupported.has(pad.index)) return;
        if (pad.mapping !== 'standard') {
            // Without the Standard mapping, button 0 could be anything: don't guess.
            this.unsupported.add(pad.index);
            this.announce(`${shortName(pad.id)} connected, but its buttons aren't supported`);
            return;
        }
        this.known.set(pad.index, pad.id);
        this.style = padStyleOf(pad.id);
        this.layer.setDevice('gamepad');
        this.announce(`${shortName(pad.id)} connected`);
    }

    /** `gamepaddisconnected`: buttons the pad held let go now, not next frame. */
    disconnected(index: number): void {
        if (this.drop(index) && this.known.size > 0) this.poll();
    }

    private drop(index: number): boolean {
        this.unsupported.delete(index);
        const id = this.known.get(index);
        if (id === undefined) return false;
        this.known.delete(index);
        this.announce(`${shortName(id)} disconnected`);
        if (this.known.size === 0) {
            // Nothing held stays held, no stick keeps steering: back to keyboard and mouse.
            this.releaseHeld();
            this.lastTime = null;
            this.layer.setDevice('kbm');
        }
        return true;
    }

    /**
     * Read every pad and write this frame's sources. `now` is in milliseconds
     * (`performance.now()`); the look rate needs the frame time.
     */
    poll(now = globalThis.performance?.now() ?? Date.now()): void {
        if (!this.nav) return;
        // No pad, no cost: Chrome only lists a pad after a button press, which
        // also fires `gamepadconnected`.
        if (this.known.size === 0 && !this.scanPending) return;
        this.scanPending = false;
        const dt =
            this.lastTime === null
                ? 1 / 60
                : Math.min(MAX_DT, Math.max(0, (now - this.lastTime) / 1000));
        this.lastTime = now;

        const pads = this.nav.getGamepads();
        // A pad can be listed before its connect event reaches us.
        for (const p of pads) if (p && p.connected && !this.known.has(p.index)) this.connected(p);
        for (const index of [...this.known.keys()]) {
            const p = pads[index];
            if (!p || !p.connected) this.drop(index);
        }
        if (this.known.size === 0) return;

        const settings = this.layer.getSettings();
        const dz = settings.gamepad.deadzone;
        const next = this.next;
        next.clear();
        let lx = 0;
        let ly = 0;
        let rx = 0;
        let ry = 0;
        let view = false;

        for (const p of pads) {
            if (!p || !p.connected || !this.known.has(p.index)) continue;
            const n = Math.min(p.buttons.length, PAD_BUTTONS.length);
            for (let i = 0; i < n; i++) {
                const b = p.buttons[i];
                const source = `pad:${PAD_BUTTONS[i]}`;
                let level: number;
                if (TRIGGERS.has(i)) {
                    // Hysteresis: a trigger resting near the threshold doesn't chatter.
                    const threshold = this.held.has(source) ? TRIGGER_RELEASE : TRIGGER_PRESS;
                    if (b.value < threshold) continue;
                    level = b.value;
                } else if (b.pressed) level = 1;
                else continue;
                if (i === VIEW) view = true;
                next.set(source, Math.max(next.get(source) ?? 0, level));
            }
            // Standard mapping: axes 0/1 left stick, 2/3 right stick, +y is down.
            const l = radialDeadzone(p.axes[0] ?? 0, -(p.axes[1] ?? 0), dz, this._stick);
            lx += l.x;
            ly += l.y;
            const r = radialDeadzone(p.axes[2] ?? 0, -(p.axes[3] ?? 0), dz, this._stick);
            rx += r.x;
            ry += r.y;
        }

        const mask = view ? MOD_CTRL : 0;
        for (const source of this.held.keys()) {
            if (next.has(source)) continue;
            this.held.delete(source);
            this.layer.release(source);
        }
        for (const [source, level] of next) {
            const h = this.held.get(source);
            if (!h) {
                this.held.set(source, { repeatIn: REPEAT_DELAY });
                this.layer.press(source, mask, 'gamepad', false, level);
                continue;
            }
            this.layer.setLevel(source, level);
            h.repeatIn -= dt;
            if (h.repeatIn <= 0) {
                h.repeatIn += REPEAT_INTERVAL;
                this.layer.press(source, mask, 'gamepad', true);
            }
        }

        if (lx !== 0 || ly !== 0) this.layer.addAnalog('stick:left', lx, ly, 'gamepad');
        if (rx !== 0 || ry !== 0) {
            this._stick.x = rx;
            this._stick.y = ry;
            const v = applyLookCurve(this._stick, settings.gamepad.lookCurve);
            // Look is radians this frame; the layer applies sensitivity and invert Y.
            const rate = STICK_LOOK_RAD_PER_SEC * dt;
            this.layer.addAnalog('stick:right', v.x * rate, v.y * rate * PITCH_RATIO, 'gamepad');
        }
    }

    private releaseHeld(): void {
        for (const source of this.held.keys()) this.layer.release(source);
        this.held.clear();
    }
}

/** The browser's pad device on the app's layer; returns it (call `detach()` on teardown). */
export function attachGamepad(
    layer: ActionLayer,
    announce?: (message: string) => void,
    win: Window = window
): GamepadDevice {
    const nav = typeof win.navigator?.getGamepads === 'function' ? win.navigator : null;
    return new GamepadDevice(layer, {
        nav: nav as GamepadNavigator | null,
        events: win,
        announce,
    });
}
