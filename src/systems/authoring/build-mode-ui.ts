/**
 * @file src/systems/authoring/build-mode-ui.ts
 * @brief Build mode HUD: tool bar, category tabs, palette strip, paint swatches, status line.
 *
 * Every control is a real button, so the strip works with a free cursor,
 * touch, and keyboard focus; while the pointer is locked the same actions
 * have keys (listed in the help line).
 */

import {
    CANDY_PAINT_PALETTE,
    PALETTE_CATEGORIES,
    type PaletteCategory,
    type PaletteEntry,
} from './palette.ts';

export type BuildTool = 'place' | 'select' | 'paint' | 'remove';

export const TOOLS: ReadonlyArray<{ id: BuildTool; label: string; icon: string; key: string }> = [
    { id: 'place', label: 'Place', icon: '🧁', key: '1' },
    { id: 'select', label: 'Select & move', icon: '👆', key: '2' },
    { id: 'paint', label: 'Paint', icon: '🎨', key: '3' },
    { id: 'remove', label: 'Remove', icon: '🧹', key: '4' },
];

export interface BuildModeUiState {
    tool: BuildTool;
    category: PaletteCategory;
    entries: readonly PaletteEntry[];
    selectedType: string;
    paintIndex: number;
}

export interface BuildModeUiCallbacks {
    onTool(tool: BuildTool): void;
    onCategory(category: PaletteCategory): void;
    onEntry(type: string): void;
    onPaint(index: number): void;
}

const STYLE_ID = 'build-mode-styles';
const CSS = `
#build-mode-panel {
    position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
    max-width: min(920px, calc(100vw - 32px)); z-index: 9000;
    display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;
    background: rgba(255, 240, 248, 0.92); color: #4a2c4f;
    border: 2px solid #ffb6d9; border-radius: 18px;
    box-shadow: 0 6px 24px rgba(255, 105, 180, 0.25);
    font: 13px/1.3 system-ui, sans-serif; pointer-events: auto;
}
#build-mode-panel[hidden], #build-mode-panel [hidden] { display: none; }
.build-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.build-row--strip { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 2px; }
.build-btn {
    border: 2px solid transparent; border-radius: 12px; background: #fff;
    color: inherit; padding: 4px 8px; font: inherit; cursor: pointer;
    display: inline-flex; gap: 4px; align-items: center; white-space: nowrap;
}
.build-btn:hover { border-color: #ffd1dc; }
.build-btn:focus-visible { outline: 3px solid #87cefa; outline-offset: 1px; }
.build-btn[aria-pressed="true"], .build-btn[aria-selected="true"] {
    border-color: #ff69b4; background: #ffe4f1;
}
.build-key { font-size: 11px; opacity: 0.7; }
.build-swatch { width: 26px; height: 26px; padding: 0; border-radius: 50%; }
.build-swatch[aria-checked="true"] { border-color: #fff; box-shadow: 0 0 0 3px #ff69b4; }
.build-status { font-weight: 600; min-height: 1.3em; }
.build-help { font-size: 11px; opacity: 0.75; }
@media (prefers-color-scheme: dark) {
    #build-mode-panel { background: rgba(40, 24, 52, 0.92); color: #ffe4f1; border-color: #a35d8c; }
    .build-btn { background: #2d1c3a; }
    .build-btn[aria-pressed="true"], .build-btn[aria-selected="true"] { background: #5a2d55; }
}
`;

function button(label: string, attrs: Record<string, string> = {}): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'build-btn';
    b.innerHTML = label;
    for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
    return b;
}

export class BuildModeUi {
    readonly root: HTMLElement;
    private readonly tools: HTMLElement;
    private readonly cats: HTMLElement;
    private readonly strip: HTMLElement;
    private readonly swatches: HTMLElement;
    private readonly status: HTMLElement;
    private readonly gizmoBar: HTMLElement;
    private lastStatus = '';

    constructor(
        private readonly callbacks: BuildModeUiCallbacks,
        gizmoCallbacks: { onMode(mode: 'translate' | 'rotate' | 'scale'): void; onDone(): void }
    ) {
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            document.head.appendChild(style);
        }

        this.root = document.createElement('div');
        this.root.id = 'build-mode-panel';
        this.root.setAttribute('role', 'region');
        this.root.setAttribute('aria-label', 'Build mode');
        this.root.hidden = true;

        this.tools = document.createElement('div');
        this.tools.className = 'build-row';
        this.tools.setAttribute('role', 'toolbar');
        this.tools.setAttribute('aria-label', 'Build tools');
        for (const tool of TOOLS) {
            const b = button(
                `<span aria-hidden="true">${tool.icon}</span>${tool.label} <span class="build-key">${tool.key}</span>`,
                { 'data-tool': tool.id, 'aria-pressed': 'false', 'aria-keyshortcuts': tool.key }
            );
            b.addEventListener('click', () => this.callbacks.onTool(tool.id));
            this.tools.appendChild(b);
        }

        this.cats = document.createElement('div');
        this.cats.className = 'build-row';
        this.cats.setAttribute('role', 'tablist');
        this.cats.setAttribute('aria-label', 'Palette categories');
        for (const cat of PALETTE_CATEGORIES) {
            const b = button(`<span aria-hidden="true">${cat.icon}</span>${cat.label}`, {
                role: 'tab',
                'data-category': cat.id,
                'aria-selected': 'false',
            });
            b.addEventListener('click', () => this.callbacks.onCategory(cat.id));
            this.cats.appendChild(b);
        }

        this.strip = document.createElement('div');
        this.strip.className = 'build-row build-row--strip';
        this.strip.setAttribute('role', 'listbox');
        this.strip.setAttribute('aria-label', 'Pieces');

        this.swatches = document.createElement('div');
        this.swatches.className = 'build-row';
        this.swatches.setAttribute('role', 'radiogroup');
        this.swatches.setAttribute('aria-label', 'Paint colours');
        CANDY_PAINT_PALETTE.forEach((c, i) => {
            const b = button('', {
                role: 'radio',
                'aria-checked': 'false',
                'aria-label': c.name,
                title: c.name,
                'data-paint': String(i),
            });
            b.classList.add('build-swatch');
            b.style.background = `#${c.hex.toString(16).padStart(6, '0')}`;
            b.addEventListener('click', () => this.callbacks.onPaint(i));
            this.swatches.appendChild(b);
        });

        this.gizmoBar = document.createElement('div');
        this.gizmoBar.className = 'build-row';
        this.gizmoBar.setAttribute('role', 'toolbar');
        this.gizmoBar.setAttribute('aria-label', 'Gizmo');
        this.gizmoBar.hidden = true;
        const modes: Array<['translate' | 'rotate' | 'scale', string, string]> = [
            ['translate', 'Move', 'T'],
            ['rotate', 'Rotate', 'Y'],
            ['scale', 'Scale', 'U'],
        ];
        for (const [mode, label, key] of modes) {
            const b = button(`${label} <span class="build-key">${key}</span>`, {
                'data-gizmo': mode,
                'aria-pressed': 'false',
                'aria-keyshortcuts': key,
            });
            b.addEventListener('click', () => gizmoCallbacks.onMode(mode));
            this.gizmoBar.appendChild(b);
        }
        const done = button('Done <span class="build-key">Enter</span>', {
            'aria-keyshortcuts': 'Enter',
        });
        done.addEventListener('click', () => gizmoCallbacks.onDone());
        this.gizmoBar.appendChild(done);

        // Follows the cursor every other frame, so it is not a live region:
        // edits and refusals are announced through ui/announcer.ts instead.
        this.status = document.createElement('div');
        this.status.className = 'build-status';

        const help = document.createElement('div');
        help.className = 'build-help';
        help.textContent =
            'Click: use tool · Wheel/R: rotate · Shift+Wheel or +/−: scale · [ ]: piece · Shift+[ ]: category · ' +
            'G: snap · Arrows: nudge cursor, Enter: act · M: move selection · F: gizmo · C: colour · ' +
            'Del: remove · Ctrl+Z / Ctrl+Shift+Z: undo / redo · B: exit';

        this.root.append(
            this.tools,
            this.cats,
            this.strip,
            this.swatches,
            this.gizmoBar,
            this.status,
            help
        );
        document.body.appendChild(this.root);
    }

    contains(node: EventTarget | null): boolean {
        return node instanceof Node && this.root.contains(node);
    }

    setVisible(visible: boolean): void {
        this.root.hidden = !visible;
    }

    render(state: BuildModeUiState): void {
        this.tools.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => {
            b.setAttribute('aria-pressed', String(b.dataset.tool === state.tool));
        });
        this.cats.querySelectorAll<HTMLElement>('[data-category]').forEach((b) => {
            b.setAttribute('aria-selected', String(b.dataset.category === state.category));
        });
        this.strip.replaceChildren(
            ...state.entries
                .filter((e) => e.category === state.category)
                .map((e) => {
                    const b = button(`<span aria-hidden="true">${e.icon}</span>${e.label}`, {
                        role: 'option',
                        'data-type': e.type,
                        'aria-selected': String(e.type === state.selectedType),
                    });
                    b.addEventListener('click', () => this.callbacks.onEntry(e.type));
                    return b;
                })
        );
        this.swatches.hidden = state.tool !== 'paint';
        this.swatches.querySelectorAll<HTMLElement>('[data-paint]').forEach((b) => {
            b.setAttribute('aria-checked', String(Number(b.dataset.paint) === state.paintIndex));
        });
    }

    setGizmo(open: boolean, mode: 'translate' | 'rotate' | 'scale'): void {
        this.gizmoBar.hidden = !open;
        this.gizmoBar.querySelectorAll<HTMLElement>('[data-gizmo]').forEach((b) => {
            b.setAttribute('aria-pressed', String(b.dataset.gizmo === mode));
        });
    }

    /** Only touches the DOM when the text changes (called every other frame). */
    setStatus(text: string): void {
        if (text === this.lastStatus) return;
        this.lastStatus = text;
        this.status.textContent = text;
    }

    dispose(): void {
        this.root.remove();
    }
}
