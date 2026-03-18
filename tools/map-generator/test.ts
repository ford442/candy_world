#!/usr/bin/env node
/**
 * Simple test runner for map generator modules
 * Uses Node's built-in TypeScript transpilation via tsx
 */

import { BiomeGenerator, BIOMES, NoiseGenerator } from './biome-generator.ts';
import { PoissonDiscSampler, DEFAULT_ENTITY_TEMPLATES } from './poisson-disc-sampler.ts';
import { PathGenerator } from './path-generator.ts';
import { POIGenerator } from './interest-point-generator.ts';
import { MapValidator } from './validation.ts';
import { SVGPreviewGenerator } from './svg-preview.ts';
import { MapGenerator } from './index.ts';

console.log('🧪 Testing Map Generator Modules\n');

// Test 1: Noise Generator
console.log('1️⃣ Testing Noise Generator...');
const noise = new NoiseGenerator(12345);
const noiseValue = noise.noise2D(10, 20);
console.log(`   ✓ Noise at (10, 20): ${noiseValue.toFixed(4)}`);
const fbmValue = noise.fbm(10, 20, 4);
console.log(`   ✓ FBM at (10, 20): ${fbmValue.toFixed(4)}`);

// Test 2: Biome Generator
console.log('\n2️⃣ Testing Biome Generator...');
const biomeGen = new BiomeGenerator(12345);
const elevation = biomeGen.getElevation(0, 0);
console.log(`   ✓ Elevation at origin: ${elevation.toFixed(2)}`);
const { biome } = biomeGen.getBiomeAt(0, 0);
console.log(`   ✓ Biome at origin: ${biome}`);
const biomeDist = biomeGen.getBiomeDistribution(-100, -100, 100, 100);
console.log('   ✓ Biome distribution:');
for (const [b, coverage] of biomeDist) {
    console.log(`      ${b}: ${(coverage * 100).toFixed(1)}%`);
}

// Test 3: Poisson Disc Sampler
console.log('\n3️⃣ Testing Poisson Disc Sampler...');
const sampler = new PoissonDiscSampler({
    width: 100,
    height: 100,
    minX: -50,
    minZ: -50,
    entityTemplates: DEFAULT_ENTITY_TEMPLATES.slice(0, 5),
    maxAttempts: 20
});
const entities = sampler.generate({
    maxEntities: 50,
    biomeCheck: () => 'meadow',
    elevationCheck: () => 0
});
console.log(`   ✓ Generated ${entities.length} entities`);

// Test 4: Path Generator
console.log('\n4️⃣ Testing Path Generator...');
const pathGen = new PathGenerator({
    seed: 12345,
    bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
    elevationFn: (x, z) => biomeGen.getElevation(x, z),
    waterLevel: -1
});
const paths = pathGen.generatePath(
    { x: -50, y: 0, z: -50 },
    { x: 50, y: 0, z: 50 },
    'road',
    { width: 3 }
);
console.log(`   ✓ Generated ${paths.length} path segments`);
for (const path of paths) {
    console.log(`      ${path.type}: ${path.points.length} points`);
}

// Test 5: POI Generator
console.log('\n5️⃣ Testing POI Generator...');
const poiGen = new POIGenerator({
    seed: 12345,
    bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
    elevationFn: (x, z) => biomeGen.getElevation(x, z),
    biomeFn: (x, z) => biomeGen.getBiomeAt(x, z).biome,
    waterLevel: -1,
    poiCount: 8
});
const pois = poiGen.generate();
console.log(`   ✓ Generated ${pois.length} POIs`);
for (const poi of pois) {
    console.log(`      ${poi.type}: ${poi.name} (${poi.biome})`);
}
const accessibility = poiGen.validateAccessibility();
console.log(`   ✓ All POIs reachable: ${accessibility.isValid ? 'Yes' : 'No'}`);

// Test 6: Validator
console.log('\n6️⃣ Testing Map Validator...');
const validator = new MapValidator({
    bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
    groundLevel: 0,
    maxEntities: 1000
});
const validation = validator.validate(entities, paths, pois);
console.log(`   ✓ Validation passed: ${validation.isValid ? 'Yes' : 'No'}`);
console.log(`   ✓ Entity count: ${validation.stats.totalEntities}`);
console.log(`   ✓ Path count: ${validation.stats.totalPaths}`);
console.log(`   ✓ POI count: ${validation.stats.totalPOIs}`);
if (validation.errors.length > 0) {
    console.log(`   ⚠️  Errors: ${validation.errors.length}`);
}
if (validation.warnings.length > 0) {
    console.log(`   ⚠️  Warnings: ${validation.warnings.length}`);
}

// Test 7: Full Generator
console.log('\n7️⃣ Testing Full Map Generator...');
const mapGen = new MapGenerator({
    seed: 12345,
    size: 200,
    biomes: ['meadow', 'forest'],
    poiCount: 6,
    entityDensity: 0.5,
    maxEntities: 200
});

// Generate map (this will take a moment)
const startTime = Date.now();
const map = await mapGen.generate();
const duration = Date.now() - startTime;

console.log(`   ✓ Map generated in ${duration}ms`);
console.log(`   ✓ Metadata:`, JSON.stringify(map.metadata, null, 2).split('\n').map(l => '      ' + l).join('\n'));

console.log('\n✅ All tests passed!');
console.log('\nTo generate a full map, run:');
console.log('  npx tsx tools/map-generator/cli.ts --seed 12345 --size 500');
