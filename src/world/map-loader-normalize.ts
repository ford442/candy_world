import type { CandyMapEntity, LoadedMapEntity, MapRotation, MapScale, Quat, Vec3 } from './map-loader-types.ts';

const TYPE_ALIASES: Record<string, string> = {
    panningPad: 'panning_pad',
    panningpad: 'panning_pad',
    instrumentShrine: 'instrument_shrine',
    instrumentshrine: 'instrument_shrine',
    kickDrumGeyser: 'kick_drum_geyser',
    snareTrap: 'snare_trap',
    subwooferLotus: 'subwoofer_lotus',
    prismRoseBush: 'prism_rose_bush',
    fiberOpticWillow: 'fiber_optic_willow',
    bubbleWillow: 'bubble_willow',
    gemCanopyTree: 'gem_canopy_tree',
    portamentoPine: 'portamento_pine',
    arpeggioFern: 'arpeggio_fern',
    cymbalDandelion: 'cymbal_dandelion',
    retriggerMushroom: 'retrigger_mushroom',
    vibratoViolet: 'vibrato_violet',
    tremoloTulip: 'tremolo_tulip',
    floatingOrb: 'floating_orb',
    swingableVine: 'swingable_vine',
    vineLadder: 'vine_ladder',
    wisteriaCluster: 'wisteria_cluster',
    silenceSpirit: 'silence_spirit',
    melodyMirror: 'melody_mirror',
};

export function normalizeType(type: string): string {
    const trimmed = type.trim();
    return TYPE_ALIASES[trimmed] ?? trimmed;
}

export function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function asVec3(value: unknown): Vec3 | null {
    if (!Array.isArray(value) || value.length !== 3) return null;
    if (!isFiniteNumber(value[0]) || !isFiniteNumber(value[1]) || !isFiniteNumber(value[2]))
        return null;
    return [value[0], value[1], value[2]];
}

export function asQuat(value: unknown): Quat | null {
    if (!Array.isArray(value) || value.length !== 4) return null;
    if (
        !isFiniteNumber(value[0]) ||
        !isFiniteNumber(value[1]) ||
        !isFiniteNumber(value[2]) ||
        !isFiniteNumber(value[3])
    )
        return null;
    return [value[0], value[1], value[2], value[3]];
}

export function normalizeRotation(rotation: CandyMapEntity['rotation']): MapRotation | undefined {
    if (rotation === undefined || rotation === null) return undefined;
    if (isFiniteNumber(rotation)) {
        return { euler: [0, rotation, 0], order: 'YXZ' };
    }
    const euler = asVec3(rotation);
    if (euler) {
        return { euler, order: 'YXZ' };
    }
    const quat = asQuat(rotation);
    if (quat) {
        return { quat };
    }
    if (typeof rotation === 'object') {
        const eulerFromObj = asVec3((rotation as MapRotation).euler);
        const quatFromObj = asQuat((rotation as MapRotation).quat);
        if (!eulerFromObj && !quatFromObj) return undefined;
        return {
            euler: eulerFromObj ?? undefined,
            quat: quatFromObj ?? undefined,
            order:
                typeof (rotation as MapRotation).order === 'string'
                    ? (rotation as MapRotation).order
                    : 'YXZ',
        };
    }
    return undefined;
}

export function normalizeScale(scale: unknown): MapScale | undefined {
    if (scale === undefined || scale === null) return undefined;
    if (isFiniteNumber(scale)) return scale;
    const vec3 = asVec3(scale);
    if (vec3) return vec3;
    return undefined;
}

export function normalizeEntity(entity: CandyMapEntity, index: number): LoadedMapEntity {
    const type = normalizeType(entity.type);
    const placement = entity.placement ?? (type === 'cloud' ? 'absolute' : 'ground');
    const biome = entity.biome ?? entity.music?.biomeTag;
    const params = entity.params && typeof entity.params === 'object' ? entity.params : undefined;
    return {
        ...entity,
        id: entity.id ?? `${type}_${index}`,
        type,
        position: asVec3(entity.position)!,
        rotation: normalizeRotation(entity.rotation),
        scale: normalizeScale(entity.scale),
        placement,
        biome,
        music: normalizeMusicHints(entity.music),
        params,
    };
}

export function normalizeMusicHints(
    raw: CandyMapEntity['music']
): CandyMapEntity['music'] | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const biome = raw.biomeOverride ?? raw.biome ?? raw.biomeTag;
    return {
        ...raw,
        biome: biome ?? raw.biome,
        biomeTag: biome ?? raw.biomeTag,
    };
}
