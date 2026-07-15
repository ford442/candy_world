/**
 * Start-screen opt-in UI for shared presence rooms.
 */

import { FEATURE_FLAGS } from '../core/config.ts';
import { applyWorldSeed } from '../utils/seeded-random.ts';
import {
    buildShareUrl,
    ensureSeedInUrl,
    getWorldSeed,
    hasExplicitSeedInURL,
} from '../world/world-seed.ts';
import {
    isPresenceBackendConfigured,
    isPresenceOptedIn,
    setPresenceOptIn,
} from '../systems/net/presence.ts';

const PRESENCE_UI_ID = 'presence-opt-in';

export function installPresenceStartScreenUI(): void {
    if (!FEATURE_FLAGS.presence) return;

    const modeSelect = document.getElementById('mode-select');
    if (!modeSelect || document.getElementById(PRESENCE_UI_ID)) return;

    const configured = isPresenceBackendConfigured();
    const wrapper = document.createElement('div');
    wrapper.id = PRESENCE_UI_ID;
    wrapper.style.cssText =
        'margin:16px auto 0;max-width:420px;padding:12px 14px;border-radius:14px;' +
        'background:rgba(255,255,255,0.35);text-align:left;font-size:0.85rem;';

    const title = document.createElement('p');
    title.style.cssText = 'margin:0 0 8px;font-weight:600;opacity:0.95;';
    title.textContent = '🫧 Shared presence (opt-in)';

    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:flex-start;gap:8px;cursor:pointer;';
    label.htmlFor = 'presence-join-checkbox';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'presence-join-checkbox';
    checkbox.disabled = !configured;
    checkbox.checked = isPresenceOptedIn() || new URLSearchParams(location.search).has('presence');
    checkbox.style.cssText = 'margin-top:3px;accent-color:#FF6B6B;';

    const copy = document.createElement('span');
    copy.innerHTML = configured
        ? 'Join a shared room and see other explorers (camera position only). No chat, no accounts.'
        : 'Supabase not configured — set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to enable.';

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
    shareInput.value = buildShareUrl(getWorldSeed(), { presence: checkbox.checked });
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
        shareInput.value = buildShareUrl(seed, { presence: checkbox.checked });
    };

    checkbox.addEventListener('change', () => {
        const enabled = checkbox.checked;
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
    modeSelect.insertAdjacentElement('afterend', wrapper);
}
