/**
 * @file src/gameplay/objectives/schema.ts
 * @brief The Melody file format: authored quest chains (#2028 slice B).
 *
 * A Melody is a short, ordered list of steps; each step names one trigger that
 * is *derived* from progress the player already has (an item count, a
 * discovery, a Night Market stamp, the number of awakened flora). Nothing here
 * counts events, so a save that already satisfies a step passes it on load.
 *
 * Authored files live in `assets/melodies/*.json`. Valibot validates them and
 * every failure names the file and the dot path of the bad field, the same
 * shape `validateWorldDocument` reports. Renderer- and DOM-free: importable
 * from Node, which is how `tests/objectives.test.ts` checks the shipped files.
 */

import * as v from 'valibot';

/** Awakenable flora types (`AWAKENABLE_TYPES` in `awakened-persistence.ts`). */
export const AWAKEN_TYPES = ['luminous_plant', 'gem_canopy_tree'] as const;

/**
 * Parsed and kept, but not acted on yet: seasonal Melodies are a later cut, and
 * a file that already carries a season keeps validating when that lands.
 */
export const MELODY_SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;

/** `night_market_stamp:<stall entity id>`; the same shape a shared-world peer accepts. */
export const STAMP_ID_RE = /^night_market_stamp:[A-Za-z0-9_.:-]{1,96}$/;

export const MAX_MELODY_STEPS = 32;

/** Melody ids are record keys in `progress.melodies`, so they (and step ids) stay short and plain. */
const SlugSchema = v.pipe(
    v.string(),
    v.regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'must be lowercase letters, digits, "_" or "-"')
);
const Text = (max: number) => v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(max));
const Count = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(9999));

// `strictObject`: an unknown key (a typo such as `cout`, or a `reward` this cut
// does not have) is an error that names its path, not a silently ignored field.
export const TriggerSchema = v.variant('kind', [
    v.strictObject({
        kind: v.literal('harvest'),
        item: v.pipe(v.string(), v.regex(/^[a-z0-9_]{1,64}$/)),
        count: Count,
    }),
    v.strictObject({
        kind: v.literal('awaken'),
        count: Count,
        type: v.optional(v.picklist(AWAKEN_TYPES)),
    }),
    v.strictObject({
        kind: v.literal('stamp'),
        id: v.pipe(v.string(), v.regex(STAMP_ID_RE, 'must be night_market_stamp:<stall id>')),
    }),
    v.strictObject({
        kind: v.literal('discover'),
        id: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_.:-]{1,128}$/)),
    }),
]);

export const StepSchema = v.strictObject({
    id: SlugSchema,
    text: Text(160),
    trigger: TriggerSchema,
});

export const MelodySchema = v.pipe(
    v.strictObject({
        id: SlugSchema,
        title: Text(80),
        season: v.optional(v.picklist(MELODY_SEASONS)),
        prereq: v.optional(v.pipe(v.array(SlugSchema), v.maxLength(8))),
        steps: v.pipe(v.array(StepSchema), v.minLength(1), v.maxLength(MAX_MELODY_STEPS)),
    }),
    v.check(
        (m) => new Set(m.steps.map((s) => s.id)).size === m.steps.length,
        'step ids must be unique'
    ),
    v.check((m) => !m.prereq?.includes(m.id), 'a Melody cannot be its own prerequisite')
);

export type Trigger = v.InferOutput<typeof TriggerSchema>;
export type MelodyStep = v.InferOutput<typeof StepSchema>;
export type Melody = v.InferOutput<typeof MelodySchema>;

/** A Melody file that fails validation. `file` and `path` are the parts a fix needs. */
export class MelodyFileError extends Error {
    constructor(
        readonly file: string,
        readonly path: string | null,
        detail: string
    ) {
        super(`Melody file "${file}" is invalid${path ? ` at "${path}"` : ''}: ${detail}`);
        this.name = 'MelodyFileError';
    }
}

/**
 * Validate one parsed Melody file. Throws a `MelodyFileError` whose message
 * contains the file name and the dot path of the first bad field.
 */
export function parseMelodyFile(name: string, json: unknown): Melody {
    const result = v.safeParse(MelodySchema, json);
    if (result.success) return result.output;
    const issue = result.issues[0];
    throw new MelodyFileError(name, v.getDotPath(issue), issue.message);
}

/**
 * Validate a set of files (`{ 'meadow.json': <parsed json>, … }`) and the
 * references between them: ids are unique across files, every `prereq` names a
 * Melody that exists, and prerequisites do not loop. A loop would leave every
 * Melody in it waiting on another forever.
 */
export function parseMelodyFiles(files: Readonly<Record<string, unknown>>): Melody[] {
    const melodies: Melody[] = [];
    const fileOf = new Map<string, string>();
    for (const name of Object.keys(files).sort()) {
        const melody = parseMelodyFile(name, files[name]);
        const earlier = fileOf.get(melody.id);
        if (earlier) {
            throw new MelodyFileError(
                name,
                'id',
                `"${melody.id}" is already defined in "${earlier}"`
            );
        }
        fileOf.set(melody.id, name);
        melodies.push(melody);
    }

    const byId = new Map(melodies.map((m) => [m.id, m]));
    for (const m of melodies) {
        (m.prereq ?? []).forEach((p, i) => {
            if (!byId.has(p)) {
                throw new MelodyFileError(
                    fileOf.get(m.id)!,
                    `prereq.${i}`,
                    `unknown Melody "${p}"`
                );
            }
        });
    }

    // Depth-first walk; a node met again while still on the path is a loop.
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (id: string, path: string[]): void => {
        if (state.get(id) === 'done') return;
        if (state.get(id) === 'visiting') {
            const loop = [...path.slice(path.indexOf(id)), id].join(' -> ');
            throw new MelodyFileError(fileOf.get(id)!, 'prereq', `prerequisites loop: ${loop}`);
        }
        state.set(id, 'visiting');
        for (const p of byId.get(id)!.prereq ?? []) visit(p, [...path, id]);
        state.set(id, 'done');
    };
    for (const m of melodies) visit(m.id, []);

    return melodies;
}
