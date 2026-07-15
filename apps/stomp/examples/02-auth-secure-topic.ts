/**
 * beforeConnect token 刷新 + api-ws-demo 的 /topic/secure/* 鉴权网关，对照一个匿名连接
 * 演示"没带 token"和"带了有效 token"的行为差异：
 *
 * - 匿名连接 SUBSCRIBE /topic/secure/room1 → 收到 ERROR，但连接本身不会断开。
 * - 用 /auth/register + /auth/login 拿到 access_token，通过 beforeConnect 注入到
 *   CONNECT 的 Authorization 头 → 可以正常订阅/收发。
 *
 * beforeConnect 每次（重）连前都会调用，同样的写法在生产环境里可以换成"access_token
 * 快过期就调 /auth/refresh 换新的"。
 *
 * 运行：node examples/02-auth-secure-topic.ts
 */
import { Stompsocket } from "@codejoo/stomp";

import { HTTP_BASE, WS_BASE } from "./config.ts";

interface LoginResponse {
  data: { access_token: string; refresh_token: string };
}

const username = `example-user-${Date.now()}`;
const password = "hunter2";

async function registerAndLogin(): Promise<string> {
  await fetch(`${HTTP_BASE}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const res = await fetch(`${HTTP_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const { data } = (await res.json()) as LoginResponse;
  return data.access_token;
}

async function main(): Promise<void> {
  console.log("--- 匿名连接尝试订阅 /topic/secure/room1（预期 ERROR，但连接存活） ---");
  const anon = new Stompsocket({
    brokerURL: `${WS_BASE}/stomp`,
    debug: true,
    onStompError: (frame) => console.log("匿名连接收到 ERROR（符合预期）:", frame.headers.message),
  });
  anon.subscribe("/topic/secure/room1", (json) => console.log("[不应该走到这里]", json));
  anon.activate();
  await new Promise((r) => setTimeout(r, 1000));
  await anon.dispose();

  console.log("\n--- 注册 + 登录，用真实 token 连接 ---");
  const accessToken = await registerAndLogin();

  const authed = new Stompsocket({
    brokerURL: `${WS_BASE}/stomp`,
    debug: true,
    beforeConnect: async () => ({ Authorization: `Bearer ${accessToken}` }),
  });
  authed.subscribe("/topic/secure/room1", (json) => console.log("[鉴权成功] 收到:", json));
  authed.activate();

  await new Promise((r) => setTimeout(r, 1000));
  authed.send("/topic/secure/room1", { body: "authenticated hello" });

  await new Promise((r) => setTimeout(r, 2000));
  await authed.dispose();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
