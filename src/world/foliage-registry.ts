import * as THREE from 'three';
import {
    createMushroom,
    createGlowingFlower,
    createFlower,
    createSubwooferLotus,
    createAccordionPalm,
    createFiberOpticWillow,
    createFloatingOrb,
    createSwingableVine,
    createPrismRoseBush,
    createStarflower,
    createVibratoViolet,
    createTremoloTulip,
    createRainingCloud,
    createArpeggioFern,
    createPortamentoPine,
    createCymbalDandelion,
    createSnareTrap,
    createBubbleWillow,
    createHelixPlant,
    createBalloonBush,
    createPanningPad,
    createSilenceSpirit,
    createInstrumentShrine,
    createMelodyMirror,
    createRetriggerMushroom,
    createCaveEntrance,
    createLuminousPlant,
    createVineLadder,
} from '../foliage/index.ts';
import { createWisteriaCluster } from '../foliage/wisteria-cluster.ts';
import { subwooferLotusBatcher } from '../foliage/subwoofer-lotus-batcher.ts';
import { kickDrumGeyserBatcher } from '../foliage/kick-drum-geyser-batcher.ts';

export interface WorldObjectMeta {
    isCritical?: boolean;
    defaultRadius?: number;
    defaultIsObstacle?: boolean;
    supportsMusic?: boolean;
    batcherHint?: string;
}

type WorldObjectParams = Record<string, unknown> | undefined;
type WorldObjectFactory = (params?: WorldObjectParams) => THREE.Object3D | null;

interface RegistryEntry {
    factory: WorldObjectFactory;
    meta: WorldObjectMeta;
}

const _registry = new Map<string, RegistryEntry>();
let _builtinsRegistered = false;

type WorldObjectRegistrationSubscriber = (object: THREE.Object3D, type: string) => void;
const _registrationSubscribers: WorldObjectRegistrationSubscriber[] = [];

function normalizeType(type: string): string {
    return type.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
}

export function registerType(name: string, factory: WorldObjectFactory, meta: WorldObjectMeta = {}): void {
    const key = normalizeType(name);
    _registry.set(key, { factory, meta });
}

export function create(type: string, params?: WorldObjectParams): THREE.Object3D | null {
    const key = normalizeType(type);
    const entry = _registry.get(key);
    if (!entry) return null;
    return entry.factory(params);
}

export function getTypeMeta(type: string): WorldObjectMeta | undefined {
    const key = normalizeType(type);
    return _registry.get(key)?.meta;
}

export function subscribeWorldObjectRegistration(subscriber: WorldObjectRegistrationSubscriber): () => void {
    _registrationSubscribers.push(subscriber);
    return () => {
        const index = _registrationSubscribers.indexOf(subscriber);
        if (index >= 0) _registrationSubscribers.splice(index, 1);
    };
}

export function registerWorldObject(object: THREE.Object3D, type: string): void {
    for (let i = 0; i < _registrationSubscribers.length; i++) {
        _registrationSubscribers[i](object, type);
    }
}

export function registerBuiltinWorldObjectTypes(): void {
    if (_builtinsRegistered) return;
    _builtinsRegistered = true;

    registerType('mushroom', (params) => {
        const size = params?.size === 'giant' ? 'giant' : 'regular';
        const scale = typeof params?.scale === 'number' ? params.scale : 1.0;
        const hasFace = typeof params?.hasFace === 'boolean' ? params.hasFace : false;
        const isBouncy = typeof params?.isBouncy === 'boolean' ? params.isBouncy : false;
        const note = typeof params?.note === 'string' ? params.note : undefined;
        const noteIndex = Number.isInteger(params?.noteIndex) ? (params?.noteIndex as number) : undefined;
        return createMushroom({ size, scale, hasFace, isBouncy, note, noteIndex });
    }, { defaultIsObstacle: true, defaultRadius: 0.5, supportsMusic: true, batcherHint: 'mushroom' });

    registerType('flower', (params) => {
        const variant = typeof params?.variant === 'string' ? params.variant : '';
        return variant === 'glowing' ? createGlowingFlower() : createFlower();
    }, { supportsMusic: true, batcherHint: 'flower' });

    registerType('cloud', (params) => {
        const size = typeof params?.size === 'number' ? params.size : 1.5;
        return createRainingCloud({ size });
    }, { defaultRadius: 0.8, batcherHint: 'cloud' });

    registerType('subwoofer_lotus', (params) => {
        const proxy = new THREE.Group();
        subwooferLotusBatcher.register(proxy, { scale: typeof params?.scale === 'number' ? params.scale : 1.0 });
        return proxy;
    }, { supportsMusic: true, batcherHint: 'musical_flora' });
    registerType('accordion_palm', () => createAccordionPalm({ color: 0xFFD700 }), { defaultIsObstacle: true });
    registerType('fiber_optic_willow', () => createFiberOpticWillow(), { defaultIsObstacle: true });
    registerType('floating_orb', (params) => createFloatingOrb({ size: typeof params?.size === 'number' ? params.size : 0.5 }));
    registerType('swingable_vine', (params) => createSwingableVine({ length: typeof params?.length === 'number' ? params.length : 8 }));
    registerType('vine_ladder', (params) => createVineLadder({ length: typeof params?.length === 'number' ? params.length : 8 }));
    registerType('prism_rose_bush', () => createPrismRoseBush(), { defaultIsObstacle: true });
    registerType('starflower', () => createStarflower(), { supportsMusic: true });
    registerType('vibrato_violet', () => createVibratoViolet(), { supportsMusic: true, batcherHint: 'musical_flora' });
    registerType('tremolo_tulip', (params) => createTremoloTulip({ size: typeof params?.size === 'number' ? params.size : 1.0 }), { supportsMusic: true, batcherHint: 'musical_flora' });
    registerType('kick_drum_geyser', (params) => {
        const proxy = new THREE.Group();
        kickDrumGeyserBatcher.register(proxy, { maxHeight: typeof params?.maxHeight === 'number' ? params.maxHeight : 5.0 });
        return proxy;
    }, { defaultRadius: 1.0, supportsMusic: true, batcherHint: 'musical_flora' });
    registerType('arpeggio_fern', (params) => createArpeggioFern({ scale: typeof params?.scale === 'number' ? params.scale : 1.0 }), { supportsMusic: true, batcherHint: 'musical_flora' });
    registerType('portamento_pine', (params) => createPortamentoPine({ height: typeof params?.height === 'number' ? params.height : 4.0 }), { defaultIsObstacle: true, defaultRadius: 0.5, supportsMusic: true });
    registerType('cymbal_dandelion', (params) => createCymbalDandelion({ scale: typeof params?.scale === 'number' ? params.scale : 1.0 }), { supportsMusic: true, batcherHint: 'musical_flora' });
    registerType('snare_trap', (params) => createSnareTrap({ scale: typeof params?.scale === 'number' ? params.scale : 1.0 }), { defaultIsObstacle: true, defaultRadius: 0.8, supportsMusic: true });
    registerType('retrigger_mushroom', (params) => createRetriggerMushroom({
        scale: typeof params?.scale === 'number' ? params.scale : 1.0,
        retriggerSpeed: typeof params?.retriggerSpeed === 'number' ? params.retriggerSpeed : 4
    }), { supportsMusic: true, batcherHint: 'musical_flora' });
    registerType('panning_pad', (params) => createPanningPad({
        radius: typeof params?.radius === 'number' ? params.radius : 1.0,
        panBias: typeof params?.panBias === 'number' ? params.panBias : 1
    }), { supportsMusic: true, batcherHint: 'musical_flora' });
    registerType('silence_spirit', (params) => createSilenceSpirit({ scale: typeof params?.scale === 'number' ? params.scale : 1.0 }), { supportsMusic: true });
    registerType('instrument_shrine', (params) => createInstrumentShrine({
        instrumentID: Number.isInteger(params?.instrumentID) ? (params?.instrumentID as number) : 0,
        scale: typeof params?.scale === 'number' ? params.scale : 1.0
    }), { defaultIsObstacle: true, defaultRadius: 1.0, supportsMusic: true });
    registerType('bubble_willow', () => createBubbleWillow(), { defaultIsObstacle: true, defaultRadius: 1.5 });
    registerType('helix_plant', () => createHelixPlant(), { defaultIsObstacle: true, defaultRadius: 1.5 });
    registerType('balloon_bush', () => createBalloonBush(), { defaultIsObstacle: true, defaultRadius: 1.5 });
    registerType('wisteria_cluster', () => createWisteriaCluster(), { supportsMusic: true, batcherHint: 'musical_flora' });
    registerType('luminous_plant', () => createLuminousPlant(), { supportsMusic: true, batcherHint: 'luminous' });
    registerType('melody_mirror', (params) => createMelodyMirror({ scale: typeof params?.scale === 'number' ? params.scale : 1.0 }), { supportsMusic: true });
    registerType('cave', (params) => createCaveEntrance({ scale: typeof params?.scale === 'number' ? params.scale : 2.0 }));
}
