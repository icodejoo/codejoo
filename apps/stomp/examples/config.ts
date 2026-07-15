/**
 * 示例统一配置：默认指向线上部署的 api-ws-demo（Render 免费实例），
 * 通过环境变量切到自己本地跑的实例（`cargo run`，默认端口 8080）。
 *
 * https://github.com/icodejoo/api-ws-demo —— 这些示例对接的测试服务器。
 *
 * 注意：Render 免费实例闲置会休眠，首次请求可能要等几十秒冷启动；另外这个实例可能被
 * 其他人同时拿来测试，topic 数据会互相影响（尤其是 01/03 示例用的公共 topic）。
 */
export const HTTP_BASE = process.env.API_WS_DEMO_HTTP ?? "https://api-ws-demo-latest.onrender.com";
export const WS_BASE = process.env.API_WS_DEMO_WS ?? "wss://api-ws-demo-latest.onrender.com";
