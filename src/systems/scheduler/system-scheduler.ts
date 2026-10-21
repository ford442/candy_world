export type Phase =
    | 'AUDIO'
    | 'INPUT'
    | 'STREAMING'
    | 'VISUALS'
    | 'FOLIAGE'
    | 'PARTICLES'
    | 'POSTFX'
    | 'COMPUTE'
    | 'PHYSICS'
    | 'GAMEPLAY'
    | 'RENDER';

export interface SystemContext {
    delta: number;
    rawDelta: number;
    gameTime: number;
    timeFactor: number;
    exploreActive: boolean;
    audioState: unknown;
    visualsState: unknown;
    [key: string]: unknown; // Allow other phase-specific state
}

export type SystemFn = (context: SystemContext) => void;

export class SystemScheduler {
    private systems: Map<Phase, SystemFn[]> = new Map();
    private context: SystemContext = {
        delta: 0,
        rawDelta: 0,
        gameTime: 0,
        timeFactor: 1,
        exploreActive: false,
        audioState: null,
        visualsState: null,
    };

    constructor() {
        const phases: Phase[] = [
            'AUDIO', 'INPUT', 'STREAMING', 'VISUALS', 'FOLIAGE',
            'PARTICLES', 'POSTFX', 'COMPUTE', 'PHYSICS',
            'GAMEPLAY', 'RENDER'
        ];
        for (const phase of phases) {
            this.systems.set(phase, []);
        }
    }

    public register(phase: Phase, fn: SystemFn) {
        this.systems.get(phase)?.push(fn);
    }

    public execute(phase: Phase) {
        const sysFns = this.systems.get(phase);
        if (sysFns) {
            for (let i = 0; i < sysFns.length; i++) {
                sysFns[i](this.context);
            }
        }
    }

    public updateContext(updates: Partial<SystemContext>) {
        Object.assign(this.context, updates);
    }

    public getContext(): SystemContext {
        return this.context;
    }
}

export const scheduler = new SystemScheduler();
