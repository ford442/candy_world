/**
 * @file src/systems/net/remote-cursors.ts
 * @brief Co-editors' build cursors (#1975): a ring where each peer aims, and
 * a smaller ring on each piece they have selected, in their avatar colour.
 *
 * One shared ring geometry, one material per peer colour; meshes are pooled
 * and hidden rather than disposed. A cursor fades out a few seconds after the
 * peer's last `cursor` message.
 */

import * as THREE from 'three';
import type { CursorMessage } from './world-sync-protocol.ts';

const CANDY_COLORS = [0xff69b4, 0x87cefa, 0x98fb98, 0xffd1dc, 0xe6e6fa, 0xffb347];
const STALE_MS = 3000;
const MAX_SELECTION_RINGS = 32;

function colorFor(peerId: string): number {
    let h = 0;
    for (let i = 0; i < peerId.length; i++) h = (Math.imul(31, h) + peerId.charCodeAt(i)) | 0;
    return CANDY_COLORS[Math.abs(h) % CANDY_COLORS.length];
}

interface PeerCursor {
    aim: THREE.Mesh;
    picks: THREE.Mesh[];
    material: THREE.MeshBasicMaterial;
    lastSeen: number;
}

export class RemoteCursors {
    private readonly root = new THREE.Group();
    private readonly aimGeo: THREE.RingGeometry;
    private readonly pickGeo: THREE.RingGeometry;
    private readonly peers = new Map<string, PeerCursor>();

    constructor(
        scene: THREE.Scene,
        /** World position of an entity id (for selection rings), or null. */
        private readonly locate: (entityId: string) => THREE.Vector3 | null
    ) {
        this.root.name = 'remote-build-cursors';
        this.aimGeo = new THREE.RingGeometry(0.55, 0.75, 32);
        this.aimGeo.rotateX(-Math.PI / 2);
        this.pickGeo = new THREE.RingGeometry(0.9, 1.0, 24);
        this.pickGeo.rotateX(-Math.PI / 2);
        scene.add(this.root);
    }

    update(message: CursorMessage, now: number): void {
        const cursor = this.cursorFor(message.author);
        cursor.lastSeen = now;
        if (message.pos) {
            cursor.aim.position.set(message.pos[0], message.pos[1] + 0.06, message.pos[2]);
            cursor.aim.visible = true;
        } else {
            cursor.aim.visible = false;
        }
        let i = 0;
        for (const id of message.selection.slice(0, MAX_SELECTION_RINGS)) {
            const at = this.locate(id);
            if (!at) continue;
            let ring = cursor.picks[i];
            if (!ring) {
                ring = new THREE.Mesh(this.pickGeo, cursor.material);
                ring.renderOrder = 9998;
                this.root.add(ring);
                cursor.picks.push(ring);
            }
            ring.position.set(at.x, at.y + 0.08, at.z);
            ring.visible = true;
            i++;
        }
        for (; i < cursor.picks.length; i++) cursor.picks[i].visible = false;
    }

    /** Hide cursors whose peer went quiet. Cheap; call a few times a second. */
    prune(now: number): void {
        for (const cursor of this.peers.values()) {
            if (now - cursor.lastSeen < STALE_MS) continue;
            cursor.aim.visible = false;
            for (const ring of cursor.picks) ring.visible = false;
        }
    }

    remove(peerId: string): void {
        const cursor = this.peers.get(peerId);
        if (!cursor) return;
        this.root.remove(cursor.aim, ...cursor.picks);
        cursor.material.dispose();
        this.peers.delete(peerId);
    }

    dispose(): void {
        for (const id of [...this.peers.keys()]) this.remove(id);
        this.aimGeo.dispose();
        this.pickGeo.dispose();
        this.root.removeFromParent();
    }

    private cursorFor(peerId: string): PeerCursor {
        let cursor = this.peers.get(peerId);
        if (cursor) return cursor;
        const material = new THREE.MeshBasicMaterial({
            color: colorFor(peerId),
            transparent: true,
            opacity: 0.85,
            depthTest: false,
            depthWrite: false,
        });
        const aim = new THREE.Mesh(this.aimGeo, material);
        aim.renderOrder = 9998;
        aim.visible = false;
        this.root.add(aim);
        cursor = { aim, picks: [], material, lastSeen: 0 };
        this.peers.set(peerId, cursor);
        return cursor;
    }
}
