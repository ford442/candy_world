/** Composition presets for Photo Mode (DoF + god rays + color grading). */
export interface PhotoPreset {
    id: string;
    label: string;
    description: string;
    focusDistance: number;
    dofMix: number;
    aperture: number;
    godRayStrength: number;
    bloomStrength: number;
    saturation: number;
    contrast: number;
    vignette: number;
}

export const PHOTO_PRESETS: readonly PhotoPreset[] = [
    {
        id: 'dreamy',
        label: 'Dreamy',
        description: 'Soft bloom, shallow focus, gentle shafts',
        focusDistance: 6,
        dofMix: 0.85,
        aperture: 0.022,
        godRayStrength: 0.55,
        bloomStrength: 1.35,
        saturation: 1.15,
        contrast: 1.02,
        vignette: 0.45,
    },
    {
        id: 'macro',
        label: 'Macro',
        description: 'Tight focal plane, lush bokeh',
        focusDistance: 3.5,
        dofMix: 1.0,
        aperture: 0.028,
        godRayStrength: 0.2,
        bloomStrength: 1.1,
        saturation: 1.2,
        contrast: 1.08,
        vignette: 0.55,
    },
    {
        id: 'wide_vista',
        label: 'Wide Vista',
        description: 'Deep focus, dramatic sky shafts',
        focusDistance: 28,
        dofMix: 0.15,
        aperture: 0.008,
        godRayStrength: 0.9,
        bloomStrength: 1.25,
        saturation: 1.05,
        contrast: 1.12,
        vignette: 0.35,
    },
] as const;

export function getPhotoPreset(id: string): PhotoPreset | undefined {
    return PHOTO_PRESETS.find((p) => p.id === id);
}

export function defaultPhotoSettings(): Omit<PhotoPreset, 'id' | 'label' | 'description'> {
    const dreamy = PHOTO_PRESETS[0];
    return {
        focusDistance: dreamy.focusDistance,
        dofMix: dreamy.dofMix,
        aperture: dreamy.aperture,
        godRayStrength: dreamy.godRayStrength,
        bloomStrength: dreamy.bloomStrength,
        saturation: dreamy.saturation,
        contrast: dreamy.contrast,
        vignette: dreamy.vignette,
    };
}
