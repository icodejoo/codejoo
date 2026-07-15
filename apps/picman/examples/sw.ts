/**
 * Self-assembly SW example: a consumer's own service worker importing
 * picman directly, as an alternative to the prebuilt dist/picman-sw.js.
 * Not wired up by examples/serve.ts (it serves dist/picman-sw.js instead) —
 * kept here as a reference for the self-assembly integration path.
 *
 * SW 自装模式示例:业务方自己的 service worker 直接引入 picman,
 * 作为预构建成品 dist/picman-sw.js 之外的另一种接入方式。
 * examples/serve.ts 默认走 dist/picman-sw.js,本文件仅作自装模式参考。
 */
import { setupPicman } from "../src/sw";

setupPicman();
