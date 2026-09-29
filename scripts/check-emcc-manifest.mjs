#!/usr/bin/env node
/**
 * Tier-1 Emscripten export manifest lint (no emsdk required).
 *
 * Mirrors emscripten/build.sh selection logic:
 *   1. Parse ANIMATION_FUNCTIONS + CORE_EXPORTS from build.sh
 *   2. Grep *.cpp for implementations (same patterns as function_exists)
 *   3. Assert committed emscripten/exports.txt equals the expected set
 *   4. Assert the toolchain contract: one optimizer level across the MT/ST
 *      compile + link flags, matching AGENTS.md, and no internal Emscripten
 *      minify settings passed with -s (emcc rejects them)
 *
 * Exit codes:
 *   0 — manifest matches
 *   1 — drift / missing files / parse failure
 *
 * Usage:
 *   node scripts/check-emcc-manifest.mjs
 *   node scripts/check-emcc-manifest.mjs --write   # regenerate exports.txt
 *   pnpm run verify:emcc:manifest
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BUILD_SH = path.join(REPO_ROOT, 'emscripten', 'build.sh');
const EXPORTS_TXT = path.join(REPO_ROOT, 'emscripten', 'exports.txt');
const EMSCRIPTEN_DIR = path.join(REPO_ROOT, 'emscripten');
const AGENTS_MD = path.join(REPO_ROOT, 'AGENTS.md');

const FLAG_VARS = ['COMPILE_FLAGS', 'LINK_FLAGS', 'COMPILE_FLAGS_ST', 'LINK_FLAGS_ST'];

// Internal settings (src/settings_internal.js): `-s NAME=...` makes emcc exit
// with "is an internal setting and cannot be set from command line".
const INTERNAL_MINIFY_SETTINGS = ['MINIFY_WASM_IMPORTS_AND_EXPORTS', 'MINIFY_WASM_EXPORT_NAMES'];

const RETURN_TYPES =
  '(?:void|float|int|double|char|long|unsigned|bool|uint32_t|int32_t|size_t|uintptr_t)';

function fail(message) {
  console.error(`[check-emcc-manifest] ${message}`);
  process.exit(1);
}

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing required file: ${path.relative(REPO_ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Parse CORE_EXPORTS=("main" "malloc" "free") from build.sh
 */
function parseCoreExports(buildSh) {
  const match = buildSh.match(/CORE_EXPORTS=\(([^)]*)\)/);
  if (!match) {
    fail('Could not parse CORE_EXPORTS from emscripten/build.sh');
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Parse ANIMATION_FUNCTIONS associative array keys from build.sh
 * (["funcName"]="source_tag")
 */
function parseAnimationFunctions(buildSh) {
  const start = buildSh.indexOf('declare -A ANIMATION_FUNCTIONS=(');
  if (start < 0) {
    fail('Could not find ANIMATION_FUNCTIONS in emscripten/build.sh');
  }
  const after = buildSh.slice(start);
  const end = after.indexOf('\n)');
  if (end < 0) {
    fail('Could not find end of ANIMATION_FUNCTIONS array in build.sh');
  }
  const block = after.slice(0, end);
  const names = new Set();
  for (const m of block.matchAll(/\["([^"]+)"\]\s*=/g)) {
    names.add(m[1]);
  }
  if (names.size === 0) {
    fail('ANIMATION_FUNCTIONS parsed empty — check build.sh format');
  }
  return names;
}

/**
 * Mirror build.sh function_exists(): require a C/C++ definition signature
 * in any emscripten/*.cpp file.
 */
function functionExists(funcName, cppSources) {
  const sig = new RegExp(
    `${RETURN_TYPES}\\s*\\*?\\s*${funcName}\\s*\\(`,
    'm'
  );
  for (const src of cppSources) {
    if (sig.test(src)) return true;
  }
  return false;
}

function loadCppSources() {
  const files = fs
    .readdirSync(EMSCRIPTEN_DIR)
    .filter((f) => f.endsWith('.cpp'))
    .map((f) => path.join(EMSCRIPTEN_DIR, f));
  if (files.length === 0) {
    fail('No emscripten/*.cpp sources found');
  }
  return files.map((f) => fs.readFileSync(f, 'utf8'));
}

function parseCommittedExports(text) {
  return new Set(
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))
  );
}

function sortedList(set) {
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Optimizer level + forbidden-flag contract between build.sh and AGENTS.md.
 * Returns a list of problems (empty when the contract holds).
 */
function checkToolchainContract(buildSh) {
  const problems = [];
  const code = buildSh
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');

  const levels = new Map();
  for (const name of FLAG_VARS) {
    const m = code.match(new RegExp(`^${name}="([^"]*)"`, 'm'));
    if (!m) {
      problems.push(`Could not find ${name}="..." in emscripten/build.sh`);
      continue;
    }
    const opt = [...m[1].matchAll(/(?:^|\s)-O([0-3sz])(?=\s|$)/g)].map((x) => x[1]);
    if (opt.length !== 1) {
      problems.push(`${name} must carry exactly one -O level (found ${opt.length})`);
      continue;
    }
    levels.set(name, opt[0]);
  }
  const distinct = new Set(levels.values());
  if (distinct.size > 1) {
    problems.push(
      `Optimizer level differs across flag sets: ${[...levels].map(([k, v]) => `${k}=-O${v}`).join(', ')}`
    );
  }

  const agents = readFile(AGENTS_MD);
  const documented = agents.match(/emscripten\/build\.sh is -O([0-3sz])\b/);
  if (!documented) {
    problems.push('AGENTS.md must state "Optimization level in emscripten/build.sh is -O<n>"');
  } else if (distinct.size === 1 && !distinct.has(documented[1])) {
    problems.push(
      `AGENTS.md documents -O${documented[1]} but build.sh uses -O${[...distinct][0]} — update both together`
    );
  }

  for (const setting of INTERNAL_MINIFY_SETTINGS) {
    if (new RegExp(`-s\\s*${setting}\\b`).test(code)) {
      problems.push(
        `build.sh passes -s ${setting}, an internal Emscripten setting — emcc rejects it on the command line`
      );
    }
  }

  return { problems, level: distinct.size === 1 ? [...distinct][0] : null };
}

function main() {
  const writeMode = process.argv.includes('--write');

  console.log('==========================================');
  console.log('  Emscripten export manifest lint (Tier 1)');
  console.log('==========================================');
  console.log('');

  const buildSh = readFile(BUILD_SH);

  const contract = checkToolchainContract(buildSh);
  if (contract.problems.length > 0) {
    console.error('❌ Emscripten toolchain contract violated:');
    for (const p of contract.problems) console.error(`  - ${p}`);
    console.error('');
    process.exit(1);
  }
  console.log(`toolchain contract:         -O${contract.level} (MT+ST compile/link, AGENTS.md)`);

  const committedText = fs.existsSync(EXPORTS_TXT)
    ? fs.readFileSync(EXPORTS_TXT, 'utf8')
    : '';
  const committed = parseCommittedExports(committedText);
  const cppSources = loadCppSources();

  const expected = new Set();
  for (const core of parseCoreExports(buildSh)) {
    expected.add(`_${core}`);
  }

  const declared = parseAnimationFunctions(buildSh);
  let found = 0;
  let missingImpl = 0;
  for (const func of declared) {
    if (functionExists(func, cppSources)) {
      expected.add(`_${func}`);
      found++;
    } else {
      missingImpl++;
    }
  }

  if (writeMode) {
    const lines = sortedList(expected);
    fs.writeFileSync(EXPORTS_TXT, lines.join('\n') + '\n', 'utf8');
    console.log(
      `Wrote ${lines.length} symbols to ${path.relative(REPO_ROOT, EXPORTS_TXT)}`
    );
    console.log('(mirrors build.sh pre-link export selection; no em++ required)');
    console.log('');
    process.exit(0);
  }

  const onlyCommitted = sortedList(
    new Set([...committed].filter((x) => !expected.has(x)))
  );
  const onlyExpected = sortedList(
    new Set([...expected].filter((x) => !committed.has(x)))
  );

  console.log(`build.sh declared symbols: ${declared.size}`);
  console.log(`implemented (would export): ${found}`);
  console.log(`declared but no .cpp impl:  ${missingImpl} (JS fallback)`);
  console.log(`core exports:               ${parseCoreExports(buildSh).join(', ')}`);
  console.log(`expected exports.txt size:  ${expected.size}`);
  console.log(`committed exports.txt size: ${committed.size}`);
  console.log('');

  if (onlyExpected.length === 0 && onlyCommitted.length === 0) {
    console.log('✅ emscripten/exports.txt matches build.sh selection logic.');
    console.log('');
    process.exit(0);
  }

  console.error('❌ Export manifest drift detected.');
  console.error('');
  if (onlyExpected.length > 0) {
    console.error(
      `Missing from exports.txt (${onlyExpected.length}) — EXPECTED_EXPORTS ⊄ exports.txt:`
    );
    for (const name of onlyExpected) {
      console.error(`  + ${name}`);
    }
    console.error('');
  }
  if (onlyCommitted.length > 0) {
    console.error(
      `Extra in exports.txt (${onlyCommitted.length}) — not selected by build.sh:`
    );
    for (const name of onlyCommitted) {
      console.error(`  - ${name}`);
    }
    console.error('');
  }

  console.error('To regenerate the committed manifest:');
  console.error('  pnpm run verify:emcc:manifest -- --write');
  console.error('  # or with em++: CANDY_DEBUG=0 pnpm run build:emcc');
  console.error('  git add emscripten/exports.txt && git commit');
  console.error('');
  process.exit(1);
}

main();
