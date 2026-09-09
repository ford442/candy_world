/**
 * Candy UI Kit — tiny DOM helpers.
 *
 * Deliberately not a framework: one function, no virtual DOM, no reactivity.
 */

export interface ElementSpec {
    /** Element id (optional; only set when provided). */
    id?: string;
    /** Class names; falsy entries are ignored so callers can inline conditions. */
    classes?: Array<string | false | null | undefined>;
    /** Attributes (ARIA included). `false`/`null`/`undefined` values are skipped. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
    /** Text content. */
    text?: string;
    /** Inline styles, for genuinely dynamic values only — prefer tokens/classes. */
    style?: Partial<CSSStyleDeclaration>;
    children?: Array<HTMLElement | null | undefined>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    spec: ElementSpec = {}
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);

    if (spec.id) node.id = spec.id;

    if (spec.classes) {
        for (const cls of spec.classes) {
            if (cls) node.classList.add(cls);
        }
    }

    if (spec.attrs) {
        for (const [name, value] of Object.entries(spec.attrs)) {
            if (value === null || value === undefined || value === false) continue;
            node.setAttribute(name, String(value));
        }
    }

    if (spec.text !== undefined) node.textContent = spec.text;

    if (spec.style) Object.assign(node.style, spec.style);

    if (spec.children) {
        for (const child of spec.children) {
            if (child) node.appendChild(child);
        }
    }

    return node;
}

let _idCounter = 0;

/** Stable-enough unique id for ARIA wiring (aria-describedby, etc.). */
export function nextId(prefix: string): string {
    _idCounter += 1;
    return `${prefix}-${_idCounter}`;
}
