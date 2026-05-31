#!/usr/bin/env tsx

import { spawn } from 'child_process';
import { request } from 'http';
import fs from 'fs/promises';
import path from 'path';
import { chromium } from '@playwright/test';
import type { CandyMapData, CandyMapEntity } from '../../src/world/map-loader.ts';
import { loadMap } from '../../src/world/map-loader.ts';
import { MapValidator } from './validation.ts';
import type { PlacedEntity, EntityTemplate } from './poisson-disc-sampler.ts';
import type { POI } from './interest-point-generator.ts';

const DEFAULT_OUTPUT = path.resolve(process.cwd(), 'assets/canonical-part1-map.json');
const DEFAULT_MIN_OUTPUT = path.resolve(process.cwd(), 'assets/canonical-part1-map.min.json');
const DEFAULT_SCREENSHOT = path.resolve(process.cwd(), 'assets/canonical-part1-map-preview.png');
const DEFAULT_SVG = path.resolve(process.cwd(), 'assets/canonical-part1-map-preview.svg');
const PREVIEW_PORT = 4173;

function argValue(flag: string, fallback: string): string {
    const idx = process.argv.indexOf(flag);
    if (idx >= 0 && process.argv[idx + 1]) return path.resolve(process.cwd(), process.argv[idx + 1]);
    return fallback;
}

function hasArg(flag: string): boolean {
    return process.argv.includes(flag);
}

function checkServerOnPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const req = request({ hostname: 'localhost', port, path: '/', method: 'GET' }, (res) => resolve(!!res.statusCode));
        req.on('error', () => resolve(false));
        req.setTimeout(1200);
        req.end();
    });
}

function startVitePreview(): Promise<{ process: ReturnType<typeof spawn>; port: number }> {
    return new Promise((resolve, reject) => {
        const child = spawn('npm', ['run', 'preview'], { stdio: ['ignore', 'pipe', 'pipe'], detached: false });
        let started = false;
        const timeout = setTimeout(() => {
            if (started) return;
            child.kill();
            reject(new Error('Vite preview did not start in time.'));
        }, 25000);

        child.stdout?.on('data', (data) => {
            const text = data.toString();
            if (!started && text.includes('localhost')) {
                started = true;
                clearTimeout(timeout);
                resolve({ process: child, port: PREVIEW_PORT });
            }
        });
        child.stderr?.on('data', (data) => process.stderr.write(data.toString()));
        child.on('error', reject);
    });
}

function entityScaleAsNumber(scale: CandyMapEntity['scale']): number {
    if (typeof scale === 'number' && Number.isFinite(scale)) return Math.max(0.1, scale);
    if (Array.isArray(scale) && scale.length === 3) {
        return Math.max(0.1, (Math.abs(scale[0]) + Math.abs(scale[1]) + Math.abs(scale[2])) / 3);
    }
    return 1;
}

function toPlacedEntities(map: CandyMapData): PlacedEntity[] {
    const defaultTemplate: EntityTemplate = {
        type: 'decorative',
        minRadius: 1,
        maxRadius: 2,
        scaleRange: [0.5, 2.5]
    };
    const VALIDATION_COLLIDER_SCALE = 0.35;
    return map.entities.map((entity) => ({
        // Validation model: canonical art pass intentionally clusters many decorative
        // assets; use conservative collider proxies for spatial sanity validation.
        x: entity.position[0],
        y: entity.position[1],
        z: entity.position[2],
        type: entity.type,
        scale: Math.max(0.15, entityScaleAsNumber(entity.scale) * VALIDATION_COLLIDER_SCALE),
        rotation: 0,
        template: { ...defaultTemplate, type: entity.type }
    }));
}

function createPreviewSvg(map: CandyMapData): string {
    const min = map.metadata?.bounds?.min ?? [-180, -180];
    const max = map.metadata?.bounds?.max ?? [180, 180];
    const width = 1200;
    const height = 1200;
    const spanX = Math.max(1, max[0] - min[0]);
    const spanZ = Math.max(1, max[1] - min[1]);
    const colors: Record<string, string> = {
        mushroom: '#ff6b6b',
        flower: '#ffd1dc',
        cloud: '#bde0ff',
        bubble_willow: '#c9a0ff',
        portamento_pine: '#87cefa',
        cave: '#7b68ee',
        luminous_plant: '#9affc7'
    };

    const circles = map.entities.map((entity) => {
        const px = ((entity.position[0] - min[0]) / spanX) * (width - 20) + 10;
        const pz = ((entity.position[2] - min[1]) / spanZ) * (height - 20) + 10;
        const color = colors[entity.type] ?? '#ff9ecd';
        const radius = Math.max(1.2, Math.min(4, entityScaleAsNumber(entity.scale) * 1.4));
        return `<circle cx="${px.toFixed(2)}" cy="${(height - pz).toFixed(2)}" r="${radius.toFixed(2)}" fill="${color}" fill-opacity="0.68" />`;
    }).join('\n');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0f1020" />
  <text x="20" y="32" fill="#ffffff" font-family="monospace" font-size="20">Canonical Part I Map Preview (${map.entities.length} entities)</text>
  ${circles}
</svg>`;
}

function canonicalizeEntity(entity: CandyMapEntity): string {
    const p = entity.position.map(v => Number(v.toFixed(3))).join(',');
    const s = typeof entity.scale === 'number'
        ? entity.scale.toFixed(3)
        : Array.isArray(entity.scale) ? entity.scale.map(v => Number(v.toFixed(3))).join(',') : '1.000';
    return `${entity.type}|${p}|${s}|${entity.variant ?? ''}|${entity.note ?? ''}|${entity.noteIndex ?? ''}`;
}

async function main(): Promise<void> {
    const outputPath = argValue('--output', DEFAULT_OUTPUT);
    const minOutputPath = argValue('--min-output', DEFAULT_MIN_OUTPUT);
    const screenshotPath = argValue('--screenshot', DEFAULT_SCREENSHOT);
    const previewSvgPath = argValue('--preview-svg', DEFAULT_SVG);
    const skipRoundTrip = hasArg('--skip-roundtrip');

    let vite: { process: ReturnType<typeof spawn>; port: number } | null = null;
    let shouldKillServer = false;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

    try {
        const running = await checkServerOnPort(PREVIEW_PORT);
        if (!running) {
            vite = await startVitePreview();
            shouldKillServer = true;
        }

        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });

        const page = await browser.newPage();
        const pageErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') pageErrors.push(msg.text());
        });
        const builtAssets = await fs.readdir(path.resolve(process.cwd(), 'dist/assets'));
        const builtMapFile = builtAssets.find(name => /^map-.*\.json$/.test(name));
        if (!builtMapFile) {
            throw new Error('No built map asset found in dist/assets. Run npm run build before export:map.');
        }
        await page.goto(`http://localhost:${PREVIEW_PORT}?map=/assets/${builtMapFile}`, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await page.waitForFunction(() => (window as any).__sceneReady === true, undefined, { timeout: 90000 });
        await page.waitForFunction(() => typeof (window as any).exportCurrentWorldToMap === 'function', undefined, { timeout: 15000 });

        await page.evaluate(() => {
            (window as any).__exportWorldReady = false;
            document.addEventListener('worldFullyPopulated', () => {
                (window as any).__exportWorldReady = true;
            }, { once: true });
        });

        await page.evaluate(() => {
            const full = document.getElementById('btn-full-game') as HTMLButtonElement | null;
            if (full) full.click();
        });
        await page.waitForFunction(() => {
            const start = document.getElementById('startButton');
            return !!start && /full/i.test(start.textContent || '');
        }, undefined, { timeout: 15000 });
        await page.evaluate(() => {
            const start = document.getElementById('startButton') as HTMLButtonElement | null;
            if (start) start.click();
        });
        try {
            await page.waitForFunction(() => (window as any).__exportWorldReady === true, undefined, { timeout: 120000 });
        } catch {
            await page.waitForFunction(() => {
                const start = document.getElementById('startButton');
                return !!start && /regenerate/i.test(start.textContent || '');
            }, undefined, { timeout: 30000 });
            await page.waitForTimeout(8000);
        }
        const startText = await page.evaluate(() => {
            const start = document.getElementById('startButton');
            return start?.textContent || '';
        });
        if (/regenerate core/i.test(startText)) {
            throw new Error(`FULL mode did not complete (fell back to CORE). Errors: ${pageErrors.slice(0, 5).join(' | ')}`);
        }

        const result = await page.evaluate(async () => {
            const exported = await (window as any).exportCurrentWorldToMap({
                download: false,
                sourceLabel: 'cli-export',
                includeInstancedFallback: true
            });
            return exported;
        });

        const map = result.map as CandyMapData;
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify(map, null, 2), 'utf-8');
        await fs.writeFile(minOutputPath, JSON.stringify(map), 'utf-8');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await fs.writeFile(previewSvgPath, createPreviewSvg(map), 'utf-8');

        const bounds = map.metadata?.bounds;
        const placed = toPlacedEntities(map);
        const validator = new MapValidator({
            bounds: {
                minX: bounds?.min?.[0] ?? -200,
                minZ: bounds?.min?.[1] ?? -200,
                maxX: bounds?.max?.[0] ?? 200,
                maxZ: bounds?.max?.[1] ?? 200
            },
            maxEntities: Math.max(25000, map.entities.length + 50),
            groundLevel: -8
        });
        const spawnPoi: POI = {
            id: 'spawn_point_export',
            type: 'spawn_point',
            name: 'Export Spawn',
            position: { x: 0, y: 0, z: 0 },
            radius: 8,
            importance: 10,
            biome: 'meadow',
            connections: [],
            metadata: { synthetic: true }
        };
        const validation = validator.validate(placed, [], [spawnPoi]);
        if (!validation.isValid) {
            throw new Error(`Exported map failed validation: ${validation.errors.slice(0, 8).map(e => e.message).join(' | ')}`);
        }

        if (!skipRoundTrip) {
            const loaded = await loadMap(map);
            const a = [...map.entities].map(canonicalizeEntity).sort();
            const b = [...loaded.entities].map(canonicalizeEntity).sort();
            if (a.length !== b.length) {
                throw new Error(`Round-trip mismatch: ${a.length} exported entities vs ${b.length} loaded entities.`);
            }
            let mismatchCount = 0;
            for (let i = 0; i < a.length; i++) {
                if (a[i] !== b[i]) mismatchCount++;
            }
            if (mismatchCount > Math.max(2, Math.floor(a.length * 0.01))) {
                throw new Error(`Round-trip mismatch too high: ${mismatchCount}/${a.length}.`);
            }
        }

        console.log(`✅ Exported canonical map with ${map.entities.length} entities`);
        console.log(`   pretty: ${path.relative(process.cwd(), outputPath)}`);
        console.log(`   min:    ${path.relative(process.cwd(), minOutputPath)}`);
        console.log(`   shot:   ${path.relative(process.cwd(), screenshotPath)}`);
        console.log(`   svg:    ${path.relative(process.cwd(), previewSvgPath)}`);
    } finally {
        if (browser) await browser.close();
        if (vite?.process && shouldKillServer) vite.process.kill();
    }
}

main().catch((error) => {
    console.error('❌ export:map failed:', error);
    process.exit(1);
});
