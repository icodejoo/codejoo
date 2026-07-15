/**
 * Prebuilt standalone Service Worker: deploy dist/picman-sw.js to the site
 * root and register it directly, with default options.
 *
 * 预构建托管成品 SW:把 dist/picman-sw.js 部署到站点根目录直接注册,使用默认配置。
 */
import { setupPicman } from "./sw/index";

setupPicman();
