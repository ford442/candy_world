/**
 * Rigid-body debug staging area — `?debugPhysics=1`.
 *
 * Spawns a small set of bumpable candy props near the player spawn and draws
 * wireframe collider gizmos for every live body. This is the demo surface for
 * the dynamic rigid-body layer (`src/systems/physics/rigid-bodies.ts`); nothing
 * in here loads unless the flag is set.
 *
 * It also builds the joint staging area: a candy swing (hinge), a bouncing
 * gumdrop pad (spring), and a charm welded to the swing seat (fixed joint),
 * with constraint gizmos drawn for every live joint.
 *
 * Controls (while the flag is on):
 *   G — respawn the props and toys at their starting positions
 *   B — radial blast at the player, to sanity-check ability-style impulses
 *
 * G and B are both unbound in the main input map; R is deliberately avoided
 * because it is Dance Mode.
 */

import * as THREE from 'three';
import {
    applyRigidBodyRadialImpulse,
    clearRigidBodies,
    getRigidBodyPool,
    initRigidBodies,
    spawnRigidBody,
    MAX_DYNAMIC_BODIES,
    RB_FIELD as F,
    RB_FLAG,
    RB_FLOATS_PER_BODY,
    RB_SHAPE,
    type RigidBodyHandle,
    type RigidBodyShape,
} from '../systems/physics/rigid-bodies.ts';
import {
    clearJoints,
    createFixed,
    createHinge,
    createSpring,
    getJointCount,
    getJointError,
    getJointHighWater,
    getJointPool,
    initJoints,
    jointAnchorWorld,
    J_FIELD as JF,
    J_FLAG,
    J_FLOATS_PER_JOINT,
    JOINT_TYPE,
    MAX_JOINTS,
    type JointHandle,
} from '../systems/physics/joints.ts';
import { getUnifiedGroundHeightTyped } from '../systems/physics.core.ts';

interface PropSpec {
    name: string;
    shape: RigidBodyShape;
    color: number;
    mass: number;
    restitution: number;
    friction: number;
    radius: number;
    halfHeight: number;
    halfDepth: number;
    /** Offset from the staging origin, in world units. */
    dx: number;
    dz: number;
    dy: number;
}

// 6 props: enough to feel like a play space, well inside the 64-body budget.
const PROPS: PropSpec[] = [
    {
        name: 'gumdrop-pink',
        shape: RB_SHAPE.SPHERE,
        color: 0xff69b4,
        mass: 1.2,
        restitution: 0.55,
        friction: 0.35,
        radius: 0.6,
        halfHeight: 0.6,
        halfDepth: 0.6,
        dx: -3.0,
        dz: 0.0,
        dy: 3.0,
    },
    {
        name: 'gumdrop-mint',
        shape: RB_SHAPE.SPHERE,
        color: 0x9fe8c8,
        mass: 0.8,
        restitution: 0.7,
        friction: 0.25,
        radius: 0.45,
        halfHeight: 0.45,
        halfDepth: 0.45,
        dx: -1.4,
        dz: 1.6,
        dy: 4.2,
    },
    {
        name: 'jelly-cube',
        shape: RB_SHAPE.BOX,
        color: 0xffd6e8,
        mass: 2.5,
        restitution: 0.2,
        friction: 0.6,
        radius: 0.55,
        halfHeight: 0.55,
        halfDepth: 0.55,
        dx: 0.4,
        dz: -1.2,
        dy: 3.4,
    },
    {
        name: 'licorice-crate',
        shape: RB_SHAPE.BOX,
        color: 0x6b4a7a,
        mass: 4.0,
        restitution: 0.1,
        friction: 0.8,
        radius: 0.7,
        halfHeight: 0.7,
        halfDepth: 0.7,
        dx: 2.2,
        dz: 0.8,
        dy: 3.0,
    },
    {
        name: 'candy-cane',
        shape: RB_SHAPE.CAPSULE,
        color: 0xfff4f8,
        mass: 1.5,
        restitution: 0.3,
        friction: 0.5,
        radius: 0.32,
        halfHeight: 0.75,
        halfDepth: 0.32,
        dx: 3.6,
        dz: -1.8,
        dy: 4.8,
    },
    {
        name: 'bonbon-lilac',
        shape: RB_SHAPE.SPHERE,
        color: 0xc9b6ff,
        mass: 0.6,
        restitution: 0.8,
        friction: 0.2,
        radius: 0.38,
        halfHeight: 0.38,
        halfDepth: 0.38,
        dx: 1.1,
        dz: 2.4,
        dy: 5.5,
    },
];

const GIZMO_AWAKE = 0xff2d8f;
const GIZMO_ASLEEP = 0x4a7fd4;
/** Constraint gizmos: the link between anchors, and the hinge axis. */
const GIZMO_LINK = 0xffe066;
const GIZMO_AXIS = 0x66ffd6;
/** Half-length of the drawn hinge-axis marker, in world units. */
const AXIS_MARKER = 0.6;

/**
 * The joint staging area. Offsets are relative to the staging origin (normally
 * the player spawn), heights relative to the ground under each anchor.
 *
 * Deliberately three toys, one per joint type, close enough together that the
 * player can walk into all of them without hunting.
 */
const SWING = {
    /** Beam that carries the hinge pivot. */
    dx: -6.0,
    dz: 3.0,
    pivotHeight: 4.4,
    /** Arm length: how far the seat hangs below the pivot. */
    arm: 2.2,
    /** Hinge axis — +Z, so the seat swings along X, across the approach path. */
    axis: { x: 0, y: 0, z: 1 },
    seatRadius: 0.5,
    seatMass: 2.0,
    /** A charm welded to the seat, to show a fixed joint riding along. */
    charmOffset: 0.62,
    charmRadius: 0.22,
    charmMass: 0.3,
};

const PAD = {
    dx: -6.0,
    dz: -1.5,
    anchorHeight: 3.6,
    /** Spring rest length, and where the gumdrop starts (stretched, so it bobs). */
    rest: 1.4,
    startDrop: 2.2,
    stiffness: 320,
    damping: 9,
    radius: 0.55,
    mass: 1.0,
};

let _enabled = false;
let _scene: THREE.Scene | null = null;
const _origin = new THREE.Vector3();

/** Joint-staging bookkeeping, torn down alongside the props. */
const _joints: JointHandle[] = [];
const _toyMeshes: THREE.Mesh[] = [];
let _jointGizmo: THREE.LineSegments | null = null;
let _jointGizmoPositions: Float32Array | null = null;
let _usingJointWasm = false;

const _handles: (RigidBodyHandle | null)[] = [];
const _meshes: THREE.Mesh[] = [];
const _gizmos: (THREE.LineSegments | null)[] = new Array(MAX_DYNAMIC_BODIES).fill(null);

const _gizmoAwakeMat = new THREE.LineBasicMaterial({
    color: GIZMO_AWAKE,
    transparent: true,
    opacity: 0.85,
});
const _gizmoAsleepMat = new THREE.LineBasicMaterial({
    color: GIZMO_ASLEEP,
    transparent: true,
    opacity: 0.45,
});

let _keyHandler: ((e: KeyboardEvent) => void) | null = null;
let _playerRef: THREE.Vector3 | null = null;
let _usingWasm = false;

export function isPhysicsSandboxEnabled(): boolean {
    return _enabled;
}

/**
 * Build the staging area around `origin` (normally the player spawn).
 * Safe to call twice — the second call rebuilds.
 */
export function initPhysicsSandbox(scene: THREE.Scene, origin: THREE.Vector3): void {
    _enabled = true;
    _scene = scene;
    _origin.copy(origin);

    const wasm = initRigidBodies();
    _usingWasm = wasm;
    _usingJointWasm = initJoints();
    // console.warn, not .log: the project's lint config only permits warn/error,
    // and a debug staging area being live is worth surfacing loudly anyway.
    console.warn(
        `[physics-sandbox] Enabled — ${PROPS.length} props, solver: ${wasm ? 'WASM (AssemblyScript)' : 'JS fallback'}, ` +
            `joints: ${_usingJointWasm ? 'WASM (AssemblyScript)' : 'JS fallback'}`
    );

    teardownProps();
    spawnProps();
    spawnToys();
    installKeys();
    exposeDebugHandle();
}

/**
 * Expose a small inspection handle so the sandbox can be poked from the
 * console (and asserted against in browser-driven checks). Debug-flag only.
 */
function exposeDebugHandle(): void {
    (window as unknown as Record<string, unknown>).__physicsSandbox = {
        props: () => _meshes.length,
        bodies: () => _handles.filter(Boolean).length,
        gizmos: () => _gizmos.filter(Boolean).length,
        usingWasm: () => _usingWasm,
        usingJointWasm: () => _usingJointWasm,
        joints: () => getJointCount(),
        jointErrors: () => _joints.map((h) => Number(getJointError(h).toFixed(4))),
        positions: () =>
            _meshes.map((m) => [
                Number(m.position.x.toFixed(3)),
                Number(m.position.y.toFixed(3)),
                Number(m.position.z.toFixed(3)),
            ]),
        blast: (radius = 8, strength = 28) =>
            applyRigidBodyRadialImpulse(
                (_playerRef ?? _origin).x,
                (_playerRef ?? _origin).y - 0.9,
                (_playerRef ?? _origin).z,
                radius,
                strength,
                0.5
            ),
    };
}

/** Track the player so the blast hotkey knows where to detonate. */
export function setPhysicsSandboxPlayer(position: THREE.Vector3): void {
    _playerRef = position;
}

function spawnProps(): void {
    const scene = _scene;
    if (!scene) return;

    for (const spec of PROPS) {
        const x = _origin.x + spec.dx;
        const z = _origin.z + spec.dz;
        const groundY = getUnifiedGroundHeightTyped(x, z);
        const y = (Number.isFinite(groundY) ? groundY : _origin.y) + spec.dy;

        const mesh = new THREE.Mesh(geometryFor(spec), materialFor(spec));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.position.set(x, y, z);
        mesh.userData.debugProp = spec.name;
        scene.add(mesh);
        _meshes.push(mesh);

        const handle = spawnRigidBody({
            shape: spec.shape,
            x,
            y,
            z,
            mass: spec.mass,
            restitution: spec.restitution,
            friction: spec.friction,
            radius: spec.radius,
            halfHeight: spec.halfHeight,
            halfDepth: spec.halfDepth,
            object: mesh,
        });
        _handles.push(handle);

        if (handle) {
            const gizmo = makeGizmo(spec);
            gizmo.frustumCulled = false;
            gizmo.position.copy(mesh.position);
            scene.add(gizmo);
            _gizmos[handle.id] = gizmo;
        }
    }
}

/**
 * Build the joint staging area: one toy per joint type.
 *
 * Every body here is spawned first and joined second — a joint binds to the
 * configuration that exists at creation time, so the arm length and spring rest
 * length are read off the placement rather than being asserted onto it.
 */
function spawnToys(): void {
    const scene = _scene;
    if (!scene) return;

    // --- Candy swing: kinematic beam + hinge + a welded charm ---------------
    const swingX = _origin.x + SWING.dx;
    const swingZ = _origin.z + SWING.dz;
    const swingGround = groundAt(swingX, swingZ);
    const pivotY = swingGround + SWING.pivotHeight;

    // A visual-only beam. The pivot itself is a kinematic body so gameplay
    // could later slide the whole swing without touching the constraint.
    const beam = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, SWING.pivotHeight, 0.18),
        new THREE.MeshPhysicalMaterial({ color: 0xe8d5f5, roughness: 0.4, clearcoat: 0.6 })
    );
    beam.position.set(swingX, swingGround + SWING.pivotHeight * 0.5, swingZ);
    beam.frustumCulled = false;
    scene.add(beam);
    _toyMeshes.push(beam);

    const pivotHandle = spawnRigidBody({
        shape: RB_SHAPE.SPHERE,
        x: swingX,
        y: pivotY,
        z: swingZ,
        kinematic: true,
        radius: 0.12,
    });

    const seatMesh = makeToyMesh(new THREE.SphereGeometry(SWING.seatRadius, 20, 14), 0xff9ecb);
    // Released from horizontal so the swing is visibly moving on arrival.
    const seatX = swingX + SWING.arm;
    seatMesh.position.set(seatX, pivotY, swingZ);
    scene.add(seatMesh);
    _toyMeshes.push(seatMesh);

    const seat = spawnRigidBody({
        shape: RB_SHAPE.SPHERE,
        x: seatX,
        y: pivotY,
        z: swingZ,
        mass: SWING.seatMass,
        restitution: 0.2,
        friction: 0.4,
        radius: SWING.seatRadius,
        object: seatMesh,
    });

    if (seat) {
        const hinge = createHinge(
            pivotHandle,
            seat,
            { x: swingX, y: pivotY, z: swingZ },
            SWING.axis
        );
        if (hinge) _joints.push(hinge);

        // A charm welded to the seat: it has to ride the arc without being
        // constrained to the pivot itself.
        const charmMesh = makeToyMesh(new THREE.SphereGeometry(SWING.charmRadius, 12, 8), 0xfff2a8);
        const charmY = pivotY - SWING.charmOffset;
        charmMesh.position.set(seatX, charmY, swingZ);
        scene.add(charmMesh);
        _toyMeshes.push(charmMesh);

        const charm = spawnRigidBody({
            shape: RB_SHAPE.SPHERE,
            x: seatX,
            y: charmY,
            z: swingZ,
            mass: SWING.charmMass,
            restitution: 0.1,
            friction: 0.5,
            radius: SWING.charmRadius,
            object: charmMesh,
        });
        if (charm) {
            const weld = createFixed(seat, charm);
            if (weld) _joints.push(weld);
        }
    }

    // --- Bouncing pad: kinematic anchor + spring ----------------------------
    const padX = _origin.x + PAD.dx;
    const padZ = _origin.z + PAD.dz;
    const anchorY = groundAt(padX, padZ) + PAD.anchorHeight;

    const anchorMesh = makeToyMesh(new THREE.SphereGeometry(0.16, 10, 8), 0xc9b6ff);
    anchorMesh.position.set(padX, anchorY, padZ);
    scene.add(anchorMesh);
    _toyMeshes.push(anchorMesh);

    const anchor = spawnRigidBody({
        shape: RB_SHAPE.SPHERE,
        x: padX,
        y: anchorY,
        z: padZ,
        kinematic: true,
        radius: 0.16,
    });

    const bobMesh = makeToyMesh(new THREE.SphereGeometry(PAD.radius, 20, 14), 0x9fe8c8);
    const bobY = anchorY - PAD.startDrop;
    bobMesh.position.set(padX, bobY, padZ);
    scene.add(bobMesh);
    _toyMeshes.push(bobMesh);

    const bob = spawnRigidBody({
        shape: RB_SHAPE.SPHERE,
        x: padX,
        y: bobY,
        z: padZ,
        mass: PAD.mass,
        restitution: 0.3,
        friction: 0.3,
        radius: PAD.radius,
        object: bobMesh,
    });

    if (anchor && bob) {
        // Starts stretched past its rest length, so it bobs on arrival.
        const spring = createSpring(anchor, bob, PAD.rest, PAD.stiffness, PAD.damping);
        if (spring) _joints.push(spring);
    }

    ensureJointGizmo(scene);
    console.warn(`[physics-sandbox] ${_joints.length} joints staged`);
}

function groundAt(x: number, z: number): number {
    const y = getUnifiedGroundHeightTyped(x, z);
    return Number.isFinite(y) ? y : _origin.y;
}

function makeToyMesh(geo: THREE.BufferGeometry, color: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshPhysicalMaterial({
            color,
            roughness: 0.3,
            metalness: 0.0,
            clearcoat: 0.8,
            clearcoatRoughness: 0.2,
        })
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
}

/**
 * One LineSegments for every constraint, with a fixed-size vertex buffer.
 * Two segments per joint: the anchor-to-anchor link, and (hinge only) a marker
 * along the rotation axis through the pivot. Vertex colors distinguish them.
 */
function ensureJointGizmo(scene: THREE.Scene): void {
    if (_jointGizmo) return;

    const segmentsPerJoint = 2;
    const verts = MAX_JOINTS * segmentsPerJoint * 2;
    _jointGizmoPositions = new Float32Array(verts * 3);
    const colors = new Float32Array(verts * 3);

    const link = new THREE.Color(GIZMO_LINK);
    const axis = new THREE.Color(GIZMO_AXIS);
    for (let i = 0; i < MAX_JOINTS; i++) {
        // Vertices 0-1 are the link, 2-3 the axis marker.
        for (let v = 0; v < 4; v++) {
            const c = v < 2 ? link : axis;
            const o = (i * 4 + v) * 3;
            colors[o] = c.r;
            colors[o + 1] = c.g;
            colors[o + 2] = c.b;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(_jointGizmoPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    _jointGizmo = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })
    );
    _jointGizmo.frustumCulled = false;
    _jointGizmo.renderOrder = 2;
    scene.add(_jointGizmo);
}

/**
 * Repaint the constraint gizmos from the shared pools. Allocation-free: writes
 * straight into the pre-sized position buffer and moves the draw range.
 */
function updateJointGizmo(): void {
    const gizmo = _jointGizmo;
    const out = _jointGizmoPositions;
    if (!gizmo || !out) return;

    const joints = getJointPool();
    const bodies = getRigidBodyPool();
    if (!joints || !bodies) {
        gizmo.geometry.setDrawRange(0, 0);
        return;
    }

    const limit = Math.min(getJointHighWater(), MAX_JOINTS);
    let vertex = 0;

    for (let id = 0; id < limit; id++) {
        const j = id * J_FLOATS_PER_JOINT;
        if (!(joints[j + JF.FLAGS] & J_FLAG.ACTIVE)) continue;

        const a = joints[j + JF.BODY_A];
        const b = joints[j + JF.BODY_B];
        const [ax, ay, az] = jointAnchorWorld(joints, bodies, j, a, JF.AX);
        const [bx, by, bz] = jointAnchorWorld(joints, bodies, j, b, JF.BX);

        // Segment 1: the constraint itself, anchor to anchor.
        out[vertex * 3] = ax;
        out[vertex * 3 + 1] = ay;
        out[vertex * 3 + 2] = az;
        vertex++;
        out[vertex * 3] = bx;
        out[vertex * 3 + 1] = by;
        out[vertex * 3 + 2] = bz;
        vertex++;

        // Segment 2: the hinge axis through the pivot. Degenerate (zero-length,
        // so invisible) for the other types, which keeps the layout uniform.
        let hx = 0;
        let hy = 0;
        let hz = 0;
        if (joints[j + JF.TYPE] === JOINT_TYPE.HINGE) {
            hx = joints[j + JF.P0] * AXIS_MARKER;
            hy = joints[j + JF.P1] * AXIS_MARKER;
            hz = joints[j + JF.P2] * AXIS_MARKER;
        }
        out[vertex * 3] = ax - hx;
        out[vertex * 3 + 1] = ay - hy;
        out[vertex * 3 + 2] = az - hz;
        vertex++;
        out[vertex * 3] = ax + hx;
        out[vertex * 3 + 1] = ay + hy;
        out[vertex * 3 + 2] = az + hz;
        vertex++;
    }

    gizmo.geometry.setDrawRange(0, vertex);
    (gizmo.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
}

function geometryFor(spec: PropSpec): THREE.BufferGeometry {
    switch (spec.shape) {
        case RB_SHAPE.BOX:
            return new THREE.BoxGeometry(spec.radius * 2, spec.halfHeight * 2, spec.halfDepth * 2);
        case RB_SHAPE.CAPSULE:
            return new THREE.CapsuleGeometry(spec.radius, spec.halfHeight * 2, 6, 12);
        default:
            return new THREE.SphereGeometry(spec.radius, 20, 14);
    }
}

function materialFor(spec: PropSpec): THREE.Material {
    return new THREE.MeshPhysicalMaterial({
        color: spec.color,
        roughness: 0.3,
        metalness: 0.0,
        clearcoat: 0.8,
        clearcoatRoughness: 0.2,
    });
}

/** Wireframe hull matching the *collider*, not the render mesh. */
function makeGizmo(spec: PropSpec): THREE.LineSegments {
    let geo: THREE.BufferGeometry;
    switch (spec.shape) {
        case RB_SHAPE.BOX:
            geo = new THREE.BoxGeometry(spec.radius * 2, spec.halfHeight * 2, spec.halfDepth * 2);
            break;
        case RB_SHAPE.CAPSULE:
            geo = new THREE.CapsuleGeometry(spec.radius, spec.halfHeight * 2, 4, 8);
            break;
        default:
            geo = new THREE.SphereGeometry(spec.radius, 12, 8);
            break;
    }
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 1), _gizmoAsleepMat);
    geo.dispose();
    return wire;
}

/**
 * Per-frame gizmo refresh. The prop meshes themselves are driven by the
 * bridge's transform sync, so this only moves and recolors the wireframes.
 */
export function updatePhysicsSandbox(): void {
    if (!_enabled) return;
    const pool = getRigidBodyPool();
    if (!pool) return;

    for (let id = 0; id < MAX_DYNAMIC_BODIES; id++) {
        const gizmo = _gizmos[id];
        if (!gizmo) continue;
        const b = id * RB_FLOATS_PER_BODY;
        const flags = pool[b + F.FLAGS];
        if (!(flags & RB_FLAG.ACTIVE)) {
            gizmo.visible = false;
            continue;
        }
        gizmo.visible = true;
        gizmo.position.set(pool[b + F.PX], pool[b + F.PY], pool[b + F.PZ]);
        gizmo.material = flags & RB_FLAG.SLEEPING ? _gizmoAsleepMat : _gizmoAwakeMat;
    }

    updateJointGizmo();
}

function installKeys(): void {
    if (_keyHandler) return;
    _keyHandler = (e: KeyboardEvent) => {
        if (!_enabled) return;
        // Ignore keystrokes aimed at a text field (jukebox search, save names).
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
            return;
        }
        if (e.code === 'KeyG') {
            teardownProps();
            spawnProps();
            spawnToys();
            console.warn('[physics-sandbox] Respawned props and toys');
        } else if (e.code === 'KeyB') {
            const p = _playerRef ?? _origin;
            const hit = applyRigidBodyRadialImpulse(p.x, p.y - 0.9, p.z, 8, 28, 0.5);
            console.warn(`[physics-sandbox] Blast hit ${hit} bodies`);
        }
    };
    window.addEventListener('keydown', _keyHandler);
}

function teardownProps(): void {
    // clearRigidBodies() drops every joint with the bodies, on both paths; the
    // explicit call keeps the bridge's bookkeeping honest if that ever changes.
    clearJoints();
    clearRigidBodies();
    _joints.length = 0;

    for (const mesh of _toyMeshes) {
        _scene?.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
    }
    _toyMeshes.length = 0;

    for (const mesh of _meshes) {
        _scene?.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
    }
    _meshes.length = 0;
    _handles.length = 0;

    for (let i = 0; i < _gizmos.length; i++) {
        const gizmo = _gizmos[i];
        if (!gizmo) continue;
        _scene?.remove(gizmo);
        gizmo.geometry.dispose();
        _gizmos[i] = null;
    }
}

/** Full teardown — props, toys, gizmos, and the hotkey listener. */
export function disposePhysicsSandbox(): void {
    teardownProps();

    if (_jointGizmo) {
        _scene?.remove(_jointGizmo);
        _jointGizmo.geometry.dispose();
        (_jointGizmo.material as THREE.Material).dispose();
        _jointGizmo = null;
        _jointGizmoPositions = null;
    }
    if (_keyHandler) {
        window.removeEventListener('keydown', _keyHandler);
        _keyHandler = null;
    }
    _enabled = false;
    _scene = null;
    _playerRef = null;
}
