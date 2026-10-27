/**
 * @file src/ui/worlds-panel.ts
 * @brief The start screen's "Worlds" panel (#1975): my worlds, worlds shared
 * with me, the public gallery, and publishing this seed's world.
 *
 * Lives in the lazy `net` chunk (installed by `worlds-panel-lazy.ts` when a
 * Supabase backend is configured). Nothing signs in until the panel opens.
 * Opening a world navigates to its share link: its terrain is generated from
 * its own seed, so the page loads on that seed.
 */

import {
    createInviteLink,
    currentUser,
    deleteWorld,
    keepWorldsWithEmail,
    listWorlds,
    publishCurrentWorld,
    remixWorld,
    setWorldVisibility,
    shareLinkFor,
} from '../systems/net/shared-worlds.ts';
import type { SharedWorldSummary, WorldVisibility } from '../world/document/remote-store.ts';
import { el } from './kit/index.ts';

const PANEL_ID = 'worlds-panel';
type Tab = 'mine' | 'shared' | 'public';

const TABS: ReadonlyArray<{ id: Tab; label: string; empty: string }> = [
    { id: 'mine', label: 'My worlds', empty: "You haven't published a world yet." },
    {
        id: 'shared',
        label: 'Shared with me',
        empty: 'No one has invited you to build with them yet.',
    },
    { id: 'public', label: 'Public', empty: 'The gallery is empty. Publish the first world!' },
];

const VISIBILITY_LABELS: Record<WorldVisibility, string> = {
    private: 'Private (invited only)',
    unlisted: 'Unlisted (anyone with the link)',
    public: 'Public (in the gallery)',
};

const STYLE = `
#worlds-panel { margin: 12px auto 0; max-width: 560px; text-align: left; font-size: 0.85rem; }
#worlds-panel .worlds-toggle { font-weight: 600; }
#worlds-panel .worlds-body { position: fixed; top: 4vh; left: 50%; transform: translateX(-50%); z-index: 400;
  width: min(620px, 94vw); max-height: 92vh; overflow: auto; box-sizing: border-box; padding: 14px 16px; border-radius: 16px;
  background: #ffe4ec; box-shadow: 0 12px 40px rgba(59, 16, 32, 0.25); text-align: left; cursor: default; }
#worlds-panel .worlds-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
#worlds-panel .worlds-head h2 { margin: 0; font-size: 1rem; }
#worlds-panel [role="tablist"] { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
#worlds-panel [role="tab"][aria-selected="true"] { background: #ff69b4; color: #fff; }
#worlds-panel .worlds-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); max-height: 360px; overflow: auto; }
#worlds-panel .world-card { background: rgba(255,255,255,0.6); border-radius: 12px; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
#worlds-panel .world-thumb { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 8px; background: linear-gradient(135deg, #ffd1dc, #c3b1e1);
  display: flex; align-items: center; justify-content: center; font-size: 1.8rem; }
#worlds-panel .world-title { font-weight: 600; overflow-wrap: anywhere; }
#worlds-panel .world-meta { font-size: 0.72rem; opacity: 0.8; }
#worlds-panel .world-actions { display: flex; flex-wrap: wrap; gap: 4px; }
#worlds-panel button, #worlds-panel select, #worlds-panel input { font-size: 0.75rem; }
#worlds-panel button:focus-visible, #worlds-panel select:focus-visible, #worlds-panel input:focus-visible { outline: 3px solid #ff69b4; outline-offset: 2px; }
#worlds-panel .worlds-publish { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#worlds-panel .worlds-account { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 0.75rem; }
`;

function formatDate(iso: string): string {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toLocaleDateString() : '';
}

async function copyText(text: string, status: (msg: string) => void, what: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        status(`${what} copied`);
    } catch {
        window.prompt(`Copy the ${what.toLowerCase()}:`, text);
    }
}

function button(label: string, onClick: () => void, aria?: string): HTMLButtonElement {
    const b = el('button', {
        classes: ['toggle-button'],
        attrs: { type: 'button', 'aria-label': aria },
        text: label,
    });
    b.addEventListener('click', onClick);
    return b;
}

export function installWorldsStartScreenUI(): void {
    const modeSelect = document.getElementById('mode-select');
    if (!modeSelect || document.getElementById(PANEL_ID)) return;

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const status = el('p', {
        classes: ['world-meta'],
        attrs: { role: 'status', 'aria-live': 'polite' },
    });
    const say = (msg: string) => {
        status.textContent = msg;
    };

    const toggle = el('button', {
        classes: ['toggle-button', 'worlds-toggle'],
        attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': `${PANEL_ID}-body` },
        text: '🌍 Worlds',
    });
    // A popover rather than inline: the start card is a centred flex column and
    // cannot scroll, so a tall panel inside it would be cut off.
    const body = el('div', {
        id: `${PANEL_ID}-body`,
        classes: ['worlds-body'],
        attrs: { hidden: true, role: 'dialog', 'aria-labelledby': `${PANEL_ID}-title` },
    });
    const wrapper = el('section', {
        id: PANEL_ID,
        attrs: { 'aria-label': 'Shared worlds' },
        children: [toggle, body],
    });

    const tablist = el('div', { attrs: { role: 'tablist', 'aria-label': 'Worlds' } });
    const grid = el('ul', {
        id: `${PANEL_ID}-grid`,
        classes: ['worlds-grid'],
        attrs: { role: 'tabpanel', 'aria-live': 'polite' },
    });
    const more = button('Load more', () => void load(active, nextCursor));
    more.hidden = true;

    let active: Tab = 'mine';
    let nextCursor: string | null = null;
    let anonymous = true;
    const tabButtons = new Map<Tab, HTMLButtonElement>();

    TABS.forEach((tab, i) => {
        const b = el('button', {
            id: `${PANEL_ID}-tab-${tab.id}`,
            attrs: {
                type: 'button',
                role: 'tab',
                'aria-selected': String(i === 0),
                'aria-controls': grid.id,
                tabindex: i === 0 ? 0 : -1,
            },
            classes: ['toggle-button'],
            text: tab.label,
        });
        b.addEventListener('click', () => select(tab.id));
        b.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
            select(next.id);
            tabButtons.get(next.id)?.focus();
        });
        tabButtons.set(tab.id, b);
        tablist.appendChild(b);
    });

    function select(tab: Tab): void {
        active = tab;
        for (const [id, b] of tabButtons) {
            b.setAttribute('aria-selected', String(id === tab));
            b.tabIndex = id === tab ? 0 : -1;
        }
        grid.setAttribute('aria-labelledby', `${PANEL_ID}-tab-${tab}`);
        void load(tab, null);
    }

    function card(world: SharedWorldSummary, tab: Tab): HTMLLIElement {
        const thumb = world.thumbnailUrl
            ? el('img', {
                  classes: ['world-thumb'],
                  attrs: {
                      src: world.thumbnailUrl,
                      alt: `Photo of ${world.title}`,
                      loading: 'lazy',
                  },
              })
            : el('div', { classes: ['world-thumb'], attrs: { 'aria-hidden': 'true' }, text: '🍭' });
        const meta = el('div', {
            classes: ['world-meta'],
            text: `${world.visibility} · ${world.commandCount} edit${world.commandCount === 1 ? '' : 's'} · ${formatDate(world.updatedAt)}`,
        });
        const actions = el('div', { classes: ['world-actions'] });
        const link = shareLinkFor(world);
        const open = el('a', {
            classes: ['toggle-button'],
            attrs: { href: link, 'aria-label': `Open ${world.title}` },
            text: 'Open',
        });
        actions.appendChild(open);
        actions.appendChild(
            button(
                'Copy link',
                () => void copyText(link, say, 'Link'),
                `Copy the link to ${world.title}`
            )
        );
        if (tab === 'mine') {
            actions.appendChild(
                button(
                    'Invite builder',
                    () =>
                        void createInviteLink(world)
                            .then((url) =>
                                url
                                    ? copyText(url, say, 'Invite link')
                                    : say('Could not create an invite')
                            )
                            .catch((err) => say(`Could not create an invite: ${String(err)}`)),
                    `Copy an editor invite link for ${world.title}`
                )
            );
            const vis = el('select', { attrs: { 'aria-label': `Who can see ${world.title}` } });
            for (const v of Object.keys(VISIBILITY_LABELS) as WorldVisibility[]) {
                const opt = el('option', { attrs: { value: v }, text: VISIBILITY_LABELS[v] });
                if (v === 'public' && anonymous) opt.disabled = true;
                if (v === world.visibility) opt.selected = true;
                vis.appendChild(opt);
            }
            vis.addEventListener('change', () => {
                const v = vis.value as WorldVisibility;
                void setWorldVisibility(world.id, v)
                    .then(() => say(`${world.title} is now ${v}`))
                    .catch((err) => say(`Could not change visibility: ${String(err)}`));
            });
            actions.appendChild(vis);
            actions.appendChild(
                button(
                    'Delete',
                    () => {
                        if (
                            !window.confirm(
                                `Delete “${world.title}” for everyone? This can't be undone.`
                            )
                        )
                            return;
                        void deleteWorld(world.id).then(() => {
                            say(`Deleted ${world.title}`);
                            void load(active, null);
                        });
                    },
                    `Delete ${world.title}`
                )
            );
        } else {
            actions.appendChild(
                button(
                    'Remix',
                    () =>
                        void remixWorld(world.id).then((r) => {
                            if (r.ok && r.url) window.location.assign(r.url);
                            else say(r.ok ? 'Remixed' : r.message);
                        }),
                    `Remix ${world.title} into a world of your own`
                )
            );
        }
        return el('li', {
            classes: ['world-card'],
            children: [
                thumb,
                el('div', { classes: ['world-title'], text: world.title }),
                meta,
                actions,
            ],
        });
    }

    async function load(tab: Tab, cursor: string | null): Promise<void> {
        if (!cursor) grid.replaceChildren();
        say('Loading…');
        try {
            const page = await listWorlds(tab, cursor);
            if (tab !== active) return;
            for (const w of page.worlds) grid.appendChild(card(w, tab));
            nextCursor = page.next;
            more.hidden = !page.next;
            if (grid.childElementCount === 0) say(TABS.find((t) => t.id === tab)!.empty);
            else say(`${grid.childElementCount} world${grid.childElementCount === 1 ? '' : 's'}`);
        } catch (err) {
            say(`Could not load worlds: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // Publish this seed's world.
    const titleInput = el('input', {
        attrs: {
            type: 'text',
            maxlength: 80,
            placeholder: 'World title',
            'aria-label': 'World title',
        },
    });
    titleInput.value = 'My Candy World';
    const visSelect = el('select', { attrs: { 'aria-label': 'Who can see it' } });
    for (const v of ['unlisted', 'private', 'public'] as WorldVisibility[]) {
        visSelect.appendChild(el('option', { attrs: { value: v }, text: VISIBILITY_LABELS[v] }));
    }
    const publishBtn = button('Publish this world', () => {
        publishBtn.disabled = true;
        say('Publishing…');
        void publishCurrentWorld({
            title: titleInput.value,
            visibility: visSelect.value as WorldVisibility,
        })
            .then((r) => {
                if (r.ok && r.url) {
                    say(`Published “${r.world.title}”.`);
                    void copyText(r.url, say, 'Link');
                    select('mine');
                } else {
                    say(r.ok ? 'Published' : `Could not publish: ${r.message}`);
                }
            })
            .finally(() => {
                publishBtn.disabled = false;
            });
    });
    const publish = el('div', {
        classes: ['worlds-publish'],
        children: [titleInput, visSelect, publishBtn],
    });

    // Anonymous accounts can keep their worlds by adding an email.
    const account = el('div', { classes: ['worlds-account'] });
    async function renderAccount(): Promise<void> {
        const user = await currentUser();
        anonymous = user?.isAnonymous ?? true;
        account.replaceChildren();
        const publicOption = Array.from(visSelect.options).find((o) => o.value === 'public');
        if (publicOption) publicOption.disabled = anonymous;
        if (!user) {
            account.textContent = "Couldn't sign in to the shared-worlds server.";
            return;
        }
        if (!anonymous) {
            account.textContent = `Signed in${user.email ? ` as ${user.email}` : ''}.`;
            return;
        }
        const email = el('input', {
            attrs: {
                type: 'email',
                placeholder: 'you@example.com',
                'aria-label': 'Email to keep your worlds',
            },
        });
        account.append(
            el('span', {
                text: 'Playing as a guest: add an email to keep your worlds on any browser (and to publish to the gallery).',
            }),
            email,
            button('Keep my worlds', () => {
                void keepWorldsWithEmail(email.value.trim()).then((err) =>
                    say(err ? `Could not add the email: ${err}` : 'Check your inbox to confirm.')
                );
            })
        );
    }

    const close = button('Close', () => setOpen(false), 'Close the worlds panel');
    const head = el('div', {
        classes: ['worlds-head'],
        children: [el('h2', { id: `${PANEL_ID}-title`, text: '🌍 Worlds' }), close],
    });
    body.append(head, tablist, grid, more, publish, account, status);

    let opened = false;
    function setOpen(open: boolean): void {
        toggle.setAttribute('aria-expanded', String(open));
        body.hidden = !open;
        if (open) {
            if (!opened) {
                opened = true;
                void renderAccount().then(() => select('mine'));
            }
            tabButtons.get(active)?.focus();
        } else {
            toggle.focus();
        }
    }
    toggle.addEventListener('click', () =>
        setOpen(toggle.getAttribute('aria-expanded') !== 'true')
    );
    body.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
    });

    window.addEventListener('candy:start-screen-hidden', () => wrapper.remove(), { once: true });
    modeSelect.insertAdjacentElement('afterend', wrapper);
}
