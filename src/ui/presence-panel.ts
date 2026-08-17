/**
 * Start-screen opt-in UI for shared presence rooms.
 */

import { FEATURE_FLAGS } from '../core/config.ts';
import {
    isPresenceBackendConfigured,
    isPresenceOptedIn,
    setPresenceOptIn,
} from '../systems/net/presence.ts';
import { trapFocusInside } from '../utils/interaction-utils.ts';
import { applyWorldSeed } from '../utils/seeded-random.ts';
import { yieldToPaint } from '../utils/yield-to-paint.ts';
import {
    buildShareUrl,
    ensureSeedInUrl,
    getWorldSeed,
    hasExplicitSeedInURL,
} from '../world/world-seed.ts';

const PRESENCE_UI_ID = 'presence-opt-in';

export function installPresenceStartScreenUI(): void {
    if (!FEATURE_FLAGS.presence) return;

    const modeSelect = document.getElementById('mode-select');
    if (!modeSelect || document.getElementById(PRESENCE_UI_ID)) return;

    const configured = isPresenceBackendConfigured();
    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'dialog');
    wrapper.setAttribute('aria-modal', 'true');
    wrapper.setAttribute('tabindex', '-1');
    wrapper.setAttribute('aria-labelledby', 'presence-title');
    wrapper.id = PRESENCE_UI_ID;
    wrapper.style.cssText =
        'margin:16px auto 0;max-width:420px;padding:12px 14px;border-radius:14px;' +
        'background:rgba(255,255,255,0.35);text-align:left;font-size:0.85rem;';

    const title = document.createElement('h2');
    title.id = 'presence-title';
    title.style.cssText = 'margin:0 0 8px;font-weight:600;opacity:0.95;';
    title.textContent = '🫧 Shared presence (opt-in)';

    const label = document.createElement('div');
    label.style.cssText = 'display:flex;align-items:flex-start;gap:8px;cursor:pointer;';
    label.id = 'presence-join-wrapper';

    const checkbox = document.createElement('button');
    checkbox.type = 'button';
    checkbox.setAttribute('role', 'switch');
    checkbox.id = 'presence-join-checkbox';

    const isInitiallyChecked = isPresenceOptedIn() || new URLSearchParams(location.search).has('presence');
    checkbox.setAttribute('aria-checked', String(isInitiallyChecked));
    if (!configured) {
        checkbox.setAttribute('aria-disabled', 'true');
    }

    // Switch styling matching memory guidelines
    checkbox.style.cssText = 'margin-top:3px;appearance:none;width:36px;height:20px;background:rgba(255,255,255,0.5);border-radius:10px;position:relative;cursor:pointer;border:2px solid transparent;transition:all 0.2s;flex-shrink:0;';

    // Switch handle
    const handle = document.createElement('span');
    handle.style.cssText = 'position:absolute;top:2px;left:2px;width:12px;height:12px;background:#fff;border-radius:50%;transition:transform 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.2);';
    if (isInitiallyChecked) {
        checkbox.style.background = '#FF6B6B';
        handle.style.transform = 'translateX(16px)';
    }
    checkbox.appendChild(handle);

    // Focus visible outline via injected style if needed, but we'll use CSS class or inline
    checkbox.addEventListener('focus', () => {
        checkbox.style.outline = '3px solid #ff69b4';
        checkbox.style.outlineOffset = '2px';
    });
    checkbox.addEventListener('blur', () => {
        checkbox.style.outline = 'none';
    });

    const copy = document.createElement('span');
    copy.innerHTML = configured
        ? 'Join a shared room and see other explorers (camera position only). No chat, no accounts.'
        : 'Supabase not configured — set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to enable.';
    copy.id = 'presence-desc';
    checkbox.setAttribute('aria-describedby', 'presence-desc');

    label.appendChild(checkbox);
    label.appendChild(copy);

    const seedRow = document.createElement('div');
    seedRow.style.cssText = 'margin-top:10px;opacity:0.9;';
    const seedLabel = document.createElement('span');
    seedLabel.textContent = 'World seed: ';
    const seedValue = document.createElement('code');
    seedValue.id = 'presence-seed-display';
    seedValue.textContent = String(getWorldSeed());
    seedRow.appendChild(seedLabel);
    seedRow.appendChild(seedValue);

    const linkRow = document.createElement('div');
    linkRow.style.cssText =
        'margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;';

    const shareInput = document.createElement('input');
    shareInput.type = 'text';
    shareInput.readOnly = true;
    shareInput.id = 'presence-share-link';
    shareInput.value = buildShareUrl(getWorldSeed(), { presence: isInitiallyChecked });
    shareInput.style.cssText =
        'flex:1;min-width:180px;font-size:0.75rem;padding:6px 8px;border-radius:8px;border:1px solid rgba(0,0,0,0.1);';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'toggle-button';
    copyBtn.textContent = 'Copy link';
    copyBtn.style.fontSize = '0.75rem';

    linkRow.appendChild(shareInput);
    linkRow.appendChild(copyBtn);

    const note = document.createElement('p');
    note.style.cssText = 'margin:8px 0 0;font-size:0.75rem;opacity:0.8;';
    note.textContent =
        'Friends must use the same seed link for identical terrain. Joining applies ?seed= before world generation.';

    const refreshShare = (): void => {
        const seed = getWorldSeed();
        seedValue.textContent = String(seed);
        const isChecked = checkbox.getAttribute('aria-checked') === 'true';
        shareInput.value = buildShareUrl(seed, { presence: isChecked });
    };

    const toggleCheckbox = () => {
        if (!configured) return;
        const enabled = checkbox.getAttribute('aria-checked') !== 'true';
        checkbox.setAttribute('aria-checked', String(enabled));

        if (enabled) {
            checkbox.style.background = '#FF6B6B';
            handle.style.transform = 'translateX(16px)';
        } else {
            checkbox.style.background = 'rgba(255,255,255,0.5)';
            handle.style.transform = 'translateX(0)';
        }

        setPresenceOptIn(enabled);
        if (enabled) {
            const seed = getWorldSeed();
            applyWorldSeed(seed);
            ensureSeedInUrl(seed);
            if (!hasExplicitSeedInURL()) {
                const url = new URL(location.href);
                url.searchParams.set('seed', String(seed));
                if (enabled) url.searchParams.set('presence', '1');
                location.replace(url.toString());
                return;
            }
        } else {
            const url = new URL(location.href);
            url.searchParams.delete('presence');
            history.replaceState({}, '', url.toString());
        }
        refreshShare();
    };

    checkbox.addEventListener('click', (e) => {
        e.preventDefault();
        toggleCheckbox();
    });

    label.addEventListener('click', (e) => {
        if (e.target !== checkbox) {
            e.preventDefault();
            toggleCheckbox();
        }
    });

    // Keyboard active state matching tactile feedback rule
    checkbox.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            checkbox.classList.add('keyboard-active');
            toggleCheckbox();
        }
    });
    checkbox.addEventListener('keyup', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
            checkbox.classList.remove('keyboard-active');
        }
    });
    checkbox.addEventListener('blur', () => {
        checkbox.classList.remove('keyboard-active');
    });

    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(shareInput.value);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.textContent = 'Copy link';
            }, 1500);
        } catch {
            shareInput.select();
        }
    });

    wrapper.appendChild(title);
    wrapper.appendChild(label);
    wrapper.appendChild(seedRow);
    wrapper.appendChild(linkRow);
    wrapper.appendChild(note);

    const privacyRow = document.createElement('div');
    privacyRow.style.cssText = 'margin-top:10px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;';
    const hideSelfBtn = document.createElement('button');
    hideSelfBtn.type = 'button';
    hideSelfBtn.className = 'toggle-button';
    hideSelfBtn.textContent = 'Hide my avatar';
    hideSelfBtn.style.fontSize = '0.75rem';
    hideSelfBtn.addEventListener('click', async () => {
        const { presenceSystem } = await import('../systems/net/presence.ts');
        const next = !presenceSystem.hideSelf;
        presenceSystem.setHideSelf(next);
        hideSelfBtn.textContent = next ? 'Show my avatar' : 'Hide my avatar';
        hideSelfBtn.setAttribute('aria-pressed', String(next));
    });
    privacyRow.appendChild(hideSelfBtn);
    wrapper.appendChild(privacyRow);

    const peerList = document.createElement('ul');
    peerList.id = 'presence-peer-list';
    peerList.setAttribute('role', 'list');
    peerList.setAttribute('aria-label', 'Explorers in room');
    peerList.setAttribute('aria-live', 'polite');
    peerList.style.cssText =
        'margin:10px 0 0;padding:0;list-style:none;font-size:0.75rem;max-height:120px;overflow:auto;';
    wrapper.appendChild(peerList);

    const peerStatus = document.createElement('div');
    peerStatus.id = 'presence-peer-status';
    peerStatus.className = 'sr-only';
    peerStatus.setAttribute('aria-live', 'polite');
    wrapper.appendChild(peerStatus);

    window.addEventListener('candy:presence-peers', (e: Event) => {
        const detail = (e as CustomEvent).detail as {
            peers: Array<{ id: string; label: string; emoji: string; muted: boolean }>;
            peerCount: number;
            maxPeers: number;
        };
        peerList.innerHTML = '';
        for (const p of detail.peers) {
            const li = document.createElement('li');
            li.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0;';
            const label = document.createElement('span');
            label.textContent = `${p.emoji} ${p.label}`;
            li.appendChild(label);
            const muteBtn = document.createElement('button');
            muteBtn.type = 'button';
            muteBtn.className = 'toggle-button';
            muteBtn.style.fontSize = '0.7rem';
            muteBtn.textContent = p.muted ? 'Unmute' : 'Mute';
            muteBtn.setAttribute('aria-label', `${p.muted ? 'Unmute' : 'Mute'} ${p.label}`);
            muteBtn.addEventListener('click', async () => {
                const { presenceSystem } = await import('../systems/net/presence.ts');
                if (p.muted) presenceSystem.unmutePeer(p.id);
                else presenceSystem.mutePeer(p.id);
            });
            li.appendChild(muteBtn);
            peerList.appendChild(li);
        }
        peerStatus.textContent =
            detail.peerCount === 0
                ? 'No other explorers in room'
                : `${detail.peerCount} explorer${detail.peerCount === 1 ? '' : 's'} nearby (max ${detail.maxPeers})`;
    });

    modeSelect.insertAdjacentElement('afterend', wrapper);

    yieldToPaint(50).then(() => {
        trapFocusInside(wrapper, { skipAutoFocus: true });
        wrapper.focus();
    });
}
