# odometer — rolling‑digit odometer

`createOdometerRender(options?)` → a **count‑up** render plugin that rolls each digit like a
mechanical odometer. Shares the `cd-*` style system, so import `card.css`.

```ts
import { countup } from "@codejoo/counter/count-up";
import { createOdometerRender } from "@codejoo/counter/odometer";
import "@codejoo/counter/card.css";

countup(0, 1234567, "#odo", { render: createOdometerRender({ strip: "full" }) });
```

## Options (`IOdometerRenderOptions`)

| option | type | default | notes |
| --- | --- | --- | --- |
| `strip` | `"minimal" \| "full"` | `"minimal"` | minimal = 2 cells/digit, swaps text on carry (least DOM); full = 0‑9 strip translated (zero‑repaint during animation, more DOM) |
| `rollWindow` | `number` (0–1) | `0.2` | fraction of each step where the digit actually rolls; smaller = snappier, `1` = continuous |
| `leadingZeros` | `boolean` | `false` | `true` keeps leading zeros at the max width (e.g. `0,000,123`) |
| `prefix` | `string` | `"cd-"` | class prefix |

Structure is pre‑built once from `ctx.from`/`ctx.to`; during animation only `transform`/text change,
and it collapses to one static cell per digit on settle.

## Returns

Render function plus `destroy(el?)` (release element state / drop all state; never mutates host DOM).

DOM shape: `ul.cd-root.cd-odometer-root > li.cd-cell.cd-odometer-cell > span.cd-num.cd-odometer-num`.
