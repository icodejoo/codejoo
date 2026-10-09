# 备份：元素级动画方案（2026-10-08）

根驱动动画转正之前的完整样式源码，原样保留，不参与构建和发布。

- `styles/`：当时的 `src/styles/` 全部 SCSS。
- 动画实现：`pulse` / `shimmer` 给每个骨头各挂一个动画（`--x-ske-anim` / `--x-ske-anim-ul`）；
  同时含根驱动原型（`@property` + 根上一个动画），根上写 `x-ske-legacy-anim` 可退回元素级。
- 弃用原因：元素级 `pulse` 的颜色被骨头的 `!important` 声明压住，下划线模式下 shimmer 也被换成下划线颜色动画，
  两者都看不出效果却照样耗主线程；根驱动在 4000 元素下快约 5 倍且动画可见。
  数据见 `docs/reports/2026-10-08-performance.md` 第 7 节。
