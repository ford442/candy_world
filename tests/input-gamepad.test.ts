/**
 * Gamepad device (#2027 slice 2): deadzone and curve math, Standard-mapping
 * buttons → actions in each context, triggers, sticks, auto-repeat, hot-plug
 * and `lastDevice()`, gamepad rebinding and its persistence, and beat haptics.
 * Headless: a fake `getGamepads()` and a plain EventTarget stand in for the
 * browser.
 *
 * Run with: npx tsx tests/input-gamepad.test.ts
 */

import { ActionLayer, type PersistedInput } from '../src/core/input/actions/action-layer.ts';
import { formatSource } from '../src/core/input/actions/bindings.ts';
import { bindInputFrame, updateInputActions } from '../src/core/input/actions/frame.ts';
import {
    applyLookCurve,
    GamepadDevice,
    padStyleOf,
    radialDeadzone,
    REPEAT_DELAY,
    REPEAT_INTERVAL,
    STICK_LOOK_RAD_PER_SEC,
    type PadLike,
} from '../src/core/input/actions/gamepad.ts';
import {
    BeatHaptics,
    MIN_GAP_MS,
    type RumbleActuator,
} from '../src/core/input/actions/gamepad-haptics.ts';
import { input } from '../src/core/input/actions/index.ts';
import {
    loadPersistedInput,
    savePersistedInput,
} from '../src/core/input/actions/settings-store.ts';
import { keyStates } from '../src/core/input/input-types.ts';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
    if (cond) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// Standard mapping indices.
const A = 0;
const B = 1;
const X = 2;
const LB = 4;
const RB = 5;
const LT = 6;
const RT = 7;
const VIEW = 8;
const START = 9;
const UP = 12;
const LEFT = 14;

interface FakePad extends PadLike {
    axes: number[];
    buttons: { pressed: boolean; value: number }[];
    connected: boolean;
    vibrationActuator?: RumbleActuator | null;
}

function makePad(index = 0, id = 'Xbox Wireless Controller (STANDARD GAMEPAD)'): FakePad {
    return {
        index,
        id,
        mapping: 'standard',
        connected: true,
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
}

function setButton(pad: FakePad, i: number, value: number): void {
    pad.buttons[i] = { pressed: value > 0.5, value };
}

/** A device on a fresh layer with a fake navigator; `frame()` polls then samples. */
function rig(layer = new ActionLayer()) {
    const pads: (FakePad | null)[] = [];
    const events = new EventTarget();
    const said: string[] = [];
    const device = new GamepadDevice(layer, {
        nav: { getGamepads: () => pads },
        events,
        announce: (m) => said.push(m),
    });
    let t = 0;
    const frame = (dtMs = 1000 / 60) => {
        t += dtMs;
        device.poll(t);
        layer.sample();
    };
    const plug = (pad: FakePad) => {
        pads[pad.index] = pad;
        events.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
    };
    const unplug = (pad: FakePad) => {
        pads[pad.index] = null;
        pad.connected = false;
        events.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: pad }));
    };
    return { layer, device, pads, frame, plug, unplug, said };
}

console.log('deadzone and curve');
{
    const v = radialDeadzone(0.1, 0.05, 0.15);
    check('inside the deadzone is centered', v.x === 0 && v.y === 0);
    const edge = radialDeadzone(0.151, 0, 0.15);
    check('just past the edge is near zero (no jump)', edge.x > 0 && edge.x < 0.01, `${edge.x}`);
    const full = radialDeadzone(1, 0, 0.15);
    check('full deflection is 1', near(full.x, 1));
    const over = radialDeadzone(0.9, 0.9, 0.15);
    check('a corner past the rim is clamped to length 1', near(Math.hypot(over.x, over.y), 1));
    check('radial keeps the diagonal', near(over.x, over.y));
    const half = radialDeadzone(0, -0.575, 0.15);
    check('magnitude is rescaled across the live range', near(half.y, -0.5));

    const c = applyLookCurve({ x: 0.5, y: 0 }, 2);
    check('curve 2 squares the magnitude', near(c.x, 0.25));
    const d = applyLookCurve({ x: 0.3, y: 0.4 }, 2);
    check('the curve keeps direction', near(d.x / d.y, 0.75) && near(Math.hypot(d.x, d.y), 0.25));
    const lin = applyLookCurve({ x: 0.5, y: 0.1 }, 1);
    check('curve 1 is linear', lin.x === 0.5 && lin.y === 0.1);
}

console.log('buttons → actions per context');
{
    const { layer, frame, plug } = rig();
    const pad = makePad();
    plug(pad);
    const seen: string[] = [];
    for (const a of [
        'jump',
        'fire',
        'dash',
        'interact',
        'build.place',
        'build.remove',
        'build.rotate',
        'undo',
        'redo',
        'pause',
        'menu.confirm',
        'menu.next',
        'photo.toggle',
        'dodge',
        'phase',
        'daynight',
    ] as const) {
        layer.onPress(a, (s) => seen.push(`${a}${s.value !== 1 ? `:${s.value}` : ''}`));
    }
    const tapButton = (i: number, value = 1) => {
        setButton(pad, i, value);
        frame();
        setButton(pad, i, 0);
        frame();
    };

    tapButton(A);
    check('gameplay: A jumps', seen.join() === 'jump', seen.join());
    seen.length = 0;
    tapButton(START);
    check('gameplay: Start pauses', seen.join() === 'pause', seen.join());
    seen.length = 0;
    tapButton(LB);
    tapButton(UP);
    check('gameplay: LB dodges, d-pad up phases', seen.join() === 'dodge,phase', seen.join());
    seen.length = 0;

    setButton(pad, RT, 0.8);
    frame();
    check('gameplay: RT fires', seen.join() === 'fire:0.8', seen.join());
    check('a trigger carries its pull as value', near(layer.get('fire').value, 0.8));
    setButton(pad, RT, 0.3);
    frame();
    check('a trigger above the release point stays held', layer.get('fire').pressed);
    check('…and its value follows the pull', near(layer.get('fire').value, 0.3));
    setButton(pad, RT, 0.2);
    frame();
    check('below the release point it lets go', !layer.get('fire').pressed);
    setButton(pad, RT, 0.3);
    frame();
    check('hysteresis: 0.3 does not press again', !layer.get('fire').pressed);
    setButton(pad, RT, 0);
    frame();
    seen.length = 0;

    // View is the pad's Ctrl: a View chord fires the chord only.
    setButton(pad, VIEW, 1);
    frame();
    tapButton(UP);
    setButton(pad, VIEW, 0);
    frame();
    check('gameplay: View+up is day/night, not phase', seen.join() === 'daynight', seen.join());
    seen.length = 0;

    const popBuild = layer.pushContext('build');
    frame();
    tapButton(RT, 1);
    check('build: RT places and fire does nothing', seen.join() === 'build.place', seen.join());
    seen.length = 0;
    tapButton(LT, 1);
    tapButton(LB);
    tapButton(RB);
    check(
        'build: LT removes, LB/RB rotate -1/+1',
        seen.join() === 'build.remove,build.rotate:-1,build.rotate',
        seen.join()
    );
    seen.length = 0;
    setButton(pad, VIEW, 1);
    frame();
    tapButton(LB);
    tapButton(RB);
    setButton(pad, VIEW, 0);
    frame();
    check(
        'build: View+LB undo, View+RB redo (no rotate)',
        seen.join() === 'undo,redo',
        seen.join()
    );
    seen.length = 0;
    tapButton(A);
    check('build: A still jumps (falls through)', seen.join() === 'jump', seen.join());
    seen.length = 0;

    setButton(pad, 0, 0);
    pad.axes[1] = -1;
    frame();
    check('build: the left stick still walks', near(layer.get('move').axis.y, 1));
    pad.axes[1] = 0;
    frame();

    const popMenu = layer.pushContext('menu');
    frame();
    for (const i of [A, B, X, LB, RT, START, 13]) tapButton(i, 1);
    pad.axes[1] = -1;
    pad.axes[2] = 1;
    frame();
    check(
        'menu: no gameplay or build action fires',
        seen.every((s) => s.startsWith('menu.') || s === 'pause'),
        seen.join()
    );
    check(
        'menu: A confirms, d-pad down moves on, Start is pause',
        seen.includes('menu.confirm') && seen.includes('menu.next') && seen.includes('pause')
    );
    check(
        'menu: sticks neither walk nor look',
        !layer.get('move').pressed && !layer.get('look').pressed
    );
    pad.axes[1] = 0;
    pad.axes[2] = 0;
    popMenu();
    popBuild();
    frame();
    seen.length = 0;

    const popPhoto = layer.pushContext('photo');
    frame();
    tapButton(A);
    tapButton(B);
    check(
        'photo: A selects, B leaves photo mode, nothing jumps',
        seen.join() === 'menu.confirm,photo.toggle',
        seen.join()
    );
    popPhoto();
}

console.log('sticks');
{
    const { layer, frame, plug } = rig();
    const pad = makePad();
    plug(pad);
    pad.axes[0] = 1;
    pad.axes[1] = -1;
    frame();
    const m = layer.get('move');
    check('left stick → move, up is forward', m.axis.y > 0 && m.axis.x > 0);
    check('move is at most length 1', near(Math.hypot(m.axis.x, m.axis.y), 1));
    pad.axes[0] = 0.05;
    pad.axes[1] = 0.05;
    frame();
    check('a drifting stick reads as centered', !layer.get('move').pressed);

    pad.axes[0] = 0;
    pad.axes[1] = 0;
    pad.axes[2] = 1;
    frame(100);
    const look = layer.get('look').axis;
    check(
        'right stick → look in radians per frame time',
        near(look.x, STICK_LOOK_RAD_PER_SEC * 0.1, 1e-9),
        `${look.x}`
    );
    frame(1000);
    check(
        'a long stall is clamped (no camera fling)',
        layer.get('look').axis.x <= STICK_LOOK_RAD_PER_SEC * 0.1 + 1e-9
    );

    layer.updateSettings({
        lookSensitivity: { ...layer.getSettings().lookSensitivity, gamepad: 2 },
        invertY: true,
    });
    pad.axes[2] = 0;
    pad.axes[3] = -1;
    frame(100);
    const up = layer.get('look').axis.y;
    check(
        'gamepad sensitivity and the global invert Y apply',
        up < 0 && near(Math.abs(up), STICK_LOOK_RAD_PER_SEC * 0.1 * 0.75 * 2, 1e-9),
        `${up}`
    );
    check('kbm sensitivity is separate', layer.getSettings().lookSensitivity.kbm === 1);
}

console.log('auto-repeat');
{
    const { layer, frame, plug } = rig();
    const pad = makePad();
    plug(pad);
    layer.pushContext('build');
    let steps = 0;
    let once = 0;
    layer.onPress('build.piece', () => steps++, { repeat: true });
    layer.onPress('build.piece', () => once++);
    setButton(pad, LEFT, 1);
    const ms = 1000 / 60;
    // The press, then repeats at the delay and one interval later: 3 steps.
    const frames = 1 + Math.ceil(((REPEAT_DELAY + REPEAT_INTERVAL) * 1000) / ms);
    for (let i = 0; i < frames; i++) frame(ms);
    check('a held d-pad repeats after the delay', steps === 3, `steps=${steps}`);
    check('onPress without repeat fires once', once === 1);
}

console.log('hot-plug and lastDevice');
{
    const { layer, device, frame, plug, unplug, said, pads } = rig();
    const changes: string[] = [];
    layer.onDeviceChange((d) => changes.push(d));
    check('starts on keyboard and mouse', layer.lastDevice() === 'kbm');
    const pad = makePad(
        0,
        'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'
    );
    plug(pad);
    check('connecting flips lastDevice() to gamepad', layer.lastDevice() === 'gamepad');
    check(
        '…and is announced',
        said.at(-1) === 'DualSense Wireless Controller connected',
        said.at(-1)
    );
    check('a Sony pad uses PlayStation names', device.padStyle() === 'playstation');
    layer.sample();
    check('onDeviceChange reports it on the next sample', changes.join() === 'gamepad');

    layer.press('key:KeyW', 0, 'kbm');
    layer.sample();
    check('a key press flips it back to kbm', layer.lastDevice() === 'kbm');
    layer.release('key:KeyW');
    layer.sample();

    setButton(pad, RT, 1);
    pad.axes[0] = 1;
    frame();
    check('holding fire and strafing', layer.get('fire').pressed && layer.get('move').axis.x > 0);
    unplug(pad);
    layer.sample();
    check('unplugging mid-hold releases buttons', !layer.get('fire').pressed);
    check('…and leaves no stuck axis', !layer.get('move').pressed);
    frame();
    check(
        '…still nothing on the next frame',
        !layer.get('move').pressed && !layer.get('fire').pressed
    );
    check('…and falls back to kbm', layer.lastDevice() === 'kbm');
    check('…announced', said.at(-1) === 'DualSense Wireless Controller disconnected');

    const other = makePad(1, 'Weird Pad');
    (other as { mapping: string }).mapping = '';
    plug(other);
    check('a pad without the Standard mapping is not used', !device.isConnected());
    check('…and says so', /aren't supported/.test(said.at(-1) ?? ''));

    // A pad pressed before attach is found by the first poll's scan.
    const late = new ActionLayer();
    const before = makePad(0);
    setButton(before, A, 1);
    const scan = new GamepadDevice(late, { nav: { getGamepads: () => [before] } });
    scan.poll(16);
    late.sample();
    check(
        'the first poll finds an already-connected pad',
        scan.isConnected() && late.get('jump').justPressed
    );
    check(
        'no pad, no polling cost',
        (() => {
            let calls = 0;
            const idle = new GamepadDevice(new ActionLayer(), {
                nav: { getGamepads: () => (calls++, []) },
            });
            for (let i = 0; i < 5; i++) idle.poll(i * 16);
            return calls === 1;
        })()
    );
    void pads;
}

console.log('rebinding a gamepad button');
{
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
    };
    const layer = new ActionLayer(loadPersistedInput(), savePersistedInput);
    const { frame, plug } = rig(layer);
    const pad = makePad();
    plug(pad);

    const padRows = layer.listBindings('gamepad');
    check(
        'gamepad rows are listed per device',
        padRows.length > 0 && padRows.every((r) => r.binding.source.startsWith('pad:'))
    );
    check(
        'kbm rows exclude pad sources',
        layer.listBindings('kbm').every((r) => !r.binding.source.startsWith('pad:'))
    );
    check(
        'sticks are not rebindable rows',
        padRows.every((r) => !r.binding.source.startsWith('stick:'))
    );

    const jumpRow = padRows.find((r) => r.binding.action === 'jump' && r.context === 'gameplay')!;
    let captured: { source: string; mods?: { ctrl?: boolean } } | null = null;
    layer.captureNext((spec) => (captured = spec), { device: 'gamepad' });
    const tookKey = layer.press('key:KeyJ', 0, 'kbm');
    check('a gamepad capture ignores keys', captured === null && layer.isCapturing() && !tookKey);
    layer.release('key:KeyJ');
    setButton(pad, X, 1);
    frame();
    check('…and takes the next pad button', captured?.source === 'pad:x');
    check('…without the button also acting', !layer.get('interact').pressed);
    layer.rebind(jumpRow.key, captured!.source, captured!.mods);
    setButton(pad, X, 0);
    frame();

    setButton(pad, X, 1);
    frame();
    check('the new button jumps', layer.get('jump').justPressed);
    setButton(pad, X, 0);
    frame();
    setButton(pad, A, 1);
    frame();
    check('the old button no longer does', !layer.get('jump').pressed);
    setButton(pad, A, 0);
    frame();

    let combo: { source: string; mods?: { ctrl?: boolean } } | null = null;
    layer.captureNext((spec) => (combo = spec), { device: 'gamepad' });
    setButton(pad, VIEW, 1);
    frame();
    check('View alone waits for the next button', combo === null);
    setButton(pad, LB, 1);
    frame();
    check('View+LB captures as a chord', combo?.source === 'pad:lb' && !!combo.mods?.ctrl);
    check('…shown as View+LB', formatSource(combo!.source, combo!.mods) === 'View+LB');
    setButton(pad, VIEW, 0);
    setButton(pad, LB, 0);
    frame();

    layer.updateSettings({
        gamepad: { ...layer.getSettings().gamepad, haptics: true, deadzone: 0.2 },
    });
    const reloaded = new ActionLayer(loadPersistedInput(), savePersistedInput);
    reloaded.press('pad:x', 0, 'gamepad');
    reloaded.sample();
    check('a reload keeps the gamepad rebind', reloaded.get('jump').pressed);
    check(
        '…and the haptics toggle and deadzone',
        reloaded.getSettings().gamepad.haptics && reloaded.getSettings().gamepad.deadzone === 0.2
    );
    const persisted = JSON.parse(store.get('candy-input-v1')!) as PersistedInput;
    check(
        'stored in settings-store under candy-input-v1',
        Object.values(persisted.overrides).includes('pad:x')
    );

    const junk = new ActionLayer({
        settings: { gamepad: { deadzone: 9, lookCurve: 'x', haptics: 'yes' } } as never,
    });
    const g = junk.getSettings().gamepad;
    check(
        'bad stored settings are clamped or defaulted',
        g.deadzone === 0.5 && g.lookCurve === 2 && g.haptics === false
    );
    delete (globalThis as { localStorage?: unknown }).localStorage;
}

console.log('glyphs');
{
    check('Xbox names', formatSource('pad:a') === 'A' && formatSource('pad:rt') === 'RT');
    check(
        'PlayStation names',
        formatSource('pad:a', undefined, 'playstation') === 'Cross' &&
            formatSource('pad:lb', { ctrl: true }, 'playstation') === 'Create+L1'
    );
    check(
        'd-pad and sticks',
        formatSource('pad:up') === 'D-pad up' && formatSource('stick:left') === 'Left stick'
    );
    check(
        'vendor detection',
        padStyleOf('Xbox 360 Controller (XInput STANDARD GAMEPAD)') === 'xbox' &&
            padStyleOf('054c-09cc-Wireless Controller') === 'playstation'
    );
}

console.log('haptics');
{
    const layer = new ActionLayer();
    let t = 0;
    const calls: { strong: number; weak: number }[] = [];
    const rumbler: { vibrationActuator: RumbleActuator } = {
        vibrationActuator: {
            playEffect: (_type, p) => {
                calls.push({ strong: p.strongMagnitude, weak: p.weakMagnitude });
                return Promise.resolve('complete');
            },
        },
    };
    const pads: object[] = [rumbler];
    const haptics = new BeatHaptics(
        layer,
        () => pads,
        () => t
    );

    /** The audio as it runs: kickTrigger jumps to 1 on a hit and decays (~8/s). */
    let kick = 0;
    const audioFrame = (ms: number, hit = false) => {
        t += ms;
        kick = hit ? 1 : Math.max(0, kick - (8 * ms) / 1000);
        haptics.onAudioFrame({ kickTrigger: kick });
    };

    haptics.onBeat();
    audioFrame(16, true);
    check('off by default: no rumble', calls.length === 0 && !haptics.enabled());

    layer.updateSettings({ gamepad: { ...layer.getSettings().gamepad, haptics: true } });
    t = 500;
    haptics.onBeat();
    // The kick lands a quarter beat after the wrap, as in the tracker: by the
    // next wrap it has decayed, so only the kick's own rise can trigger.
    audioFrame(160);
    check('a beat wrap alone does not rumble', calls.length === 0);
    audioFrame(16, true);
    check('on: a kick between beat wraps rumbles once', calls.length === 1);
    audioFrame(16);
    audioFrame(16);
    check('a decaying kick is not a new kick', calls.length === 1);
    audioFrame(200, true);
    check('a second kick in the same beat is not queued', calls.length === 1);
    check('…nor a strong pulse', haptics.pulse('strong') === 0 && calls.length === 1);

    haptics.onBeat();
    audioFrame(16);
    audioFrame(16);
    check('a beat without a kick stays quiet', calls.length === 1);
    check(
        '…but leaves the beat free for a strong pulse',
        haptics.pulse('strong') === 1 && calls.length === 2
    );
    check('strong is stronger than a kick', calls[1].strong > calls[0].strong);
    haptics.onBeat();
    audioFrame(MIN_GAP_MS / 2, true);
    check('effects are never closer than the minimum gap', calls.length === 2);
    haptics.onBeat();
    audioFrame(300);
    audioFrame(16, true);
    check("the next beat's kick rumbles again", calls.length === 3);

    // Music stopped: strong pulses still play, spaced by the gap.
    t = 10_000;
    check('no music: a strong pulse plays', haptics.pulse('strong') === 1);
    t += MIN_GAP_MS + 1;
    check('…and another after the gap', haptics.pulse('strong') === 1);

    pads.length = 0;
    pads.push({}, { vibrationActuator: null }, { vibrationActuator: {} });
    t += 1000;
    let threw = false;
    try {
        haptics.onBeat();
        audioFrame(16);
        audioFrame(16, true);
    } catch {
        threw = true;
    }
    check(
        'pads without vibrationActuator get no call and nothing throws',
        !threw && haptics.pulse('strong') === 0
    );

    pads.length = 0;
    pads.push(
        { vibrationActuator: { playEffect: () => Promise.reject(new Error('unplugged')) } },
        {
            vibrationActuator: {
                playEffect: () => {
                    throw new Error('not supported');
                },
            },
        }
    );
    t += 1000;
    let rejected = false;
    process.once('unhandledRejection', () => (rejected = true));
    check('a throwing actuator does not throw', haptics.pulse('strong') === 1);
    await new Promise((r) => setTimeout(r, 0));
    check('a rejected effect is caught', !rejected);
}

console.log('keyStates bridge');
{
    const pads: FakePad[] = [];
    const device = new GamepadDevice(input, { nav: { getGamepads: () => pads } });
    const pad = makePad();
    pads.push(pad);
    let now = 0;
    const off = bindInputFrame({
        look: null,
        isMenuOpen: () => false,
        isExploreHybrid: () => false,
        poll: () => device.poll((now += 16)),
        hud: {},
    });
    pad.axes[1] = -1;
    setButton(pad, A, 1);
    updateInputActions(false);
    check('the frame polls the pad: stick forward walks', keyStates.forward);
    check('…and A jumps', keyStates.jump);
    pad.axes[1] = 0;
    setButton(pad, A, 0);
    keyStates.jump = false;
    updateInputActions(false);
    check('release clears keyStates', !keyStates.forward && !keyStates.jump);
    off();
    device.detach();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
