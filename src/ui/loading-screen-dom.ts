import type { LoadingPhase, LoadingScreenOptions } from './loading-screen-types.ts';

export interface LoadingScreenElements {
    container: HTMLElement;
    overlay: HTMLElement;
    spinner: HTMLElement;
    progressBar: HTMLElement;
    progressFill: HTMLElement;
    percentageText: HTMLElement;
    taskText: HTMLElement;
    timeText: HTMLElement | null;
    skipButton: HTMLButtonElement | null;
}

export function createDeferredIndicator(): HTMLElement {
    const indicator = document.createElement('div');
    indicator.id = 'candy-deferred-indicator';
    indicator.className = 'deferred-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.innerHTML = '<span class="deferred-spinner"></span><span class="deferred-text">Populating...</span><span class="deferred-count" aria-hidden="true"></span><span class="deferred-eta" aria-hidden="true"></span><span class="deferred-fail" aria-hidden="true" role="button" tabindex="0" style="display:none;color:#ff6b6b;font-weight:600;margin-left:6px;cursor:pointer;">⚠ <span class="fail-count">0</span></span><span class="deferred-bar"><span class="deferred-bar-fill"></span></span>';
    document.body.appendChild(indicator);
    return indicator;
}

export function addFatalErrorReloadButton(container: HTMLElement): void {
    const existing = container.querySelector('.fatal-error-reload');
    if (existing) return;

    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'fatal-error-reload skip-button';
    reloadBtn.setAttribute('aria-label', 'Reload page to try again');
    reloadBtn.innerHTML = '<span aria-hidden="true">🔄</span> Reload Page';
    reloadBtn.addEventListener('click', () => window.location.reload());
    reloadBtn.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            reloadBtn.classList.add('keyboard-active');
            setTimeout(() => reloadBtn.classList.remove('keyboard-active'), 150);
        }
    });
    container.querySelector('.loading-content')?.appendChild(reloadBtn);
}

export function wireSkipButton(skipButton: HTMLButtonElement, onSkip: () => void): void {
    skipButton.addEventListener('click', onSkip);
    skipButton.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            skipButton.classList.add('keyboard-active');
            setTimeout(() => skipButton.classList.remove('keyboard-active'), 150);
        }
    });
}

export function createLoadingScreenDOM(
    options: Required<Pick<LoadingScreenOptions, 'theme' | 'showEstimatedTime' | 'allowSkipDeferred'>>,
    phases: LoadingPhase[],
    onSkip: () => void
): LoadingScreenElements {
    const overlay = document.createElement('div');
    overlay.id = 'candy-loading-overlay';
    overlay.className = `loading-overlay theme-${options.theme}`;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const container = document.createElement('div');
    container.id = 'candy-loading-screen';
    container.className = `loading-screen theme-${options.theme}`;
    container.setAttribute('role', 'progressbar');
    container.setAttribute('aria-valuemin', '0');
    container.setAttribute('aria-valuemax', '100');
    container.setAttribute('aria-valuenow', '0');
    container.setAttribute('aria-valuetext', 'Initializing...');
    container.setAttribute('aria-label', 'Game loading progress');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');

    const content = document.createElement('div');
    content.className = 'loading-content';

    const title = document.createElement('h1');
    title.className = 'loading-title';
    title.innerHTML = '🍭 Candy World <span class="loading-dots">...</span>';
    content.appendChild(title);

    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    content.appendChild(spinner);

    const progressSection = document.createElement('div');
    progressSection.className = 'progress-section';

    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';

    const progressFill = document.createElement('div');
    progressFill.className = 'progress-fill';
    progressFill.style.transform = 'scaleX(0)';
    progressFill.style.transformOrigin = 'left';
    progressBar.appendChild(progressFill);

    const progressDetails = document.createElement('div');
    progressDetails.className = 'progress-details';

    const percentageText = document.createElement('span');
    percentageText.className = 'progress-percentage';
    percentageText.textContent = '0%';

    const taskText = document.createElement('span');
    taskText.className = 'progress-task';
    taskText.textContent = 'Initializing...';

    progressDetails.appendChild(percentageText);
    progressDetails.appendChild(taskText);

    progressSection.appendChild(progressBar);
    progressSection.appendChild(progressDetails);
    content.appendChild(progressSection);

    let timeText: HTMLElement | null = null;
    if (options.showEstimatedTime) {
        timeText = document.createElement('div');
        timeText.className = 'time-remaining';
        timeText.textContent = 'Calculating time...';
        content.appendChild(timeText);
    }

    let skipButton: HTMLButtonElement | null = null;
    if (options.allowSkipDeferred) {
        skipButton = document.createElement('button');
        skipButton.className = 'skip-button';
        skipButton.innerHTML = '<span aria-hidden="true">⏭️ </span>Skip Optional Content <span class="key-badge">Space</span>';
        skipButton.style.display = 'none';
        wireSkipButton(skipButton, onSkip);
        content.appendChild(skipButton);
    }

    const statusIndicators = document.createElement('div');
    statusIndicators.className = 'status-indicators';

    phases.forEach((phase, index) => {
        const indicator = document.createElement('div');
        indicator.className = 'phase-indicator';
        indicator.dataset.phaseId = phase.id;
        indicator.dataset.phaseIndex = index.toString();

        const dot = document.createElement('span');
        dot.className = 'phase-dot';

        const label = document.createElement('span');
        label.className = 'phase-label';
        label.textContent = phase.name;

        indicator.appendChild(dot);
        indicator.appendChild(label);
        statusIndicators.appendChild(indicator);
    });

    content.appendChild(statusIndicators);

    container.appendChild(content);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    return { container, overlay, spinner, progressBar, progressFill, percentageText, taskText, timeText, skipButton };
}
