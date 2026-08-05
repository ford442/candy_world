import type * as THREE from 'three';
import { initExploreCamera, resolveExploreVariant } from '../../camera-modes.ts';
import { keyStates } from '../input-types.ts';
import type { InputSession } from './session.ts';

export function resetMovementInput(): void {
    keyStates.forward = false;
    keyStates.backward = false;
    keyStates.left = false;
    keyStates.right = false;
    keyStates.jump = false;
    keyStates.sneak = false;
    keyStates.sprint = false;
    keyStates.dash = false;
    keyStates.action = false;
    keyStates.phase = false;
    keyStates.clap = false;
    keyStates.strike = false;
    keyStates.dance = false;
    keyStates.dodgeRoll = false;
}

export function hideInstructionsImmediately(session: InputSession): void {
    if (!session.instructions) return;
    session.instructions.style.display = 'none';
    session.instructions.style.opacity = '0';
    session.instructions.style.backdropFilter = 'blur(0px)';
}

export function initExploreCameraForSession(session: InputSession): void {
    session.exploreVariant = resolveExploreVariant();
    session.exploreCamera = initExploreCamera({
        camera: session.camera as THREE.PerspectiveCamera,
        canvas: session.canvas ?? (document.body as unknown as HTMLCanvasElement),
        controls: session.controls,
        variant: session.exploreVariant,
        onResetInput: resetMovementInput,
        onHidePauseMenu: () => hideInstructionsImmediately(session),
    });
}

export function isInteractiveTarget(eventTarget: EventTarget | null): boolean {
    if (!(eventTarget instanceof HTMLElement)) return false;
    return !!eventTarget.closest(
        'button, input, select, textarea, a, label, [role="button"], [role="dialog"], #ability-hud, #playlist-overlay, #playlist-backdrop, #dpad-controls, #instructions, #mode-select'
    );
}

export function setPausedTitle(session: InputSession, paused: boolean): void {
    const title = session.instructions ? session.instructions.querySelector('h1') : null;
    if (title) {
        title.innerHTML = paused
            ? 'Dream Paused <span aria-hidden="true">⏸️</span>'
            : '<span aria-hidden="true">🍭</span> Candy World';
    }
}

export function setStartButtonResumeLabel(session: InputSession): void {
    if (session.startButton) {
        session.startButton.innerHTML =
            'Resume the Dream <span aria-hidden="true">✨</span> <span class="key-badge" aria-hidden="true">Enter</span>';
    }
}

export function setStartButtonEnterLabel(session: InputSession): void {
    if (session.startButton) {
        session.startButton.innerHTML =
            'Enter the Dream <span aria-hidden="true">🍭</span> <span class="key-badge" aria-hidden="true">Enter</span>';
    }
}

export function disableExploreMode(session: InputSession, relock = true): void {
    session.exploreCamera.exitToFirstPerson(relock);
}

export async function enableExploreMode(
    session: InputSession,
    options?: { temporary?: boolean; fromToggle?: boolean }
): Promise<void> {
    await session.exploreCamera.enter(options);
}
