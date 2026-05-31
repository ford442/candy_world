#!/usr/bin/env tsx
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

interface BatcherBudgetEntry {
  label: string;
  budgetInstances: number;
  warningUtilization: number;
  bytesPerInstance: number;
  baseBytes: number;
}

interface BatcherBudgetConfig {
  mapSource: string;
  aliases: Record<string, string>;
  batchers: Record<string, BatcherBudgetEntry>;
}

interface BatcherRow {
  id: string;
  label: string;
  mapInstances: number;
  budgetInstances: number;
  utilization: number;
  status: 'pass' | 'warn' | 'error';
  estimatedVramBytes: number;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPTIMIZER_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(OPTIMIZER_DIR, '../..');
const CONFIG_PATH = path.join(OPTIMIZER_DIR, 'batcher-budgets.json');
const OUTPUT_PATH = path.join(OPTIMIZER_DIR, 'stats', 'batcher-budget-report.json');

function normalizeType(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, '_');
}

function loadConfig(): BatcherBudgetConfig {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as BatcherBudgetConfig;
  if (!raw || typeof raw !== 'object' || !raw.batchers) {
    throw new Error('Invalid batcher-budgets.json');
  }
  return raw;
}

function loadMapEntities(mapPath: string): Array<{ type: string; variant?: string }> {
  const resolved = path.resolve(ROOT_DIR, mapPath);
  const json = JSON.parse(fs.readFileSync(resolved, 'utf8')) as { entities?: Array<{ type?: string; variant?: string }> };
  if (!Array.isArray(json.entities)) return [];
  return json.entities
    .filter((entry): entry is { type: string; variant?: string } => typeof entry?.type === 'string')
    .map(entry => ({ type: normalizeType(entry.type), variant: entry.variant }));
}

function resolveBatcherId(type: string, aliases: Record<string, string>): string | null {
  const normalized = normalizeType(type);
  return aliases[normalized] ?? null;
}

function toBytesLabel(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function printRows(rows: BatcherRow[]): void {
  console.log('📦 Batcher Budget Report');
  console.log('='.repeat(86));
  console.log(`${'Batcher'.padEnd(22)} ${'Map'.padStart(6)} ${'Budget'.padStart(8)} ${'Use'.padStart(6)} ${'VRAM'.padStart(12)}  Status`);
  console.log('-'.repeat(86));
  for (const row of rows) {
    const icon = row.status === 'pass' ? '✅' : row.status === 'warn' ? '⚠️ ' : '❌';
    console.log(
      `${row.label.padEnd(22)} ${String(row.mapInstances).padStart(6)} ${String(row.budgetInstances).padStart(8)} ${`${row.utilization.toFixed(1)}%`.padStart(6)} ${toBytesLabel(row.estimatedVramBytes).padStart(12)}  ${icon}`
    );
  }
  console.log('='.repeat(86));
}

function buildRows(config: BatcherBudgetConfig, entities: Array<{ type: string; variant?: string }>): BatcherRow[] {
  const counts = new Map<string, number>();
  for (const entity of entities) {
    const batcherId = resolveBatcherId(entity.type, config.aliases);
    if (!batcherId) continue;
    counts.set(batcherId, (counts.get(batcherId) ?? 0) + 1);
  }
  const rows: BatcherRow[] = [];
  for (const [id, budget] of Object.entries(config.batchers)) {
    const mapInstances = counts.get(id) ?? 0;
    const utilization = budget.budgetInstances > 0 ? (mapInstances / budget.budgetInstances) * 100 : 0;
    const status: BatcherRow['status'] =
      mapInstances > budget.budgetInstances ? 'error' :
      utilization >= budget.warningUtilization ? 'warn' : 'pass';
    const estimatedVramBytes = budget.baseBytes + budget.bytesPerInstance * mapInstances;
    rows.push({
      id,
      label: budget.label,
      mapInstances,
      budgetInstances: budget.budgetInstances,
      utilization,
      status,
      estimatedVramBytes
    });
  }
  return rows.sort((a, b) => b.estimatedVramBytes - a.estimatedVramBytes);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const config = loadConfig();
  const entities = loadMapEntities(config.mapSource);
  const rows = buildRows(config, entities);
  printRows(rows);

  const report = {
    timestamp: new Date().toISOString(),
    mapSource: config.mapSource,
    totalEntities: entities.length,
    rows
  };

  const outDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(`Saved: ${OUTPUT_PATH}`);

  if (check && rows.some(row => row.status === 'error')) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('batcher-budget failed:', error);
  process.exit(1);
});
