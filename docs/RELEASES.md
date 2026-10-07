# Stable builds

Loading and scene-population regressions are common, so we keep known-good builds you can point people to. Each one is recorded as a git tag, a GitHub Release with the built `dist/` zipped, and a hosted copy on storage.noahcohn.com.

## Where the good builds are

| What                          | Where                                                       |
| ----------------------------- | ----------------------------------------------------------- |
| Latest good build (fixed URL) | `storage.noahcohn.com` → `candy-world/stable/`              |
| Every good build              | `candy-world/releases/<tag>/`, and the GitHub Releases page |
| Source                        | `git checkout stable-YYYY-MM-DD[-label]`                    |

Tags are named `stable-YYYY-MM-DD[-label]`. To list them, run `git tag -l 'stable-*' --sort=-creatordate`.

## When to promote

Promote after a feature stack lands on `main`, once you have walked around the full world in a browser and seen terrain, foliage, batchers and fauna populate. Tests can't judge how the world looks, so that manual walk-around stays a person's job.

```bash
git checkout main && git pull
npm run release:stable -- seasons        # → stable-2026-10-07-seasons
npm run release:stable -- --dry-run      # print what would happen
```

The script does the following:

1. Refuses to run unless the working tree is clean and you are on `main`.
2. Runs `build:wasm`, `test:wasm`, `build`, and the smoke test. The smoke test fails when the world under-populates (for example `__worldHealth.succeeded < 1000` or fewer than 100 batcher instances).
3. Zips `dist/` and writes `BUILD_INFO.json` into it.
4. Creates and pushes an annotated tag.
5. Runs `gh release create` with release notes that list the commits since the last stable tag.
6. Runs `deploy.py --prefix releases/<tag>` and `deploy.py --prefix stable`.

Flags:

- `--skip-smoke` covers machines where Chromium won't launch. The release notes then say the smoke test was **skipped**, so do the browser walk-around first.
- `--no-upload` skips the storage server.

If a `stable-*` tag is pushed without the script, `.github/workflows/release-stable.yml` rebuilds it and attaches the zip. That CI path runs no smoke test.

## Rolling back

- To give someone a working build: send them the `stable/` URL.
- To work from it: `git checkout <tag>`, or `git switch -c fix/x <tag>`.
- To run a release zip locally: unzip it, then `npx vite preview --outDir <dir>`. The build uses `base: './'`, so any static server works. WebGPU is still required.

## Safe mode and bisecting a broken boot

`?preset=minimal` (also the **Safe mode** link on the start screen) boots the core map with the heavy systems off. It expands to:

`?boot=core&safe&no_batchers&no_luminous&no_musical&no_fauna&no_gpu_compute`

If safe mode boots but the full world doesn't, turn systems back on one at a time to find the culprit. The full list of flags is in `src/core/config/url-flags.ts`. The useful ones are:

| Flag                        | Disables                              |
| --------------------------- | ------------------------------------- |
| `no_batchers`               | tree / mushroom / flower GPU batchers |
| `no_luminous`               | luminous plants                       |
| `no_musical`                | musical flora                         |
| `no_procedural`             | procedural filler                     |
| `no_fauna`                  | ambient fauna                         |
| `no_grass` / `no_fireflies` | grass instancing / fireflies          |
| `no_gpu_compute`            | GPU compute (falls back to WASM/JS)   |
| `safe`                      | shader warmup + compute               |
