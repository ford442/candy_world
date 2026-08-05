# plan.md

Living task board for Candy World. **Primary source:** [`weekly_plan.md`](./weekly_plan.md) (today's focus, backlog, done log).

Use this file for short cross-cutting sequencing notes that span multiple weeks. Detailed issue tracking lives in GitHub (#1485–#1491 mechanical splits, #1497 hygiene, etc.).

## Current sequencing (2026-08-05)

1. **Foundation** — TS/ESint ratchet gate (#1493), repo hygiene (#1497).
2. **Perf / migration** — app-chunk peel (#1495), GPU foliage default (#1496).
3. **Content** — capstone features (#1492, #1494) after gates are green.

## Mega-module splits (do not split blindly)

Prefer domain barrels over mechanical 700-line cuts. Already landed:

- `src/core/config/` — domain modules + `config.ts` barrel
- `src/core/main/` — boot pipelines + thin `main.ts` orchestrator
- `game-loop.ts` + `game-loop-*.ts` — tick phase pattern to copy

Still ticketed for future PRs: `tree-batcher.ts`, `input.ts`, `material-core.ts`, `style.css`.
