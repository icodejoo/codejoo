/**
 * 示例统一配置：默认指向本地跑的 api-ws-demo（`cargo run`，默认端口 8080），
 * 通过环境变量切到其他实例（比如线上部署 wss://api-ws-demo-latest.onrender.com）。
 *
 * https://github.com/icodejoo/api-ws-demo —— 这些示例对接的测试服务器。
 */
export const HTTP_BASE = process.env.API_WS_DEMO_HTTP ?? "http://localhost:8080";
export const WS_BASE = process.env.API_WS_DEMO_WS ?? "ws://localhost:8080";
