/**
 * Action layer (#2027): routing through the context stack, modifiers, edges,
 * rebinding and persistence, settings, and the keyStates bridge the fixed-step
 * physics reads. Headless: drives the layer the way the DOM device does.
 *
 * Run with: npx tsx tests/input-actions.test.ts
 */

import { ActionLayer, type PersistedInput } from '../src/core/input/actions/action-layer.ts';
import { bindInputFrame, updateInputActions } from '../src/core/input/actions/frame.ts';
import { input } from '../src/core/input/actions/index.ts';
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

const NONE = 0;
const CTRL = 1;
const SHIFT = 2;

/** Press, sample, release, sample: a one-frame tap and its release frame. */
function tap(layer: ActionLayer, source: string, mods = NONE): void {
    layer.press(source, mods, 'kbm');
    layer.sample();
    layer.release(source);
    layer.sample();
}

console.log('contexts');
{
    const layer = new ActionLayer();
    let fired = 0;
    let placed = 0;
    layer.onPress('fire', () => fired++);
    layer.onPress('build.place', () => placed++);

    tap(layer, 'mouse:0');
    check('gameplay: mouse 0 fires', fired === 1);

    const popBuild = layer.pushContext('build');
    layer.sample();
    tap(layer, 'mouse:0');
    check('build: fire does nothing', fired === 1, `fired=${fired}`);
    check('build: mouse 0 places instead', placed === 1);

    layer.press('key:KeyW', NONE, 'kbm');
    layer.sample();
    check('build: WASD still walks', layer.get('move').axis.y === 1);
    layer.release('key:KeyW');
    layer.sample();

    const popMenu = layer.pushContext('menu');
    const seen: string[] = [];
    for (const a of [
        'jump',
        'dash',
        'fire',
        'build.place',
        'build.toggle',
        'photo.toggle',
    ] as const) {
        layer.onPress(a, () => seen.push(a));
    }
    for (const s of ['key:Space', 'key:KeyE', 'mouse:0', 'key:KeyB', 'key:KeyP', 'key:KeyW'])
        tap(layer, s);
    check('menu: no gameplay or build action fires', seen.length === 0, seen.join(','));
    check('menu: move stays zero', layer.get('move').value === 0);
    check('menu: claims nothing, so the DOM keeps its keys', !layer.routes('key:Space', NONE));

    popMenu();
    tap(layer, 'mouse:0');
    check('popping menu restores build', placed === 2 && fired === 1);
    popBuild();
    tap(layer, 'mouse:0');
    check('popping build restores gameplay', fired === 2);
    popBuild();
    check('a pop function is idempotent', !layer.isContextActive('build'));
    check('gameplay is always active', layer.topContext() === 'gameplay');
}

console.log('gizmo blocks below');
{
    const layer = new ActionLayer();
    layer.pushContext('build');
    const popGizmo = layer.pushContext('gizmo');
    layer.press('key:KeyW', NONE, 'kbm');
    layer.sample();
    check('gizmo: walking is blocked', layer.get('move').value === 0);
    layer.release('key:KeyW');
    let done = 0;
    layer.onPress('gizmo.done', () => done++);
    tap(layer, 'key:Escape');
    check('gizmo: Escape is done', done === 1);
    popGizmo();
}

console.log('modifiers');
{
    const layer = new ActionLayer();
    layer.pushContext('build');
    const values: number[] = [];
    layer.onPress('build.rotate', (s) => values.push(s.value));
    tap(layer, 'key:KeyR');
    tap(layer, 'key:KeyR', SHIFT);
    check('R rotates +1, Shift+R -1', values.join() === '1,-1', values.join());

    let undo = 0;
    let redo = 0;
    let phase = 0;
    layer.onPress('undo', () => undo++);
    layer.onPress('redo', () => redo++);
    layer.onPress('phase', () => phase++);
    tap(layer, 'key:KeyZ', CTRL);
    tap(layer, 'key:KeyZ', CTRL | SHIFT);
    tap(layer, 'key:KeyY', CTRL);
    check('Ctrl+Z undo, Ctrl+Shift+Z and Ctrl+Y redo', undo === 1 && redo === 2);
    check('Ctrl+Z is not phase', phase === 0);
    tap(layer, 'key:KeyZ');
    check('plain Z in build falls through to gameplay phase', phase === 1);

    let sprint = false;
    layer.press('key:ShiftLeft', SHIFT, 'kbm');
    layer.press('key:KeyW', SHIFT, 'kbm');
    layer.sample();
    sprint = layer.get('sprint').pressed;
    check('Shift+W walks and sprints', sprint && layer.get('move').axis.y === 1);
    layer.releaseAll();
    layer.sample();
    check(
        'releaseAll lets go of everything',
        !layer.get('sprint').pressed && layer.get('move').value === 0
    );
}

console.log('edges and timing');
{
    const layer = new ActionLayer();
    layer.press('key:Space', NONE, 'kbm');
    layer.release('key:Space');
    layer.sample();
    check('a tap shorter than a frame still presses', layer.get('jump').justPressed);
    layer.sample();
    check('…and releases the next frame', layer.get('jump').justReleased);

    layer.press('key:KeyW', NONE, 'kbm');
    layer.sample();
    const pop = layer.pushContext('menu');
    layer.sample();
    check('a held key reads released under a blocking context', !layer.get('move').pressed);
    pop();
    layer.sample();
    check('…and held again when it pops', layer.get('move').axis.y === 1);
    layer.release('key:KeyW');
    layer.sample();

    layer.pushContext('build');
    let cancelled = 0;
    layer.onPress('build.cancel', () => cancelled++);
    layer.press('key:Escape', NONE, 'kbm');
    // The browser releases pointer lock and the pause menu opens before the frame.
    const popMenu = layer.pushContext('menu');
    layer.release('key:Escape');
    layer.sample();
    check('a press edge reaches the context it was routed to', cancelled === 1);
    popMenu();

    let steps = 0;
    layer.onPress('build.nudge', () => steps++, { repeat: true });
    layer.press('key:ArrowLeft', NONE, 'kbm');
    layer.sample();
    layer.sample();
    layer.press('key:ArrowLeft', NONE, 'kbm', true);
    layer.sample();
    layer.press('key:ArrowLeft', NONE, 'kbm', true);
    layer.sample();
    check('onPress with repeat follows key auto-repeat', steps === 3, `steps=${steps}`);
    check('repeated is false on the first frame', !layer.get('build.nudge').justPressed);
    layer.release('key:ArrowLeft');
    layer.sample();

    layer.press('key:KeyW', NONE, 'kbm');
    layer.press('key:KeyD', NONE, 'kbm');
    layer.sample();
    const m = layer.get('move');
    check('diagonal move is normalized', Math.abs(Math.hypot(m.axis.x, m.axis.y) - 1) < 1e-9);
}

console.log('look and settings');
{
    const layer = new ActionLayer();
    layer.addAnalog('mouse:move', 0.01, 0.02, 'kbm');
    layer.addAnalog('mouse:move', 0.01, 0, 'kbm');
    layer.sample();
    check('mouse motion accumulates into look', Math.abs(layer.get('look').axis.x - 0.02) < 1e-12);
    layer.sample();
    check('look resets each frame', layer.get('look').axis.x === 0 && !layer.get('look').pressed);

    layer.updateSettings({
        invertY: true,
        lookSensitivity: { ...layer.getSettings().lookSensitivity, kbm: 2 },
    });
    layer.addAnalog('mouse:move', 0.01, 0.01, 'kbm');
    layer.sample();
    const look = layer.get('look').axis;
    check('sensitivity scales look', Math.abs(look.x - 0.02) < 1e-12);
    check('invert Y flips pitch', Math.abs(look.y + 0.02) < 1e-12);

    layer.pushContext('menu');
    layer.addAnalog('mouse:move', 0.01, 0.01, 'kbm');
    layer.sample();
    check('no look under a menu', !layer.get('look').pressed);
}
{
    const layer = new ActionLayer();
    layer.updateSettings({ holdToggle: { sprint: 'toggle', sneak: 'hold' } });
    tap(layer, 'key:ShiftLeft', SHIFT);
    check('toggle sprint latches after release', layer.get('sprint').pressed);
    tap(layer, 'key:ShiftLeft', SHIFT);
    check('a second press unlatches', !layer.get('sprint').pressed);
}

console.log('rebinding and persistence');
{
    let saved: PersistedInput | null = null;
    const layer = new ActionLayer({}, (p) => (saved = p));
    const jumpRow = layer.listBindings().find((r) => r.binding.action === 'jump');
    check('jump is listed as rebindable', !!jumpRow);
    check(
        'analog and on-screen sources are not listed',
        layer
            .listBindings()
            .every((r) => !r.binding.source.startsWith('ui:') && r.binding.source !== 'mouse:move')
    );

    let captured: { source: string } | null = null;
    layer.captureNext((spec) => (captured = spec));
    const took = layer.press('key:KeyJ', NONE, 'kbm');
    check('capture takes the next key', took && captured?.source === 'key:KeyJ');
    const clashes = layer.rebind(jumpRow!.key, 'key:KeyJ');
    check('a free key reports no clash', clashes.length === 0);
    layer.release('key:KeyJ');
    layer.sample();

    layer.press('key:Space', NONE, 'kbm');
    layer.sample();
    check('the old key no longer jumps', !layer.get('jump').pressed);
    layer.release('key:Space');
    layer.sample();
    layer.press('key:KeyJ', NONE, 'kbm');
    layer.sample();
    check('the new key jumps', layer.get('jump').justPressed);
    layer.release('key:KeyJ');
    layer.sample();

    const clash = layer.rebind(
        layer.listBindings().find((r) => r.binding.action === 'dash')!.key,
        'key:KeyJ'
    );
    check(
        'binding onto a used key names the clash',
        clash.some((r) => r.binding.action === 'jump')
    );

    check('rebinds persist', !!saved && Object.values(saved!.overrides).includes('key:KeyJ'));
    const reloaded = new ActionLayer(saved!);
    reloaded.press('key:KeyJ', NONE, 'kbm');
    reloaded.sample();
    check(
        'a reload keeps the rebind',
        reloaded.get('jump').pressed && reloaded.get('dash').pressed
    );

    let cancelled: unknown = 'pending';
    layer.captureNext((spec) => (cancelled = spec));
    layer.press('key:Escape', NONE, 'kbm');
    check('Escape cancels a capture', cancelled === null && !layer.isCapturing());
    layer.release('key:Escape');

    let mod: { source: string; mods?: { shift?: boolean } } | null = null;
    layer.captureNext((spec) => (mod = spec));
    layer.press('key:ShiftRight', SHIFT, 'kbm');
    check('a lone modifier waits for the next key', mod === null);
    layer.release('key:ShiftRight');
    check('…and binds itself on release', mod?.source === 'key:ShiftRight' && !mod.mods);

    let combo: { source: string; mods?: { shift?: boolean } } | null = null;
    layer.captureNext((spec) => (combo = spec));
    layer.press('key:ShiftLeft', SHIFT, 'kbm');
    layer.press('key:KeyK', SHIFT, 'kbm');
    check('Shift+K captures as a combo', combo?.source === 'key:KeyK' && !!combo.mods?.shift);

    layer.resetBindings();
    layer.releaseAll();
    layer.sample();
    layer.press('key:Space', NONE, 'kbm');
    layer.sample();
    check('reset restores the defaults', layer.get('jump').justPressed);
    check('reset persists', !!saved && Object.keys(saved!.overrides).length === 0);
}

console.log('keyStates bridge');
{
    const off = bindInputFrame({
        look: null,
        isMenuOpen: () => menuOpen,
        isExploreHybrid: () => false,
        hud: {},
    });
    let menuOpen = false;
    input.press('key:Space', NONE, 'kbm');
    updateInputActions(false);
    check('a jump press sets keyStates.jump', keyStates.jump);
    keyStates.jump = false; // physics consumes it
    updateInputActions(false);
    check('holding does not set it again', !keyStates.jump);
    input.release('key:Space');
    updateInputActions(false);

    input.press('key:KeyW', NONE, 'kbm');
    input.press('key:ShiftLeft', SHIFT, 'kbm');
    updateInputActions(false);
    check('move and sprint reach keyStates', keyStates.forward && keyStates.sprint);
    updateInputActions(true);
    check('explore (orbit) pauses movement and abilities', !keyStates.forward && !keyStates.sprint);

    menuOpen = true;
    updateInputActions(false);
    check(
        'an open DOM menu pushes the menu context',
        input.isContextActive('menu') && !keyStates.forward
    );
    menuOpen = false;
    updateInputActions(false);
    check('closing it pops the context', !input.isContextActive('menu') && keyStates.forward);
    input.releaseAll();
    updateInputActions(false);
    check('release clears keyStates', !keyStates.forward && !keyStates.sprint);
    off();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
