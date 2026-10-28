/**
 * @file src/systems/authoring/gizmo.ts
 * @brief Move / rotate / scale one entity with three's TransformControls.
 *
 * Batched entities live in an InstancedMesh, so the gizmo drives a wireframe
 * proxy and each finished drag commits one MoveCommand (one undo step); the
 * real entity jumps to the proxy on release. The gizmo needs a free cursor:
 * opening it releases pointer lock (the input layer is told, via
 * `reportBuildModeState`, not to show the pause menu), closing it re-locks.
 */

import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { safeRemoveAndDispose } from '../../utils/dispose-utils.ts';
import type { EntitySnapshot } from '../entity-snapshot-core.ts';
import { getGroundHeight } from '../ground-system.ts';
import { round } from './placement-core.ts';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

const MIN_SCALE = 0.2;
const MAX_SCALE = 5;

export interface GizmoCallbacks {
    /** A drag finished; `to` is `from` with the new transform. Return the snapshot now live. */
    onCommit(from: EntitySnapshot, to: EntitySnapshot): EntitySnapshot | null;
}

function readScale(scale: EntitySnapshot['entity']['scale']): number {
    if (typeof scale === 'number') return scale;
    if (Array.isArray(scale)) return (scale[0] + scale[1] + scale[2]) / 3;
    return 1;
}

export class BuildGizmo {
    private readonly controls: TransformControls;
    private readonly proxy = new THREE.Object3D();
    private readonly box: THREE.LineSegments;
    private current: EntitySnapshot | null = null;
    private dragging = false;

    constructor(
        private readonly scene: THREE.Scene,
        camera: THREE.Camera,
        domElement: HTMLElement,
        private readonly callbacks: GizmoCallbacks
    ) {
        this.controls = new TransformControls(camera, domElement);
        this.controls.setTranslationSnap(0.25);
        this.controls.setRotationSnap(THREE.MathUtils.degToRad(15));
        this.controls.setScaleSnap(0.1);
        this.controls.size = 0.9;

        const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.2, 1.6, 1.2));
        edges.translate(0, 0.8, 0);
        this.box = new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: 0xff69b4, depthTest: false, transparent: true })
        );
        this.box.renderOrder = 9999;
        this.proxy.add(this.box);
        this.proxy.name = 'build-gizmo-proxy';

        this.controls.addEventListener('dragging-changed', (e) => {
            const value = (e as unknown as { value: boolean }).value;
            this.dragging = value;
            if (!value) this.commit();
        });
        this.controls.addEventListener('objectChange', () => {
            if (this.controls.getMode() === 'scale') {
                const s = this.proxy.scale;
                const uniform = THREE.MathUtils.clamp((s.x + s.y + s.z) / 3, MIN_SCALE, MAX_SCALE);
                s.setScalar(uniform);
            }
        });
    }

    get isOpen(): boolean {
        return this.current !== null;
    }

    get isDragging(): boolean {
        return this.dragging;
    }

    get mode(): GizmoMode {
        return this.controls.getMode();
    }

    open(snapshot: EntitySnapshot): void {
        this.current = snapshot;
        this.placeProxy(snapshot);
        this.scene.add(this.proxy);
        this.scene.add(this.controls.getHelper());
        this.controls.attach(this.proxy);
        this.controls.enabled = true;
        this.tick();
    }

    /**
     * Refresh the handles' world matrices. The render normally does this, but
     * pointer events can land before the next render (and automated runs
     * skip it), and the picker raycast reads these matrices.
     */
    tick(): void {
        if (this.current) this.controls.getHelper().updateMatrixWorld(true);
    }

    setMode(mode: GizmoMode): void {
        this.controls.setMode(mode);
    }

    close(): void {
        this.controls.detach();
        this.controls.enabled = false;
        // ⚡ OPTIMIZATION: Replaced scene.remove with safeRemoveAndDispose to prevent VRAM leaks
        safeRemoveAndDispose(this.scene, this.controls.getHelper());
        safeRemoveAndDispose(this.scene, this.proxy);
        this.current = null;
        this.dragging = false;
    }

    dispose(): void {
        this.close();
        this.controls.dispose();
        this.box.geometry.dispose();
        (this.box.material as THREE.Material).dispose();
    }

    private placeProxy(snapshot: EntitySnapshot): void {
        const [x, y, z] = snapshot.entity.position;
        this.proxy.position.set(x, y, z);
        const rotation = snapshot.entity.rotation;
        if (
            rotation &&
            typeof rotation === 'object' &&
            'quat' in rotation &&
            Array.isArray(rotation.quat)
        ) {
            const [qx, qy, qz, qw] = rotation.quat;
            this.proxy.quaternion.set(qx, qy, qz, qw);
        } else if (typeof rotation === 'number') {
            this.proxy.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotation);
        } else {
            this.proxy.quaternion.identity();
        }
        this.proxy.scale.setScalar(readScale(snapshot.entity.scale));
    }

    /** The proxy's transform as a snapshot of the open entity. */
    private snapshotFromProxy(from: EntitySnapshot): EntitySnapshot {
        const p = this.proxy.position;
        const q = this.proxy.quaternion;
        // Lifted off the ground: keep the height, or a reload would re-ground it.
        const grounded = Math.abs(p.y - getGroundHeight(p.x, p.z)) < 0.05;
        return {
            ...from,
            entity: {
                ...from.entity,
                position: [round(p.x), round(p.y), round(p.z)],
                rotation: { quat: [round(q.x, 6), round(q.y, 6), round(q.z, 6), round(q.w, 6)] },
                scale: round(this.proxy.scale.x),
                placement: grounded ? from.entity.placement : 'absolute',
            },
        };
    }

    private commit(): void {
        const from = this.current;
        if (!from) return;
        const to = this.snapshotFromProxy(from);
        const live = this.callbacks.onCommit(from, to);
        this.current = live ?? from;
        // A refused move snaps the proxy back to where the entity actually is.
        this.placeProxy(this.current);
    }
}
