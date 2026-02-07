/**
 * @file mesh_deformation.cpp
 * @brief Mesh deformation for Candy World - C++/Emscripten
 * 
 * Provides vertex deformation functions for wave, jiggle, and wobble effects.
 * 
 * @perf-migrate {target: "cpp", reason: "vertex-processing", note: "2-3x speedup for deformable meshes"}
 */

#include <emscripten.h>
#include <cmath>
#include <cstdint>
#include <algorithm>
#include "omp.h"

extern "C" {

// =============================================================================
// WAVE DEFORMATION
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void deformMeshWave(
    float* positions,
    const float* originalPositions,
    int count,
    float time,
    float frequency,
    float strength,
    float audioPulse
) {
    const float time2 = time * 2.0f;
    const float effectiveStrength = strength * (1.0f + audioPulse * 0.5f);
    
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        float x = originalPositions[i * 3];
        float z = originalPositions[i * 3 + 2];
        float y = originalPositions[i * 3 + 1];
        
        float wave = sinf(x * frequency + time2) * cosf(z * frequency + time2);
        positions[i * 3 + 1] = y + wave * effectiveStrength;
    }
}

// =============================================================================
// JIGGLE DEFORMATION (Good for mushrooms)
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void deformMeshJiggle(
    float* positions,
    const float* originalPositions,
    int count,
    float time,
    float strength,
    float audioPulse
) {
    const float time5 = time * 5.0f;
    const float effectiveStrength = strength * 0.1f * (1.0f + audioPulse);
    
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        float x = originalPositions[i * 3];
        float y = originalPositions[i * 3 + 1];
        float z = originalPositions[i * 3 + 2];
        
        float phase = time5 + y * 2.0f;
        float offset = sinf(phase) * effectiveStrength;
        
        positions[i * 3 + 0] = x + offset;
        positions[i * 3 + 2] = z + offset * cosf(phase);
    }
}

// =============================================================================
// WOBBLE DEFORMATION (Good for trees)
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void deformMeshWobble(
    float* positions,
    const float* originalPositions,
    int count,
    float time,
    float strength,
    float audioPulse
) {
    const float time2 = time * 2.0f;
    const float baseStrength = strength * 0.05f;
    const float audioScale = 1.0f + audioPulse * 0.3f;
    
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        float x = originalPositions[i * 3];
        float y = originalPositions[i * 3 + 1];
        float z = originalPositions[i * 3 + 2];
        
        float wobble = sinf(time2 + y * 0.5f) * baseStrength;
        float heightFactor = y / 5.0f;
        
        positions[i * 3 + 0] = x + wobble * heightFactor * audioScale;
    }
}

// =============================================================================
// NORMAL RECOMPUTATION
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void recomputeNormals(
    const float* positions,
    float* normals,
    const uint16_t* indices,
    int indexCount
) {
    int vertexCount = indexCount;
    
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < vertexCount * 3; i++) {
        normals[i] = 0.0f;
    }
    
    for (int i = 0; i < indexCount; i += 3) {
        uint16_t i0 = indices[i];
        uint16_t i1 = indices[i + 1];
        uint16_t i2 = indices[i + 2];
        
        float x0 = positions[i0 * 3];
        float y0 = positions[i0 * 3 + 1];
        float z0 = positions[i0 * 3 + 2];
        
        float x1 = positions[i1 * 3];
        float y1 = positions[i1 * 3 + 1];
        float z1 = positions[i1 * 3 + 2];
        
        float x2 = positions[i2 * 3];
        float y2 = positions[i2 * 3 + 1];
        float z2 = positions[i2 * 3 + 2];
        
        float ex1 = x1 - x0;
        float ey1 = y1 - y0;
        float ez1 = z1 - z0;
        
        float ex2 = x2 - x0;
        float ey2 = y2 - y0;
        float ez2 = z2 - z0;
        
        float nx = ey1 * ez2 - ez1 * ey2;
        float ny = ez1 * ex2 - ex1 * ez2;
        float nz = ex1 * ey2 - ey1 * ex2;
        
        normals[i0 * 3] += nx;
        normals[i0 * 3 + 1] += ny;
        normals[i0 * 3 + 2] += nz;
        
        normals[i1 * 3] += nx;
        normals[i1 * 3 + 1] += ny;
        normals[i1 * 3 + 2] += nz;
        
        normals[i2 * 3] += nx;
        normals[i2 * 3 + 1] += ny;
        normals[i2 * 3 + 2] += nz;
    }
    
    #pragma omp parallel for schedule(static) if(vertexCount > 500)
    for (int i = 0; i < vertexCount; i++) {
        float nx = normals[i * 3];
        float ny = normals[i * 3 + 1];
        float nz = normals[i * 3 + 2];
        
        float len = sqrtf(nx * nx + ny * ny + nz * nz);
        if (len > 0.0001f) {
            float invLen = 1.0f / len;
            normals[i * 3] *= invLen;
            normals[i * 3 + 1] *= invLen;
            normals[i * 3 + 2] *= invLen;
        }
    }
}

// =============================================================================
// BATCH DEFORMATION
// =============================================================================

struct MeshDeformData {
    float* positions;
    const float* originals;
    int vertexCount;
    float time;
    float strength;
    float audioPulse;
    int deformType;
    float param1;
};

EMSCRIPTEN_KEEPALIVE
void batchDeformMeshes(MeshDeformData* meshes, int meshCount) {
    #pragma omp parallel for schedule(dynamic, 1)
    for (int m = 0; m < meshCount; m++) {
        MeshDeformData& mesh = meshes[m];
        
        switch (mesh.deformType) {
            case 0:
                deformMeshWave(
                    mesh.positions, mesh.originals, mesh.vertexCount,
                    mesh.time, mesh.param1, mesh.strength, mesh.audioPulse
                );
                break;
            case 1:
                deformMeshJiggle(
                    mesh.positions, mesh.originals, mesh.vertexCount,
                    mesh.time, mesh.strength, mesh.audioPulse
                );
                break;
            case 2:
                deformMeshWobble(
                    mesh.positions, mesh.originals, mesh.vertexCount,
                    mesh.time, mesh.strength, mesh.audioPulse
                );
                break;
        }
    }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

EMSCRIPTEN_KEEPALIVE
int getDeformBatchSize() {
    return 1024;
}

EMSCRIPTEN_KEEPALIVE
int hasSIMDSupport() {
    return 1;
}

}
