/**
 * @file src/systems/composer/index.ts
 * @brief Entry of the lazy `composer` chunk: music stone playback and the pattern editor
 * (#1976 slice C).
 *
 * Loaded by `systems/composer-lazy.ts` once a music stone exists. Importing this module registers
 * the `grove-composer` frame system, which plays the nearest stone's pattern through the
 * generative soundtrack (`composer-playback.ts`).
 *
 * The composer composes existing systems rather than adding its own:
 * - sound: `GenerativeEngine` (voices, bus, visuals, note callbacks for music reactivity);
 * - cues: `fireScoreCue` (`systems/living-score.ts`), the Living Score's own events and unlocks;
 * - persistence: a `ComposeCommand` through the shared `editHistory`, so the pattern is a
 *   WorldDocument command, undoable, replayed on load and sent to co-editors like any edit;
 * - permission: `getBuildModeLock()`, the same lock that keeps build mode shut in a view-only
 *   shared world;
 * - voices: unlocks and finished Melodies (`composer-voices.ts`).
 */

import type * as THREE from 'three';
import { BIOME_PROFILES } from '../../audio/generative/biome-profiles.ts';
import type { GenerativeEngine } from '../../audio/generative/generative-engine.ts';
import { SCALES } from '../../audio/generative/scales.ts';
import { authoredNote } from '../../audio/generative/sequencer.ts';
import { audioSystemRef } from '../../core/game-loop-core.ts';
import { registerSystem } from '../../core/scheduler/frame-scheduler.ts';
import { announce } from '../../ui/announcer.ts';
import {
    groveNoteCount,
    resolveStonePattern,
    withStonePattern,
    type GrovePattern,
} from '../../world/document/grove-pattern.ts';
import { animatedFoliage, entities } from '../../world/state.ts';
import { editHistory, type WorldCommand } from '../authoring/edit-history.ts';
import { ComposeCommand } from '../authoring/world-commands.ts';
import { getBuildModeLock } from '../build-mode-state.ts';
import { snapshotEntity } from '../entity-snapshot/entity-snapshot-core.ts';
import { fireScoreCue, initLivingScore, listScoreCues } from '../living-score.ts';
import { readMelodyProgress } from '../melody-progress.ts';
import { setComposerOpen } from '../music-stone-hooks.ts';
import { UNLOCK_DEFINITIONS, unlockSystem } from '../unlocks.ts';
import './composer.css';
import { ComposerPlayback, viewOfStone, type StoneView } from './composer-playback.ts';
import { mountComposerEditor, type ComposerCueOption, type ComposerEditor } from './composer-ui.ts';
import { availableVoices } from './composer-voices.ts';

/** How often the playback system looks for the nearest stone (s). */
const SCAN_INTERVAL = 0.25;

export const playback = new ComposerPlayback({ fireCue: fireScoreCue });

let _editor: ComposerEditor | null = null;
let _editorStone: string | null = null;
let _editorSavedRaw: unknown = undefined;
/** Unsaved drafts per stone id, kept across closing and reopening the editor. */
const _drafts = new Map<string, GrovePattern>();

function engine(): GenerativeEngine | null {
    return audioSystemRef?.generativeEngine ?? null;
}

function isLive(obj: THREE.Object3D): boolean {
    return obj.userData.isMusicStone === true && obj.parent !== null;
}

function* liveStones(): Iterable<StoneView> {
    for (let i = 0; i < animatedFoliage.length; i++) {
        const obj = animatedFoliage[i] as THREE.Object3D;
        if (!isLive(obj)) continue;
        const view = viewOfStone(obj);
        if (view) yield view;
    }
}

/** The live object for a stone id (a compose re-places the stone, so the object changes). */
function liveStone(id: string): THREE.Object3D | null {
    for (const obj of entities.byKey(id)) if (isLive(obj)) return obj;
    return null;
}

function scaleName(scale: readonly number[]): string {
    for (const [name, steps] of Object.entries(SCALES)) if (steps === scale) return name;
    return 'scale';
}

function cueOptions(pattern: GrovePattern): ComposerCueOption[] {
    const out: ComposerCueOption[] = [];
    const seen = new Set<string>();
    for (const cue of listScoreCues()) {
        seen.add(cue.id);
        const locked = cue.unlock && !unlockSystem.isUnlocked(cue.unlock);
        const needs = cue.unlock ? (UNLOCK_DEFINITIONS[cue.unlock]?.name ?? cue.unlock) : '';
        out.push({ id: cue.id, label: locked ? `${cue.id} (needs ${needs})` : cue.id });
    }
    // A cue this build doesn't know (another build's, or not loaded yet) stays bound and visible.
    for (const row of pattern.channels) {
        if (row.cue && !seen.has(row.cue)) {
            seen.add(row.cue);
            out.push({ id: row.cue, label: `${row.cue} (unknown here)` });
        }
    }
    return out;
}

function isComposeOf(cmd: WorldCommand | undefined, id: string): boolean {
    return cmd instanceof ComposeCommand && cmd.to.id === id;
}

function currentPattern(id: string): GrovePattern | null {
    const obj = liveStone(id);
    return obj ? resolveStonePattern(id, obj.userData.grovePattern) : null;
}

function saveTo(id: string, pattern: GrovePattern): { ok: boolean; message: string } {
    const lock = getBuildModeLock();
    if (lock) return { ok: false, message: lock };
    const obj = liveStone(id);
    if (!obj) return { ok: false, message: 'This music stone is no longer here' };
    const from = snapshotEntity(obj, { id, includeLegacyHash: false });
    if (!from) return { ok: false, message: "This stone can't hold a pattern" };
    let command: ComposeCommand;
    try {
        command = new ComposeCommand(from, withStonePattern(from, pattern));
    } catch (err) {
        console.warn('[Composer] Refused a pattern:', err);
        return { ok: false, message: "Couldn't save: the pattern isn't valid" };
    }
    if (!editHistory.execute(command)) {
        return { ok: false, message: "Couldn't save the pattern" };
    }
    _drafts.delete(id);
    _editorSavedRaw = liveStone(id)?.userData.grovePattern;
    const notes = groveNoteCount(pattern);
    return { ok: true, message: `Saved: ${notes} ${notes === 1 ? 'note' : 'notes'} on this stone` };
}

function step(kind: 'undo' | 'redo', id: string): GrovePattern | null {
    const top = kind === 'undo' ? editHistory.peekUndo() : editHistory.peekRedo();
    if (!isComposeOf(top, id)) return null;
    const ok = kind === 'undo' ? editHistory.undo() : editHistory.redo();
    if (!ok) return null;
    _editorSavedRaw = liveStone(id)?.userData.grovePattern;
    return currentPattern(id);
}

function auditionBlocked(): string | null {
    const audio = audioSystemRef;
    if (!audio) return 'The soundtrack has not started yet';
    if (audio.musicSourceMode !== 'generative') {
        return 'Audition plays through the generative soundtrack; switch the music back to it to listen';
    }
    if (!audio.isGenerativeActive()) {
        audio.enableGenerativeMode().catch((err: unknown) => {
            console.warn('[Composer] Could not start the generative soundtrack:', err);
        });
    }
    return null;
}

/** Open the pattern editor on `stone` (from its interaction). */
export function openComposerFor(stone: THREE.Object3D): void {
    if (_editor?.isOpen()) return;
    const view = viewOfStone(stone);
    if (!view) return;
    const id = view.id;
    _editor?.destroy();

    const eng = engine();
    const profile = eng?.getActiveProfile() ?? BIOME_PROFILES.global;
    const melodies = new Set(readMelodyProgress().completed);
    const voices = availableVoices({
        isUnlocked: (u) => unlockSystem.isUnlocked(u),
        completedMelodies: melodies,
    });

    _editorStone = id;
    _editorSavedRaw = stone.userData.grovePattern;
    _editor = mountComposerEditor({
        stoneId: id,
        pattern: view.pattern,
        draft: _drafts.get(id),
        voices,
        readOnly: getBuildModeLock(),
        cues: cueOptions(view.pattern),
        keyLabel: `${profile.root} ${scaleName(profile.scale)}`,
        noteName: (ch, degree) => authoredNote(profile, ch, degree),
        auditionBlocked,
        onAudition: (pattern) => playback.setAudition(pattern, id),
        onPreview: (ch, degree) => void engine()?.previewNote(ch, degree),
        onSave: (pattern) => saveTo(id, pattern),
        undo: () => step('undo', id),
        redo: () => step('redo', id),
        canUndo: () => isComposeOf(editHistory.peekUndo(), id),
        canRedo: () => isComposeOf(editHistory.peekRedo(), id),
        announce: (message) => announce(message, 'polite'),
        onClose: () => {
            const editor = _editor;
            if (editor?.dirty()) _drafts.set(id, editor.draft());
            else _drafts.delete(id);
            setComposerOpen(false);
            _editorStone = null;
        },
    });
    setComposerOpen(true);
    // The keys need the mouse: release pointer lock. `isComposerOpen()` keeps the pause menu down.
    if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
    _editor.open();
    announce(
        getBuildModeLock()
            ? 'Music stone: view only. You can audition, not save.'
            : 'Music stone composer open',
        'polite'
    );
}

/** Keep an open editor in step with its stone: a peer's compose, an undo elsewhere, a removal. */
function syncEditor(): void {
    const editor = _editor;
    const id = _editorStone;
    if (!editor?.isOpen() || !id) return;
    const obj = liveStone(id);
    if (!obj) {
        editor.close();
        announce('The music stone was removed', 'polite');
        return;
    }
    const raw: unknown = obj.userData.grovePattern;
    if (raw === _editorSavedRaw) return;
    _editorSavedRaw = raw;
    editor.syncSaved(resolveStonePattern(id, raw));
}

let _acc = SCAN_INTERVAL;
registerSystem({
    id: 'grove-composer',
    phase: 'audio',
    budgetMs: 0.3,
    update(ctx) {
        playback.attach(engine());
        playback.settle(ctx.dt);
        _acc += ctx.dt;
        if (_acc < SCAN_INTERVAL) return;
        _acc = 0;
        playback.update(ctx.player.position, liveStones());
        syncEditor();
    },
    dispose() {
        playback.dispose();
    },
});

void initLivingScore();
