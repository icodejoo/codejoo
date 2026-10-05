/**
 * Prebuilt standalone Service Worker: deploy dist/imgprogress-sw.js to the site
 * root and register it directly. Options passed by the page through
 * `registerImgprogressSW` arrive via this script's own URL query and are
 * parsed here before assembling the pipeline.
 *
 * 预构建托管成品 SW:把 dist/imgprogress-sw.js 部署到站点根目录直接注册。页面经
 * `registerImgprogressSW` 传入的选项通过本脚本自身的 URL query 送达,在此解析后再装配管线。
 */
import { parseSWConfig } from "./shared/config-transport";
import { setupImgprogress } from "./sw/index";

setupImgprogress(parseSWConfig(location.search));
