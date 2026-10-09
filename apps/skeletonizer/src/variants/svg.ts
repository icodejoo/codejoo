/**
 * svg 方案的运行时：按根上的主题高光色和时长生成 blob SVG。导入即注册到核心。
 */
import { registerExtension } from "../enable.js";
import { applySvg, releaseSvg } from "../svg.js";

registerExtension({ engine: "svg", sync: applySvg, release: releaseSvg });
