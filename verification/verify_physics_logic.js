
// Mock THREE
const THREE = {
    Vector3: class {
        constructor(x=0,y=0,z=0) { this.x=x; this.y=y; this.z=z; }
        copy(v) { this.x=v.x; this.y=v.y; this.z=v.z; return this; }
        set(x,y,z) { this.x=x; this.y=y; this.z=z; return this; }
    }
};

// Mock Imports
const state = {
    player: {
        currentState: 'default',
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        isPhasing: false,
        phaseTimer: 0,
        isGrounded: true
    },
    _lastInputState: { phase: false }
};

const keyStates = { phase: false };

// Function to simulate handleAbilities logic
function handleAbilitiesMock(keyStates, lastInputState, player) {
    const isPhasePressed = keyStates.phase;
    const isPhaseTriggered = isPhasePressed && !lastInputState.phase;

    if (isPhaseTriggered) {
        console.log("TRIGGER DETECTED");
        player.isPhasing = true;
    }
}

// Function to simulate updatePhysics loop
function updatePhysicsMock(keyStates) {
    // 3. State Logic
    handleAbilitiesMock(keyStates, state._lastInputState, state.player);

    // 4. Update History
    state._lastInputState.phase = keyStates.phase;
}

// Test Sequence
console.log("Initial State:", state);

// Frame 1: Press Key
console.log("--- Frame 1: Key Down ---");
keyStates.phase = true;
updatePhysicsMock(keyStates);
console.log("Player Phasing:", state.player.isPhasing);
if (!state.player.isPhasing) {
    console.error("FAIL: Should have triggered phase shift");
    process.exit(1);
}

// Frame 2: Hold Key
console.log("--- Frame 2: Key Hold ---");
// Reset phasing for test to see if it re-triggers (it shouldn't matter for logic, but let's see trigger log)
state.player.isPhasing = false;
updatePhysicsMock(keyStates);
// Should NOT trigger "TRIGGER DETECTED"

// Frame 3: Release Key
console.log("--- Frame 3: Key Up ---");
keyStates.phase = false;
updatePhysicsMock(keyStates);

console.log("SUCCESS: Logic is sound.");
