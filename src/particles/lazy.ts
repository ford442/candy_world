import * as particlesModule from './index.ts';

let particlesInstance: typeof particlesModule | null = null;

export async function loadParticles(): Promise<typeof particlesModule> {
    if (!particlesInstance) {
        particlesInstance = particlesModule;
    }
    return particlesInstance;
}

export function getParticles(): typeof particlesModule | null {
    return particlesInstance;
}
