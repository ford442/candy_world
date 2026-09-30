# CI contract — which suite gates what

_Written 2026-09-23. Update this file in the same commit as any change to
`.github/workflows/**` or the `test:*` aggregate scripts in `package.json`._

The rule this repository kept violating: **a check that cannot fail is not a
check.** Every entry below states what it would catch, and how someone proved
it can go red.

---

## `npm run test:fast` — the PR gate

Wired into `.github/workflows/node-protocol-tests.yml`, which runs on every
pull request against `main` and on every push to `main`.

Contents: `build:wasm`, then all 32 node-only suites (WASM particle bounds,
rigid-body/joint/soft-body physics, TS↔AS cross-tier parity, GPU chore
scheduling, WebGPU capability probing, spawn tracking, entity snapshot
round-trip and migration, player spawn, character controller and its
native-assist ABI (skips without `build:emcc` output), world health,
fauna behaviour, presence protocol, Sugar Caves and Sky Islands traversal,
startup capabilities, world extent, local/clustered lights, irradiance probes,
post-FX, ground system and unified-ground parity, foliage interaction, shadow
cascades, atmosphere reactivity, cookbook presets) plus four repo-integrity
guards (`test:docs-symbols`, `test:plan-integrity`, `test:foliage-barrel`,
`test:cycles`).

**What it catches:** any regression in the pure-logic layer — physics and WASM
parity, world/entity data contracts, rendering *configuration* — plus docs that
cite config knobs which do not exist, find-and-replace vandalism of
`weekly_plan.md`, and any new runtime import cycle reachable from `src/main.ts`.

**What it does NOT catch:** anything that requires actually rendering a frame.
No browser is launched. A shader that fails to compile, a black screen, a
texture that never binds — none of that is visible here.

Runtime: **~20 s** locally after `pnpm install` (Node 24, cold WASM build
included). It is deliberately cheap enough that nobody is tempted to skip it.

Requires **no browser and no `vite build`**. That is the whole point of the
split: the CI job installs pnpm dependencies and nothing else.

## `npm run test:integration` — local and nightly only

`test:fast` + `vite build` + `npm run test` + `npm run test:smoke:fast`.

The last two both run `tests/smoke-runner.mjs`, which launches Playwright
Chromium with WebGPU. **Do not wire this into a CI job** without also adding
`npx playwright install --with-deps chromium` and the
`--enable-unsafe-webgpu` flag, and without proving the job goes green once
before merging. That omission is exactly what turned `Node protocol tests` red
on 2026-09-22 (commit `90bd6c1`).

## `npm run typecheck` / `npm run lint` / `npm run test:cycles` — ratchets

Separate workflows (`typecheck.yml`, `lint.yml`; `test:cycles` runs in both
`lint.yml` and `test:fast`). Each compares against a committed baseline in
`scripts/` and fails on any increase. None of them writes its baseline as a side
effect: lower counts are locked in with `-- --update`. Current baselines
(2026-09-30, #1827): **0** type errors, **0** runtime import cycles, **4988**
ESLint warnings / 0 errors.

- `typecheck` counts every `error TSnnnn` line, including tsconfig and global
  errors, and fails when tsc exits non-zero without a parseable error. Before
  #1827 it counted only `src/…` lines, so a broken tsconfig read as 0 errors.
- `test:cycles` (`scripts/cycles-ratchet.mjs`) builds the madge graph from
  `src/main.ts` (type-only imports skipped) and gates on the number of modules
  and imports inside strongly connected components. It does not gate on madge's
  own `circular()` count, which depends on traversal order: the same graph gives
  26 or 64 depending on `baseDir`, and adding a real cycle can make it go down.
  The baseline must match exactly, so a PR that removes a cycle must also run
  `npm run test:cycles -- --update`. Proven red by adding
  `import '../foliage/index.ts'` to `src/utils/log.ts`: exit 1, naming that
  import as the one that closes the loop.
- `lint` now runs `recommendedTypeChecked` on `src/**/*.ts` (type-aware rules at
  `warn`), `import/no-cycle` at `error`, and module-boundary
  `no-restricted-imports` (no `src/debug/` from world/systems/foliage, no foliage
  barrel from inside `src/foliage/`). The baseline went from 1888 to 4988 because
  of the type-aware rules alone: the pre-#1827 rule set dropped to 1800.
  Type-aware linting takes about 2 minutes, and `lint.yml` runs ESLint twice
  (gate plus human-readable report).

## `Visual Regression Tests` — DISABLED 2026-09-23

Reduced to `workflow_dispatch` only. Full rationale and the three-point
re-enable checklist are in the header comment of
`.github/workflows/visual-regression.yml`. Short version: baselines are
gitignored, so the push job failed 8+ consecutive times trying to `git add` an
ignored path, and the PR job reported success while performing zero
comparisons.

---

## Dropped on 2026-09-23: `test:integration:deferred`

The script

```
test:integration:deferred = test:docs-symbols && test:plan-integrity
                         && test:save-entity-snapshot && test:character-native
```

advertised four suites. Verified on disk at commit `90bd6c1`:

| leg | status then | status now |
| --- | --- | --- |
| `test:docs-symbols` | npm script undefined, `scripts/check-docs-symbols.mjs` absent | **written and wired into `test:fast`** |
| `test:plan-integrity` | npm script undefined, `scripts/check-plan-integrity.mjs` absent | **written and wired into `test:fast`** |
| `test:save-entity-snapshot` | script defined, but `tests/save-entity-snapshot-roundtrip.test.mjs` does not exist — `npm run test:save-entity-snapshot` exits 1 with `ERR_MODULE_NOT_FOUND` | **npm script deleted** |
| `test:character-native` | npm script undefined; `tests/character-controller-native.test.mjs` does not exist either. It arrived with PR #1771, and the stale #1779 squash deleted it | **restored in #1822 as a Node-only test and wired into `test:fast` (skips without `build:emcc` output). It gates for real in `emscripten-verify.yml`** |

The chain itself is deleted. Two of the four legs now exist and gate PRs. The
other two had no test file to point at, and writing a save-system round-trip
test was out of scope (`src/systems/save-system/**` is owned by a parallel
slice). **If a native character-controller test or a save-entity-snapshot
round-trip is wanted, write the test file first and add it to `test:fast` —
do not re-create a script that names a file which is not there.**

## `test:parity` reads as a pass but skips its C++ tier

`tests/parity.mjs` compares TS → AssemblyScript → Emscripten/C++. The C++ tier
has never run in this environment: `public/candy_native*.js` and
`public/candy_native*.wasm` are not built (no emsdk here). As of 2026-09-23 the
harness prints an explicit, unmissable block naming every missing artifact and
ends with "green for the comparisons that ran. 3 group(s) SKIPPED" rather than
a bare "Parity harness green." It still exits 0 — a missing optional toolchain
should not block a PR — but it no longer reads as full coverage.

C++ and AssemblyScript skips are counted separately (`cppSkips` vs `skips`).
The shared counter also increments for a missing AssemblyScript foliage export,
so gating the C++ diagnostic on it made a single AS export gap report "the C++
tier did NOT run" with an inflated count. AS gaps now get their own block
naming `npm run build:wasm`. **If you add a new skip site to
`tests/parity.mjs`, increment the counter for the tier it belongs to** —
otherwise the summary goes back to blaming the wrong toolchain.

**Fail-closed where the toolchain exists (#1822).** `emscripten-verify.yml`
runs `test:parity` with `CANDY_PARITY_REQUIRE_CPP=1` right after `build:emcc`.
With that flag set, any C++ skip exits 1. A native module that built but
failed to load, or that lost an export, cannot pass as green there. Without
the flag (the `test:fast` PR job) behaviour is unchanged: the run exits 0 and
prints the skip block. The C++ tier covers only exports that `src/` calls:
matrix compose, instance-pose write, and the `getGroundHeight` NaN guard. The
never-called C++ twins of the colour write and the arpeggio accumulate were
removed from `exports.txt`.
