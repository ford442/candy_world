import * as THREE from 'three';

export interface ChannelData {
    freq: number;
    volume: number;
    trigger: number;
    activeEffect?: number;
    effectValue?: number;
}

export interface AudioData {
    channelData?: ChannelData[];
    kickTrigger?: number;
    grooveAmount?: number;
    beatPhase?: number;
}

export interface FoliageMaterial extends THREE.Material {
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
    roughness?: number;
    metalness?: number;
    map?: THREE.Texture | null;
    userData: {
        dryRoughness?: number;
        dryMetalness?: number;
        dryColor?: THREE.Color;
        baseColor?: THREE.Color;
        baseEmissive?: THREE.Color;
        [key: string]: any;
    };
}

export interface FoliageObject extends THREE.Object3D {
    userData: {
        type?: string;
        animationType?: string;
        animationOffset?: number;
        originalY?: number;
        maxScale?: number;
        maxBloom?: number;

        // Reactivity
        reactiveMeshes?: FoliageObject[]; // Recursive definition
        flashIntensity?: number;
        flashDecay?: number;
        flashColor?: THREE.Color;
        _needsFadeBack?: boolean;

        // Arpeggio / Unfurl
        unfurlStep?: number;
        targetStep?: number;
        lastTrigger?: boolean;
        fronds?: any[][]; // Simplified structure for segments

        // Snare Snap
        snapState?: number;
        leftJaw?: THREE.Object3D;
        rightJaw?: THREE.Object3D;

        // Accordion
        trunk?: THREE.Object3D;

        // Wobble
        wobbleCurrent?: number;
        noteBuffer?: number[];

        // Vibrato
        headGroup?: THREE.Object3D;

        // Tremelo
        bellMaterial?: FoliageMaterial;
        vortex?: THREE.Mesh<THREE.BufferGeometry, FoliageMaterial>;

        // Geyser
        plume?: THREE.Points;
        plumeLight?: THREE.PointLight;
        coreMaterial?: FoliageMaterial;
        maxHeight?: number;
        eruptionStrength?: number;

        [key: string]: any;
    };
    children: FoliageObject[];
    material?: FoliageMaterial | FoliageMaterial[];
}
