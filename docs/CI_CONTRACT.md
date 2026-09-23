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

Contents: `build:wasm`, then all 31 node-only suites (WASM particle bounds,
rigid-body/joint/soft-body physics, TS↔AS cross-tier parity, GPU chore
scheduling, WebGPU capability probing, spawn tracking, entity snapshot
round-trip and migration, player spawn, character controller, world health,
fauna behaviour, presence protocol, Sugar Caves and Sky Islands traversal,
startup capabilities, world extent, local/clustered lights, irradiance probes,
post-FX, ground system and unified-ground parity, foliage interaction, shadow
cascades, atmosphere reactivity, cookbook presets) plus two repo-integrity
guards (`test:docs-symbols`, `test:plan-integrity`).

**What it catches:** any regression in the pure-logic layer — physics and WASM
parity, world/entity data contracts, rendering *configuration* — plus docs that
cite config knobs which do not exist, and find-and-replace vandalism of
`weekly_plan.md`.

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

## `npm run typecheck` / `npm run lint` — ratchets

Separate workflows (`typecheck.yml`, `lint.yml`). Both compare against a
committed baseline and fail on any increase. Current baselines: 0 type errors,
1959 ESLint warnings.

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
| `test:character-native` | npm script undefined; `tests/character-controller-native.test.mjs` does not exist either, contrary to the claim that it arrived with PR #1771 | **dropped; nothing to wire** |

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
