// src/systems/physics/index.ts
// Barrel file for physics system exports

// Main exports from physics.ts
export {
    populatePhysicsGrids,
    updatePhysics,
    grantInvisibility,
    registerPhysicsCave,
    triggerHarpoon,
    player,
    PlayerState,
} from './physics.ts';

// Type exports
export type { AudioState, PlayerExtended, KeyStates } from './physics-types.ts';

// Re-export specific types/constants if needed by external modules
export {
    GRAVITY,
    SWIMMING_GRAVITY,
    SWIMMING_DRAG,
    PLAYER_HEIGHT_OFFSET,
    DANCE_KICK_THRESHOLD,
    bpmWind,
    grooveGravity,
} from './physics-types.ts';

// Dynamic rigid bodies (lightweight interactive-prop solver)
export {
    initRigidBodies,
    isRigidBodyWasmActive,
    spawnRigidBody,
    despawnRigidBody,
    clearRigidBodies,
    updateRigidBodies,
    syncRigidBodyTransforms,
    getRigidBodyPool,
    getRigidBodyCount,
    getAwakeRigidBodyCount,
    applyRigidBodyImpulse,
    applyRigidBodyRadialImpulse,
    setRigidBodyPlayerProxy,
    MAX_DYNAMIC_BODIES,
    RB_SHAPE,
    RB_BOUNDS,
} from './rigid-bodies.ts';

export type { RigidBodyDesc, RigidBodyHandle, RigidBodyShape } from './rigid-body-types.ts';

// Joints (fixed / hinge / spring constraints on top of the rigid-body layer)
export {
    initJoints,
    isJointWasmActive,
    createFixed,
    createHinge,
    createSpring,
    destroyJoint,
    clearJoints,
    setJointSoftness,
    getJointError,
    getJointPool,
    getJointCount,
    getJointHighWater,
    jointAnchorWorld,
    JOINT_TYPE,
    MAX_JOINTS,
    SPRING_RANGE,
} from './joints.ts';

export type { JointEnd, JointHandle, JointType, Vec3Like } from './joint-types.ts';
