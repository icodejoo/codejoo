# card — flip / slide / calendar digit cards

`createCardRender(options?)` → a **count‑down** render plugin that splits the formatted string
into per‑character cards and animates only the digits that change.

```ts
import { countdown } from "@codejoo/counter/count-down";
import { createCardRender } from "@codejoo/counter/card";
import "@codejoo/counter/card.css";

countdown(3600_000, "#clock", { fmt: "HH:mm:ss", render: createCardRender({ effect: "flip" }) });
```

## Options (`ICardRenderOptions`)

| option | type | default | notes |
| --- | --- | --- | --- |
| `effect` | `"flip" \| "slide" \| "calendar"` | `"flip"` | flip = 3D fold; slide = vertical shift; calendar = classic flip‑clock |
| `axis` | `"x" \| "y"` | `"x"` | flip axis (adds `.cd-flip-y` when `"y"`) |
| `direction` | `"up" \| "down"` | `"down"` | slide direction (adds `.cd-slide-up` when `"up"`) |
| `prefix` | `string` | `"cd-"` | class prefix; custom prefix needs matching CSS (copy `card.css`, replace prefix) |

Animation **duration is CSS‑driven** via `--<prefix>duration` (default in `card.css`); set it on any ancestor.

## Returns

`createCardRender()` returns the render function plus `destroy(el?)`:

```ts
const render = createCardRender();
render.destroy(el);  // release that element's state + detach listeners (does not touch its DOM)
render.destroy();    // drop all internal state
```

DOM shape: `ul.cd-root.cd-<effect>-root > li.cd-cell > span.cd-num.cd-next + span.cd-num.cd-now`
(separators like `:` are `li.cd-sep`).
