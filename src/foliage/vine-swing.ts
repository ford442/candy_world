/**
 * Pendulum physics for swingable vines.
 *
 * Kept as a leaf (three + the WASM interact bridge only) so that
 * world/state.ts can reference VineSwing without pulling the foliage graph.
 */
import * as THREE from 'three';
import { calcVineDetachImpulse } from '../utils/wasm-foliage-interact.ts';

const _scratchPhysicsVec1 = new THREE.Vector3();
const _scratchPhysicsVec2 = new THREE.Vector3();

export interface InputState {
    forward: boolean;
    backward: boolean;
}
export interface PlayerObject extends THREE.Object3D {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
}
export class VineSwing {
    vine: THREE.Object3D;
    anchorPoint: THREE.Vector3;
    length: number;
    isPlayerAttached: boolean;
    swingAngle: number;
    swingAngularVel: number;
    swingPlane: THREE.Vector3;
    rotationAxis: THREE.Vector3;
    defaultDown: THREE.Vector3;
    constructor(vineMesh: THREE.Object3D, length = 8) {
        this.vine = vineMesh;
        this.anchorPoint = vineMesh.position.clone();
        this.length = length;
        this.isPlayerAttached = false;
        this.swingAngle = 0;
        this.swingAngularVel = 0;
        this.swingPlane = new THREE.Vector3(1, 0, 0);
        this.rotationAxis = new THREE.Vector3(0, 0, 1);
        this.defaultDown = new THREE.Vector3(0, -1, 0);
    }
    update(player: PlayerObject, delta: number, inputState: InputState | null): void {
        const gravity = 20.0;
        const damping = 0.99;
        const angularAccel = (-gravity / this.length) * Math.sin(this.swingAngle);
        this.swingAngularVel += angularAccel * delta;
        this.swingAngularVel *= damping;
        if (this.isPlayerAttached && inputState) {
            const pumpForce = 3.0;
            if (inputState.forward) {
                if (Math.abs(this.swingAngularVel) > 0.1) {
                    this.swingAngularVel += Math.sign(this.swingAngularVel) * pumpForce * delta;
                } else {
                    this.swingAngularVel += pumpForce * delta;
                }
            } else if (inputState.backward) {
                this.swingAngularVel -= Math.sign(this.swingAngularVel) * pumpForce * delta;
            }
        }
        this.swingAngle += this.swingAngularVel * delta;
        const maxAngle = Math.PI * 0.45;
        if (this.swingAngle > maxAngle) {
            this.swingAngle = maxAngle;
            this.swingAngularVel *= -0.5;
        } else if (this.swingAngle < -maxAngle) {
            this.swingAngle = -maxAngle;
            this.swingAngularVel *= -0.5;
        }
        const dy = -Math.cos(this.swingAngle) * this.length;
        const dh = Math.sin(this.swingAngle) * this.length;
        const targetPos = _scratchPhysicsVec1.copy(this.anchorPoint);
        targetPos.y += dy;
        targetPos.addScaledVector(this.swingPlane, dh);
        if (this.isPlayerAttached) {
            player.position.copy(targetPos);
        }
        const dir = _scratchPhysicsVec2.subVectors(targetPos, this.anchorPoint).normalize();
        this.vine.quaternion.setFromUnitVectors(this.defaultDown, dir);
    }
    detach(player: PlayerObject): number {
        this.isPlayerAttached = false;
        const impulse = calcVineDetachImpulse(
            this.length,
            this.swingAngle,
            this.swingAngularVel,
            this.swingPlane.x,
            this.swingPlane.z
        );
        player.velocity.x = impulse.vx;
        player.velocity.y = impulse.vy;
        player.velocity.z = impulse.vz;
        return Date.now();
    }
}
