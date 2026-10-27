/**
 * skz-* 属性清单：编辑器提示的单一数据源。
 * 构建脚本 scripts/gen-editor-data.mjs 从这里生成 web-types.json（WebStorm）与 html-custom-data.json（VS Code）；
 * 框架 TS 声明（SkzHtmlAttributes，见 core/types.ts 与 full/types.ts）的键由 test/editor-data.test.ts 与本清单逐项核对。
 * 只收使用者会手写的属性；库自己写入的运行时属性（skz-engine / skz-paused / skz-fw / skz-fit / skz-fit-hide / aria-busy 等）不在其中。
 * 本文件不被任何运行时代码引用，也不会进入 JS 产物；也能被 node 直接加载（只含类型标注，没有枚举）。
 */

/** 属性文档的基础地址（README 的 GitHub 渲染页） */
export const DOCS_BASE_URL = "https://github.com/icodejoo/codejoo/tree/main/apps/skeletonizer";

/** 一个 skz-* 属性的描述 */
export interface SkzAttributeDef {
  /** 属性名 */
  name: string;
  /** 英文说明，与 README 英文版措辞一致 */
  description: string;
  /** 写在哪：element = 根的后代元素，root = 根 */
  scope: "element" | "root";
  /** 是否裸属性（不写值）；false 时必须有 values */
  boolean: boolean;
  /** 枚举取值（非裸属性才有） */
  values?: string[];
  /** README 对应章节的锚点（不含 #） */
  anchor: string;
}

/** README 里「元素标记」小节的锚点 */
const ANCHOR_ELEMENT = "element-marks";

/** README 里「根属性」小节的锚点 */
const ANCHOR_ROOT = "root-attributes";

/** 全部可手写的 skz-* 属性，顺序即编辑器里的展示顺序 */
export const SKZ_ATTRIBUTES: SkzAttributeDef[] = [
  {
    name: "skz-text",
    description:
      "Marks a text element: the text of its whole subtree becomes bars that follow the real text lines, drawn according to the root's skz-text-mode. Ignored on a skz-bone / skz-leaf / skz-ignore element itself and inside skz-leaf / skz-ignore.",
    scope: "element",
    boolean: true,
    anchor: ANCHOR_ELEMENT,
  },
  {
    name: "skz-bone",
    description:
      "The element becomes one bone and its descendants get visibility: hidden; the real content of img / video / canvas is pushed out of the box. Radius defaults to --skz-radius, an element's own border-radius is kept.",
    scope: "element",
    boolean: true,
    anchor: ANCHOR_ELEMENT,
  },
  {
    name: "skz-leaf",
    description: "Merges the whole subtree into one bone: descendants hidden, underlines in the subtree removed. Drawn like skz-bone except that media content is not handled (use skz-bone on img etc.).",
    scope: "element",
    boolean: true,
    anchor: ANCHOR_ELEMENT,
  },
  {
    name: "skz-host",
    description: "Marks a Web Component host (Shadow DOM): the host gets visibility: hidden and its ::before paints one bone, with the same variables and animation as skz-bone.",
    scope: "element",
    boolean: true,
    anchor: ANCHOR_ELEMENT,
  },
  {
    name: "skz-ignore",
    description: "Kept as-is, clickable and focusable; the enable() interaction lock skips branches that contain it. While the root contains one, the implicit default fade is off (an explicit effect: fade still runs).",
    scope: "element",
    boolean: true,
    anchor: ANCHOR_ELEMENT,
  },
  {
    name: "skz-auto",
    description: "Marks an inference region (the root itself or any element inside it): bones are inferred from a tag allow-list (text tags, media and controls, empty <i> and empty elements whose class contains icon).",
    scope: "element",
    boolean: true,
    anchor: ANCHOR_ELEMENT,
  },
  {
    name: "skz",
    description: "Turns the skeleton on for this root: styles, theme variables and the interaction lock hang off it. Normally written by enable() / the adapters; hand-write it for plain HTML without JS.",
    scope: "root",
    boolean: true,
    anchor: ANCHOR_ROOT,
  },
  {
    name: "skz-effect",
    description: "The animation effect, matching the effect option. fade is the default when omitted.",
    scope: "root",
    boolean: false,
    values: ["fade", "solid", "pulse", "shimmer"],
    anchor: ANCHOR_ROOT,
  },
  {
    name: "skz-text-mode",
    description: "How text bones are drawn, matching the text option. round is the default when omitted. lite only reads a hand-written round / clip; underline and leaf are full only.",
    scope: "root",
    boolean: false,
    values: ["round", "clip", "underline", "leaf"],
    anchor: ANCHOR_ROOT,
  },
  {
    name: "skz-shimmer-mode",
    description: "How the shimmer band sweeps, matching the shimmerMode option. even (default) moves all bones at the same speed; fit sweeps each bone inside its own box. Full only.",
    scope: "root",
    boolean: false,
    values: ["even", "fit"],
    anchor: ANCHOR_ROOT,
  },
  {
    name: "skz-cv",
    description: "Gives the root's direct children content-visibility: auto, so children scrolled out of view skip style, layout and paint (--skz-cv-size is the height estimate, default 200px). Full only.",
    scope: "root",
    boolean: true,
    anchor: ANCHOR_ROOT,
  },
];
