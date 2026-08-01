let particlesPromise: Promise<typeof import('./index.ts')> | null = null;
let particlesInstance: typeof import('./index.ts') | null = null;

export async function loadParticles(): Promise<typeof import('./index.ts')> {
    if (particlesInstance) {
        return particlesInstance;
    }

    if (!particlesPromise) {
        particlesPromise = import('./index.ts');
    }

    particlesInstance = await particlesPromise;
    return particlesInstance;
}

export function getParticles(): typeof import('./index.ts') | null {
    return particlesInstance;
}
