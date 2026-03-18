#!/usr/bin/env node
/**
 * Map Generator CLI
 * Usage: npm run generate:map -- --seed 12345 --size 500 --biomes meadow,forest,lake
 */

import { MapGenerator, MapGenerationOptions } from './index.ts';

interface CLIArgs {
    seed: number;
    size: number;
    biomes: string[];
    output: string;
    poiCount: number;
    entityDensity: number;
    maxEntities: number;
    preview: boolean;
    help: boolean;
}

function parseArgs(): CLIArgs {
    const args: Partial<CLIArgs> = {
        seed: Math.floor(Math.random() * 100000),
        size: 500,
        biomes: ['meadow', 'forest'],
        output: './assets/map_generated.json',
        poiCount: 12,
        entityDensity: 0.8,
        maxEntities: 5000,
        preview: true,
        help: false
    };

    for (let i = 2; i < process.argv.length; i++) {
        const arg = process.argv[i];
        const nextArg = process.argv[i + 1];

        switch (arg) {
            case '--seed':
            case '-s':
                if (nextArg) {
                    args.seed = parseInt(nextArg, 10);
                    i++;
                }
                break;
            case '--size':
            case '-S':
                if (nextArg) {
                    args.size = parseInt(nextArg, 10);
                    i++;
                }
                break;
            case '--biomes':
            case '-b':
                if (nextArg) {
                    args.biomes = nextArg.split(',').map(b => b.trim());
                    i++;
                }
                break;
            case '--output':
            case '-o':
                if (nextArg) {
                    args.output = nextArg;
                    i++;
                }
                break;
            case '--poi-count':
            case '-p':
                if (nextArg) {
                    args.poiCount = parseInt(nextArg, 10);
                    i++;
                }
                break;
            case '--density':
            case '-d':
                if (nextArg) {
                    args.entityDensity = parseFloat(nextArg);
                    i++;
                }
                break;
            case '--max-entities':
            case '-m':
                if (nextArg) {
                    args.maxEntities = parseInt(nextArg, 10);
                    i++;
                }
                break;
            case '--no-preview':
                args.preview = false;
                break;
            case '--help':
            case '-h':
                args.help = true;
                break;
        }
    }

    return args as CLIArgs;
}

function printHelp(): void {
    console.log(`
🗺️  Candy World Map Generator

Usage: npm run generate:map [options]

Options:
  --seed, -s <number>        Random seed for reproducible generation (default: random)
  --size, -S <number>        Map size in units (default: 500)
  --biomes, -b <list>        Comma-separated biome list (default: meadow,forest)
                             Available: meadow, forest, lake, mountain, cave, neonCorruption
  --output, -o <path>        Output file path (default: ./assets/map_generated.json)
  --poi-count, -p <number>   Number of Points of Interest (default: 12)
  --density, -d <number>     Entity density multiplier 0-1 (default: 0.8)
  --max-entities, -m <n>     Maximum entity count (default: 5000)
  --no-preview               Don't generate SVG preview
  --help, -h                 Show this help message

Examples:
  npm run generate:map -- --seed 12345 --size 500
  npm run generate:map -- --biomes meadow,forest,lake --size 1000
  npm run generate:map -- --seed 42 --biomes mountain,cave --poi-count 20
`);
}

function validateBiomes(biomes: string[]): string[] {
    const validBiomes = ['meadow', 'forest', 'lake', 'mountain', 'cave', 'neonCorruption'];
    const invalid = biomes.filter(b => !validBiomes.includes(b));
    
    if (invalid.length > 0) {
        console.error(`❌ Invalid biome(s): ${invalid.join(', ')}`);
        console.error(`   Valid biomes: ${validBiomes.join(', ')}`);
        process.exit(1);
    }

    return biomes;
}

async function main(): Promise<void> {
    const args = parseArgs();

    if (args.help) {
        printHelp();
        process.exit(0);
    }

    console.log(`
🍭 Candy World Map Generator 🍭
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

    // Validate inputs
    const biomes = validateBiomes(args.biomes);

    console.log('Configuration:');
    console.log(`  Seed: ${args.seed}`);
    console.log(`  Size: ${args.size}x${args.size}`);
    console.log(`  Biomes: ${biomes.join(', ')}`);
    console.log(`  POI Count: ${args.poiCount}`);
    console.log(`  Entity Density: ${args.entityDensity}`);
    console.log(`  Max Entities: ${args.maxEntities}`);
    console.log(`  Output: ${args.output}`);
    console.log();

    // Create generator
    const options: MapGenerationOptions = {
        seed: args.seed,
        size: args.size,
        biomes,
        poiCount: args.poiCount,
        entityDensity: args.entityDensity,
        maxEntities: args.maxEntities,
        generatePaths: true
    };

    const generator = new MapGenerator(options);

    try {
        await generator.saveToFile(args.output);
        console.log('\n✅ Map generation successful!');
        
        // Print next steps
        console.log(`
Next steps:
  1. View preview: open tools/map-generator/preview.svg
  2. Replace map: cp ${args.output} assets/map.json
  3. Test in game: npm run dev
`);
    } catch (error) {
        console.error('\n❌ Map generation failed:', error);
        process.exit(1);
    }
}

// Run main
main().catch(console.error);
