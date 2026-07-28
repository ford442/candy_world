/**
 * Remote peer avatars — pooled instanced candy meshes + HTML name tags.
 */

import * as THREE from 'three';
import { MeshPhysicalMaterial } from 'three';
import { foliageGroup } from '../../world/state.ts';
import { CONFIG } from '../../core/config.ts';
import type { RemotePeer } from './presence-types.ts';

const _scratchPos = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3(1, 1, 1);
const _scratchMat = new THREE.Matrix4();
const _scratchHide = new THREE.Matrix4();
const _interpPos = new THREE.Vector3();
const _interpQuat = new THREE.Quaternion();

const CANDY_COLORS = [0xff69b4, 0x87cefa, 0x98fb98, 0xffd1dc, 0xe6e6fa, 0xffb347];

function hashToColor(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) {
        h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
    }
    return CANDY_COLORS[Math.abs(h) % CANDY_COLORS.length];
}

interface TagSlot {
    el: HTMLDivElement;
    peerId: string | null;
    visible: boolean;
}

export class RemoteAvatars {
    private static _instance: RemoteAvatars | null = null;

    private _mesh: THREE.InstancedMesh | null = null;
    private _peerOrder: string[] = [];
    private _peerToSlot = new Map<string, number>();
    private _slotPeer: (string | null)[] = [];
    private _tags: TagSlot[] = [];
    private _tagRoot: HTMLDivElement | null = null;
    private _camera: THREE.PerspectiveCamera | null = null;
    private _renderer: THREE.Renderer | null = null;
    private _initialized = false;
    private _interpDelayMs = 100;

    static getInstance(): RemoteAvatars {
        if (!RemoteAvatars._instance) {
            RemoteAvatars._instance = new RemoteAvatars();
        }
        return RemoteAvatars._instance;
    }

    init(_scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.Renderer): void {
        if (this._initialized) return;

        const maxPeers = CONFIG.presence?.maxPeers ?? 16;
        const geo = new THREE.SphereGeometry(0.35, 12, 10);
        geo.translate(0, 0.35, 0);

        const mat = new MeshPhysicalMaterial({
            color: 0xff69b4,
            roughness: 0.25,
            metalness: 0,
            clearcoat: 0.85,
            clearcoatRoughness: 0.15,
        });

        this._mesh = new THREE.InstancedMesh(geo, mat, maxPeers);
        this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this._mesh.frustumCulled = false;
        this._mesh.count = 0;
        this._mesh.name = 'remote-presence-avatars';

        foliageGroup.add(this._mesh);

        _scratchHide.makeScale(0, 0, 0);
        this._slotPeer = new Array(maxPeers).fill(null);
        for (let i = 0; i < maxPeers; i++) {
            this._mesh.setMatrixAt(i, _scratchHide);
        }
        this._mesh.instanceMatrix.needsUpdate = true;

        this._tagRoot = document.createElement('div');
        this._tagRoot.id = 'presence-tags';
        this._tagRoot.style.cssText =
            'position:fixed;inset:0;pointer-events:none;z-index:150;overflow:hidden;';
        document.body.appendChild(this._tagRoot);

        for (let i = 0; i < maxPeers; i++) {
            const el = document.createElement('div');
            el.className = 'presence-tag';
            el.style.cssText =
                'position:absolute;transform:translate(-50%,-100%);white-space:nowrap;' +
                'font-size:12px;font-weight:600;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.5);' +
                'padding:2px 6px;border-radius:8px;background:rgba(255,105,180,0.55);display:none;';
            this._tagRoot.appendChild(el);
            this._tags.push({ el, peerId: null, visible: false });
        }

        this._camera = camera;
        this._renderer = renderer;
        this._initialized = true;
    }

    dispose(): void {
        if (this._mesh) {
            foliageGroup.remove(this._mesh);
            this._mesh.geometry.dispose();
            (this._mesh.material as THREE.Material).dispose();
            this._mesh = null;
        }
        if (this._tagRoot?.parentNode) {
            this._tagRoot.parentNode.removeChild(this._tagRoot);
        }
        this._tagRoot = null;
        this._tags = [];
        this._peerOrder = [];
        this._peerToSlot.clear();
        this._initialized = false;
    }

    private _allocateSlot(peerId: string): number | null {
        const maxPeers = CONFIG.presence?.maxPeers ?? 16;
        const existing = this._peerToSlot.get(peerId);
        if (existing !== undefined) return existing;

        for (let i = 0; i < maxPeers; i++) {
            if (this._slotPeer[i] === null) {
                this._slotPeer[i] = peerId;
                this._peerToSlot.set(peerId, i);
                if (!this._peerOrder.includes(peerId)) {
                    this._peerOrder.push(peerId);
                }
                return i;
            }
        }
        return null;
    }

    private _freeSlot(peerId: string): void {
        const slot = this._peerToSlot.get(peerId);
        if (slot === undefined || !this._mesh) return;
        this._slotPeer[slot] = null;
        this._peerToSlot.delete(peerId);
        const idx = this._peerOrder.indexOf(peerId);
        if (idx >= 0) this._peerOrder.splice(idx, 1);
        this._mesh.setMatrixAt(slot, _scratchHide);
        const tag = this._tags[slot];
        if (tag) {
            tag.peerId = null;
            tag.visible = false;
            tag.el.style.display = 'none';
        }
    }

    private _samplePose(
        peer: RemotePeer,
        now: number,
        outPos: THREE.Vector3,
        outQuat: THREE.Quaternion
    ): boolean {
        const snaps = peer.snapshots;
        if (snaps.length === 0) return false;

        const renderTime = now - this._interpDelayMs;
        if (snaps.length === 1 || renderTime <= snaps[0].ts) {
            const s = snaps[snaps.length - 1];
            outPos.set(s.pos[0], s.pos[1], s.pos[2]);
            outQuat.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]);
            return true;
        }

        let a = snaps[0];
        let b = snaps[snaps.length - 1];
        for (let i = 0; i < snaps.length - 1; i++) {
            if (snaps[i].ts <= renderTime && snaps[i + 1].ts >= renderTime) {
                a = snaps[i];
                b = snaps[i + 1];
                break;
            }
        }

        const span = Math.max(1, b.ts - a.ts);
        const t = THREE.MathUtils.clamp((renderTime - a.ts) / span, 0, 1);
        outPos.set(
            THREE.MathUtils.lerp(a.pos[0], b.pos[0], t),
            THREE.MathUtils.lerp(a.pos[1], b.pos[1], t),
            THREE.MathUtils.lerp(a.pos[2], b.pos[2], t)
        );
        outQuat.set(a.quat[0], a.quat[1], a.quat[2], a.quat[3]);
        _scratchQuat.set(b.quat[0], b.quat[1], b.quat[2], b.quat[3]);
        outQuat.slerp(_scratchQuat, t);
        return true;
    }

    syncPeers(peers: Map<string, RemotePeer>, localPlayerPos: THREE.Vector3): void {
        if (!this._initialized || !this._mesh || !this._camera) return;

        const cullDist = CONFIG.presence?.cullDistance ?? 120;
        const cullDistSq = cullDist * cullDist;
        const now = performance.now();
        let visibleCount = 0;

        const activeIds = new Set(peers.keys());
        for (const peerId of [...this._peerOrder]) {
            if (!activeIds.has(peerId)) this._freeSlot(peerId);
        }

        for (const [peerId, peer] of peers) {
            const slot = this._allocateSlot(peerId);
            if (slot === null) continue;

            if (!this._samplePose(peer, now, _interpPos, _interpQuat)) continue;

            const dx = _interpPos.x - localPlayerPos.x;
            const dz = _interpPos.z - localPlayerPos.z;
            const distSq = dx * dx + dz * dz;
            const inRange = distSq <= cullDistSq;

            if (inRange) {
                _scratchScale.set(1, 1, 1);
                _scratchMat.compose(_interpPos, _interpQuat, _scratchScale);
                this._mesh.setMatrixAt(slot, _scratchMat);
                visibleCount++;

                const tag = this._tags[slot];
                const tint = hashToColor(peerId);
                if (tag) {
                    tag.peerId = peerId;
                    tag.visible = true;
                    tag.el.textContent = `${peer.emoji} ${peer.label}`;
                    tag.el.style.display = 'block';
                    tag.el.style.background = `rgba(${(tint >> 16) & 255}, ${(tint >> 8) & 255}, ${tint & 255}, 0.55)`;
                }
            } else {
                this._mesh.setMatrixAt(slot, _scratchHide);
                const tag = this._tags[slot];
                if (tag) {
                    tag.visible = false;
                    tag.el.style.display = 'none';
                }
            }
        }

        this._mesh.count = Math.max(visibleCount, this._peerToSlot.size);
        this._mesh.instanceMatrix.needsUpdate = true;
    }

    updateTags(): void {
        if (!this._camera || !this._renderer || !this._mesh) return;

        const canvas = this._renderer.domElement;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (w === 0 || h === 0) return;

        for (let slot = 0; slot < this._tags.length; slot++) {
            const tag = this._tags[slot];
            if (!tag.visible || !tag.peerId) continue;

            this._mesh.getMatrixAt(slot, _scratchMat);
            _scratchMat.decompose(_scratchPos, _scratchQuat, _scratchScale);
            _scratchPos.y += 0.9;
            _scratchPos.project(this._camera);

            if (_scratchPos.z > 1) {
                tag.el.style.display = 'none';
                continue;
            }

            const sx = (_scratchPos.x * 0.5 + 0.5) * w;
            const sy = (-_scratchPos.y * 0.5 + 0.5) * h;
            tag.el.style.display = 'block';
            tag.el.style.left = `${sx}px`;
            tag.el.style.top = `${sy}px`;
        }
    }
}

export const remoteAvatars = RemoteAvatars.getInstance();
