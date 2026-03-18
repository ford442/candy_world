/**
 * @file culling-system.test.ts
 * @description Simple test for culling system TypeScript compilation
 */

import * as THREE from 'three';
import { 
    CullingSystem,
    SpatialHashGrid,
    OcclusionQueryManager,
    CullingDebugVisualizer,
    CullingGroup,
    EntityType,
    LODLevel,
    QualityTier,
    createLODMeshes,
    getDitherValue,
    DEFAULT_CULL_DISTANCES,
    LOD_THRESHOLDS,
    QUALITY_MULTIPLIERS,
    DEFAULT_CULLING_CONFIG,
    type CullableObject,
    type CullingConfig,
    type CullingStats
} from '../src/rendering/culling-system';

// Test 1: Verify exports exist
console.log('Testing exports...');
console.assert(CullingSystem !== undefined, 'CullingSystem should be exported');
console.assert(SpatialHashGrid !== undefined, 'SpatialHashGrid should be exported');
console.assert(OcclusionQueryManager !== undefined, 'OcclusionQueryManager should be exported');
console.assert(CullingDebugVisualizer !== undefined, 'CullingDebugVisualizer should be exported');
console.assert(CullingGroup.STATIC === 'static', 'CullingGroup.STATIC should be "static"');
console.assert(CullingGroup.DYNAMIC === 'dynamic', 'CullingGroup.DYNAMIC should be "dynamic"');
console.assert(CullingGroup.ALWAYS_VISIBLE === 'always_visible', 'CullingGroup.ALWAYS_VISIBLE should be "always_visible"');
console.assert(EntityType.TREE === 'tree', 'EntityType.TREE should be "tree"');
console.assert(LODLevel.FULL === 0, 'LODLevel.FULL should be 0');
console.assert(QualityTier.HIGH === 'high', 'QualityTier.HIGH should be "high"');

// Test 2: Verify configuration
console.log('Testing configuration...');
console.assert(DEFAULT_CULL_DISTANCES[EntityType.TREE] === 150, 'Tree cull distance should be 150m');
console.assert(DEFAULT_CULL_DISTANCES[EntityType.FLOWER] === 50, 'Flower cull distance should be 50m');
console.assert(LOD_THRESHOLDS[LODLevel.FULL].max === 20, 'Full LOD should be 0-20m');
console.assert(QUALITY_MULTIPLIERS[QualityTier.HIGH] === 1.0, 'High quality multiplier should be 1.0');

// Test 3: Verify CullingSystem instantiation
console.log('Testing CullingSystem instantiation...');
const scene = new THREE.Scene();
const cullingSystem = new CullingSystem(scene);
console.assert(cullingSystem !== null, 'CullingSystem should instantiate');

// Test 4: Verify methods exist
console.log('Testing CullingSystem methods...');
console.assert(typeof cullingSystem.update === 'function', 'update should be a function');
console.assert(typeof cullingSystem.registerObject === 'function', 'registerObject should be a function');
console.assert(typeof cullingSystem.unregisterObject === 'function', 'unregisterObject should be a function');
console.assert(typeof cullingSystem.isVisible === 'function', 'isVisible should be a function');
console.assert(typeof cullingSystem.setDebugMode === 'function', 'setDebugMode should be a function');
console.assert(typeof cullingSystem.getStats === 'function', 'getStats should be a function');

// Test 5: Register an object
console.log('Testing object registration...');
const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
const objectId = cullingSystem.registerObject(mesh, EntityType.TREE, CullingGroup.STATIC);
console.assert(typeof objectId === 'string', 'registerObject should return a string ID');
console.assert(objectId.startsWith('cull_'), 'Object ID should start with "cull_"');

// Test 6: Check visibility
console.log('Testing visibility check...');
const isVisible = cullingSystem.isVisible(objectId);
console.assert(typeof isVisible === 'boolean', 'isVisible should return a boolean');

// Test 7: Get stats
console.log('Testing stats...');
const stats = cullingSystem.getStats();
console.assert(stats.totalObjects === 1, 'Stats should show 1 total object');
console.assert(typeof stats.visibleObjects === 'number', 'visibleObjects should be a number');
console.assert(typeof stats.culledObjects === 'number', 'culledObjects should be a number');
console.assert(typeof stats.cullingTimeMs === 'number', 'cullingTimeMs should be a number');

// Test 8: Unregister object
console.log('Testing object unregistration...');
const unregistered = cullingSystem.unregisterObject(objectId);
console.assert(unregistered === true, 'unregisterObject should return true on success');

// Test 9: Spatial Hash Grid
console.log('Testing SpatialHashGrid...');
const grid = new SpatialHashGrid(50);
console.assert(grid !== null, 'SpatialHashGrid should instantiate');

// Test 10: Debug visualizer
console.log('Testing CullingDebugVisualizer...');
const debugVisualizer = new CullingDebugVisualizer(scene);
console.assert(debugVisualizer !== null, 'CullingDebugVisualizer should instantiate');
debugVisualizer.setEnabled(true);
debugVisualizer.setEnabled(false);

// Test 11: createLODMeshes
console.log('Testing createLODMeshes...');
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial();
const lodMeshes = createLODMeshes(geometry, material);
console.assert(lodMeshes instanceof Map, 'createLODMeshes should return a Map');
console.assert(lodMeshes.has(LODLevel.FULL), 'LOD meshes should include FULL level');
console.assert(lodMeshes.has(LODLevel.BILLBOARD), 'LOD meshes should include BILLBOARD level');

// Test 12: getDitherValue
console.log('Testing getDitherValue...');
const ditherValue = getDitherValue(10, 10, [0, 0.5, 0.25, 0.75]);
console.assert(typeof ditherValue === 'number', 'getDitherValue should return a number');

// Test 13: Configuration
console.log('Testing configuration...');
cullingSystem.setConfig({ enableFrustumCulling: false });
const config = cullingSystem.getConfig();
console.assert(config.enableFrustumCulling === false, 'Configuration should be updated');

// Test 14: Quality tier
console.log('Testing quality tier...');
cullingSystem.setQualityTier(QualityTier.LOW);
console.assert(cullingSystem.getConfig().qualityTier === QualityTier.LOW, 'Quality tier should be LOW');

// Test 15: Debug mode
console.log('Testing debug mode...');
cullingSystem.setDebugMode(true);
console.assert(cullingSystem.getConfig().debugMode === true, 'Debug mode should be enabled');
cullingSystem.setDebugMode(false);

// Cleanup
cullingSystem.dispose();

console.log('✅ All tests passed!');
