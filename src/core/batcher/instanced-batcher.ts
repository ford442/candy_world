import * as THREE from 'three';
import type { System, FrameContext } from '../scheduler/index.ts';

export interface InstancedBatcherRecord {
    mesh: THREE.InstancedMesh;
    index: number;
}

export abstract class InstancedBatcher<TRecord = InstancedBatcherRecord> implements System {
    abstract readonly id: string;
    readonly phase = 'animate';
    readonly after?: readonly string[];
    readonly before?: readonly string[];
    readonly budgetMs?: number;

    abstract register(group: THREE.Group, options?: any): void;
    abstract removeInstance(logicObject: THREE.Object3D): void;

    abstract update(ctx: FrameContext): void;
    dispose?(): void {}
}