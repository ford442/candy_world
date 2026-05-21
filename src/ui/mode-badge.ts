export type WorldMode = 'CORE' | 'FULL';

let modeBadge: HTMLDivElement | null = null;

export function showModeBadge(mode: WorldMode) {
  if (modeBadge) {
    modeBadge.remove();
  }

  modeBadge = document.createElement('div');
  modeBadge.id = 'mode-badge';

  Object.assign(modeBadge.style, {
    position: 'absolute',
    top: '12px',
    right: '12px',
    padding: '6px 12px',
    borderRadius: '999px',
    fontSize: '12px',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    fontWeight: '700',
    letterSpacing: '0.4px',
    zIndex: '10000',
    pointerEvents: 'none',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.12)',
    transition: 'transform 0.2s ease, opacity 0.2s ease',
    opacity: '0.98',
  });

  if (mode === 'CORE') {
    modeBadge.style.background = 'rgba(255, 158, 205, 0.92)';
    modeBadge.style.color = '#2b0f1c';
    modeBadge.innerText = 'CORE MODE';
  } else {
    modeBadge.style.background = 'rgba(125, 211, 252, 0.92)';
    modeBadge.style.color = '#0f2a3a';
    modeBadge.innerText = 'FULL MODE';
  }

  document.body.appendChild(modeBadge);
}

export function removeModeBadge() {
  if (modeBadge) {
    modeBadge.remove();
    modeBadge = null;
  }
}
