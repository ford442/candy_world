#include <emscripten.h>
#include <cmath>
#include <vector>

extern "C" {

// =============================================================================
// PLAYER & PHYSICS SYSTEM
// =============================================================================

struct Player {
    float x, y, z;
    float vx, vy, vz;
    float radius;
    float gravity;
    float energy;
    float maxEnergy;
};

struct Obstacle {
    int type;
    float x, y, z;
    float radius;
    float height;
    float param1;
    float param2;
    float param3;
};

Player player = {0, 0, 0, 0, 0, 0, 0.5f, 20.0f, 0, 10.0f};
std::vector<Obstacle> obstacles;

EMSCRIPTEN_KEEPALIVE
void initPhysics(float x, float y, float z) {
    player.x = x;
    player.y = y;
    player.z = z;
    obstacles.clear();
}

EMSCRIPTEN_KEEPALIVE
void addCollisionObject(int type, float x, float y, float z, float r, float h, float p1, float p2, float p3) {
    obstacles.push_back({type, x, y, z, r, h, p1, p2, p3});
}

EMSCRIPTEN_KEEPALIVE
void setPlayerState(float x, float y, float z, float vx, float vy, float vz) {
    player.x = x;
    player.y = y;
    player.z = z;
    player.vx = vx;
    player.vy = vy;
    player.vz = vz;
}

EMSCRIPTEN_KEEPALIVE
float getPlayerX() { return player.x; }
EMSCRIPTEN_KEEPALIVE
float getPlayerY() { return player.y; }
EMSCRIPTEN_KEEPALIVE
float getPlayerZ() { return player.z; }
EMSCRIPTEN_KEEPALIVE
float getPlayerVX() { return player.vx; }
EMSCRIPTEN_KEEPALIVE
float getPlayerVY() { return player.vy; }
EMSCRIPTEN_KEEPALIVE
float getPlayerVZ() { return player.vz; }

// -----------------------------------------------------------------------------
// Native-assist-only ABI.
//
// `resolveCharacterMovement` (src/systems/physics/character-controller.ts) is
// the single owner of gravity, ground/air acceleration smoothing, ground
// Y-snap, coyote time, jump buffering, and jump on every default-state frame.
// TS seeds this module's player position/velocity from its own authoritative
// state via setPlayerState() immediately before calling updatePhysicsCPP, so
// this function must never author a competing player pose. It only tests the
// seeded velocity against obstacle/trampoline colliders and reports back:
//   - a constrained XZ position (obstacle push-out / stem collision), read
//     by TS as an effective velocity via (post.x/z - pre.x/z) / delta, and
//   - a bounce vy (onGround == 2 only), read back verbatim by TS.
// It does not integrate gravity, smooth horizontal velocity, snap Y to the
// ground plane, or fire a jump — those are exclusively resolveCharacterMovement's
// job. `jump`, `sprint`, `sneak`, and `grooveGravity` are accepted for ABI
// compatibility but are no longer consulted here.
// -----------------------------------------------------------------------------
EMSCRIPTEN_KEEPALIVE
int updatePhysicsCPP(float delta, float inputX, float inputZ, float speed, int jump, int sprint, int sneak, float grooveGravity) {
    (void)speed;
    (void)jump;
    (void)sprint;
    (void)sneak;
    (void)grooveGravity;

    // inputX/inputZ arrive already camera-relative and speed-scaled (TS's
    // _targetVelocity) — used as-is, not re-integrated or smoothed.
    float nextX = player.x + inputX * delta;
    float nextY = player.y + player.vy * delta;
    float nextZ = player.z + inputZ * delta;

    int onGround = 0;

    for (const auto& obj : obstacles) {
        float dx = nextX - obj.x;
        float dz = nextZ - obj.z;
        // Squared horizontal distance: every test below compares against a
        // radius, so the sqrt is unnecessary in this per-obstacle loop (#1160).
        float distSq = dx*dx + dz*dz;

        if (obj.type == 0) {
            float stemR = obj.param1;
            float capR = obj.param2;
            float capH = obj.height;
            float surfaceY = obj.y + capH;

            if (nextY < surfaceY - 0.5f) {
                 float minDist = stemR + player.radius;
                 if (distSq < minDist * minDist) {
                     float angle = std::atan2(dz, dx);
                     float pushX = std::cos(angle) * minDist;
                     float pushZ = std::sin(angle) * minDist;
                     nextX = obj.x + pushX;
                     nextZ = obj.z + pushZ;
                 }
            }
            else if (player.vy < 0 && distSq < capR * capR) {
                 if (nextY >= surfaceY - 0.5f && nextY <= surfaceY + 2.0f) {
                     if (obj.param3 > 0.5f) {
                         // Trampoline mushroom: report the bounce impulse for
                         // TS to apply. Does not touch nextY/nextX/nextZ.
                         player.vy = 15.0f;
                         onGround = 2;
                     } else {
                         // Regular mushroom cap: report ground contact only.
                         // TS's own footprint ground query owns the landing
                         // pose (Y-snap, vy zeroing) via resolveCharacterMovement.
                         onGround = 1;
                     }
                 }
            }
        }
        else if (obj.type == 1) {
            if (obj.param2 < 1.5f) {
                float topY = obj.y + obj.height;
                float radius = obj.radius;
                if (distSq < radius * radius) {
                    if (player.vy < 0 && nextY >= topY - 0.5f && nextY < topY + 3.0f) {
                        // Cloud/platform top: report ground contact only, same
                        // as the mushroom-cap case above.
                        onGround = 1;
                    }
                }
            }
        }
        else if (obj.type == 2) {
            float bounceTop = obj.y + obj.height;
            if (distSq < obj.radius * obj.radius && nextY > bounceTop - 0.5f && nextY < bounceTop + 1.5f) {
                if (player.vy < 0) {
                     player.vy = obj.param1;
                     onGround = 2;
                }
            }
        }
    }

    // No general-terrain Y-snap here: TS's resolveCharacterMovement samples
    // its own footprint ground query (sampleGroundFootprint/getGroundHeight
    // from ground-system.ts) for that, using this frame's obstacle-constrained
    // XZ. Authoring a competing groundY + 1.8f snap here (and the immediate
    // jump gate that used to key off it) is exactly the dual-ownership bug
    // this ABI freeze removes — see docs/CHARACTER_CONTROLLER.md.
    player.x = nextX;
    player.y = nextY;
    player.z = nextZ;

    return onGround;
}

} // end extern "C"

int main() {
    return 0;
}
