/** skeletonizer 入口（默认）：完整版 = core + 完整版扩展 + global / svg 变体 + full.css（构建时在产物开头加 import "./full.css"），并把 skz 挂到全局 */
export * from "../full/index.js";
export { default } from "../full/index.js";
import "../full/variants/global.js";
import "../full/variants/svg.js";
