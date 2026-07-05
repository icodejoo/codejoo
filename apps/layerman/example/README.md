# layerman × Vue 3 + Vant example

A runnable demo + full-API browser test for `@codejoo/layerman` and its `/vue` adapter,
driving real [Vant](https://vant-ui.github.io/vant/) components.

This is a **workspace member** — every dependency is reused from the monorepo (`@codejoo/layerman`
via `workspace:*`, and `vue`/`vant`/`@vitejs/plugin-vue`/`vitest`/`@vitest/browser*`/`playwright`/
`vite-plus` via the root `pnpm-workspace.yaml` catalog). Nothing is installed locally.

- **`src/`** — a Vue 3 + Vant page wired through the `/vue` composables: serial queue, `overlap`
  stacking, `replace`, `duration`, pause/resume, reactive `defaults`, and a Vant `Dialog` bound via
  the writable `model` (`v-model:show`).
- **`test/overlay.browser.test.ts`** — runs in real Chromium via the shared `@vitest/browser-playwright`
  stack. Covers the **whole core API** (importing the published package directly) plus the **Vue
  adapter** (mounting the real Vant app).

> Cooldown `day/hour/minute/total` need a controllable clock → covered by the package's own unit
> suite (`apps/layerman`, fake timers). This browser test covers `session` + `minGap` (real
> short waits).

## Run

```bash
pnpm install                                   # from repo root (installs the whole workspace)
pnpm --filter @codejoo/layerman build   # the example links the package by its dist

pnpm --filter @codejoo/layerman-example dev    # vp dev — click around
pnpm --filter @codejoo/layerman-example test   # vp test — real Chromium, full-API assertions
```
