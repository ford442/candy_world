import type { CandyMapData, CandyMapEntity, Vec3 } from './map-loader-types.ts';
import { asVec3, normalizeType } from './map-loader-normalize.ts';

const ARPEGGIO_GROVE_SETPIECE = {
    centerX: -60,
    centerZ: 60,
    radius: 15,
};

const LAKE_ISLAND_SETPIECE = {
    centerX: 20,
    centerZ: 20,
    radius: 12,
};

function isV1Map(data: CandyMapData): boolean {
    const version = data.metadata?.version;
    if (version === undefined || version === null || version === '') return true;
    if (typeof version === 'number') return Math.floor(version) === 1;
    const trimmed = String(version).trim();
    if (trimmed === '1') return true;
    const numericPrefix = Number(trimmed.split('.')[0]);
    if (Number.isFinite(numericPrefix)) return numericPrefix === 1;
    return trimmed.startsWith('1.');
}

function hasSetpieceLayer(data: CandyMapData, layer: string): boolean {
    return data.entities.some(
        (entity) => entity.layer === layer || entity.id?.startsWith(`setpiece:${layer}:`)
    );
}

function getEntityPosition(entity: CandyMapEntity): Vec3 | null {
    return asVec3(entity.position);
}

function hasEntityNear(
    entities: CandyMapEntity[],
    type: string,
    centerX: number,
    centerZ: number,
    radius: number
): boolean {
    const radiusSq = radius * radius;
    return entities.some((entity) => {
        if (normalizeType(entity.type) !== type) return false;
        const position = getEntityPosition(entity);
        if (!position) return false;
        const dx = position[0] - centerX;
        const dz = position[2] - centerZ;
        return dx * dx + dz * dz <= radiusSq;
    });
}

export function addLegacySetpieces(base: CandyMapData): CandyMapData {
    if (!isV1Map(base)) return base;

    const entities = [...base.entities];
    const groveLayer = 'setpiece-arpeggio-grove';
    const lakeLayer = 'setpiece-lake-island';
    const caveLayer = 'setpiece-cave';

    if (
        !entities.some((entity) => normalizeType(entity.type) === 'cave') &&
        !hasSetpieceLayer(base, caveLayer)
    ) {
        entities.push({
            id: 'setpiece:cave:entrance',
            type: 'cave',
            category: 'setpiece',
            layer: caveLayer,
            biome: 'lake',
            position: [25, 0, 25],
            params: { lookAtOrigin: true, scale: 2.0 },
            critical: true,
        });
    }

    const hasArpeggioSignature =
        hasEntityNear(
            entities,
            'subwoofer_lotus',
            ARPEGGIO_GROVE_SETPIECE.centerX,
            ARPEGGIO_GROVE_SETPIECE.centerZ,
            ARPEGGIO_GROVE_SETPIECE.radius * 0.9
        ) ||
        hasEntityNear(
            entities,
            'arpeggio_fern',
            ARPEGGIO_GROVE_SETPIECE.centerX,
            ARPEGGIO_GROVE_SETPIECE.centerZ,
            ARPEGGIO_GROVE_SETPIECE.radius
        );

    if (!hasSetpieceLayer(base, groveLayer) && !hasArpeggioSignature) {
        const { centerX, centerZ, radius } = ARPEGGIO_GROVE_SETPIECE;
        entities.push({
            id: 'setpiece:arpeggio:lotus',
            type: 'subwoofer_lotus',
            category: 'setpiece',
            layer: groveLayer,
            biome: 'arpeggio_grove',
            position: [centerX, 0, centerZ],
            scale: 1.5,
            music: { biomeTag: 'arpeggio_grove' },
            critical: true,
        });
        const fernCount = 7;
        const fernRadius = radius * 0.4;
        for (let i = 0; i < fernCount; i++) {
            const angle = (i / fernCount) * Math.PI * 2;
            entities.push({
                id: `setpiece:arpeggio:fern:${i}`,
                type: 'arpeggio_fern',
                category: 'setpiece',
                layer: groveLayer,
                biome: 'arpeggio_grove',
                position: [
                    centerX + Math.cos(angle) * fernRadius,
                    0,
                    centerZ + Math.sin(angle) * fernRadius,
                ],
                scale: 1.1,
                rotation: { euler: [0, angle + Math.PI, 0], order: 'YXZ' },
                music: { biomeTag: 'arpeggio_grove' },
                critical: true,
            });
        }
        const outerCount = 4;
        const outerRadius = radius * 0.8;
        for (let i = 0; i < outerCount; i++) {
            const angle = (i / outerCount) * Math.PI * 2 + 0.2;
            const common = {
                category: 'setpiece',
                layer: groveLayer,
                biome: 'arpeggio_grove',
                position: [
                    centerX + Math.cos(angle) * outerRadius,
                    0,
                    centerZ + Math.sin(angle) * outerRadius,
                ] as Vec3,
                music: { biomeTag: 'arpeggio_grove' },
                critical: true,
            };
            if (i % 2 === 0) {
                entities.push({
                    id: `setpiece:arpeggio:geyser:${i}`,
                    type: 'kick_drum_geyser',
                    ...common,
                });
            } else {
                entities.push({
                    id: `setpiece:arpeggio:violet:${i}`,
                    type: 'vibrato_violet',
                    ...common,
                });
            }
        }
    }

    const hasLakeSignature =
        hasEntityNear(
            entities,
            'retrigger_mushroom',
            LAKE_ISLAND_SETPIECE.centerX,
            LAKE_ISLAND_SETPIECE.centerZ,
            LAKE_ISLAND_SETPIECE.radius * 0.9
        ) ||
        hasEntityNear(
            entities,
            'kick_drum_geyser',
            LAKE_ISLAND_SETPIECE.centerX,
            LAKE_ISLAND_SETPIECE.centerZ,
            LAKE_ISLAND_SETPIECE.radius
        );

    if (!hasSetpieceLayer(base, lakeLayer) && !hasLakeSignature) {
        const { centerX, centerZ, radius } = LAKE_ISLAND_SETPIECE;
        entities.push({
            id: 'setpiece:lake:core',
            type: 'retrigger_mushroom',
            category: 'setpiece',
            layer: lakeLayer,
            biome: 'lake',
            position: [centerX, 0, centerZ],
            scale: 1.5,
            params: { retriggerSpeed: 4, color: 0x00ffff },
            critical: true,
        });
        const geyserCount = 6;
        for (let i = 0; i < geyserCount; i++) {
            const angle = (i / geyserCount) * Math.PI * 2;
            entities.push({
                id: `setpiece:lake:geyser:${i}`,
                type: 'kick_drum_geyser',
                category: 'setpiece',
                layer: lakeLayer,
                biome: 'lake',
                position: [
                    centerX + Math.cos(angle) * radius * 0.7,
                    0,
                    centerZ + Math.sin(angle) * radius * 0.7,
                ],
                rotation: { euler: [0, angle + Math.PI, 0], order: 'YXZ' },
            });
        }
    }

    return {
        ...base,
        entities,
    };
}
