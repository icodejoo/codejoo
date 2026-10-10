/**
 * svg 方案的运行时：按根上的主题高光色和时长生成 blob SVG。导入即注册到 engine 方案表。
 */
import { registerEngine } from "../engine.js";
import { applySvg, releaseSvg } from "../svg.js";

registerEngine({ engine: "svg", sync: applySvg, release: releaseSvg });
