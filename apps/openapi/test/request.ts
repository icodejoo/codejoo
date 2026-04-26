import type { Request } from "../src/http-types.ts";

/**
 * 通用 HTTP 请求。所有类型推断由 `Request<model.PathRefs>` 完成：
 *
 * - Method/path 在 spec 内时 IDE 给出提示且 body / 返回类型按 spec 校验
 * - Method/path 在 spec 外时 body 可选 any，返回 any（兼容 mock / 第三方 / 未上线接口）
 * - 显式 `request<R, Q>(...)` 优先级最高，覆盖 spec 推断
 */
async function impl(method: string, path: string, body?: unknown): Promise<unknown> {
  const init: RequestInit = { method: method.toUpperCase() };
  let url = path;

  if (body !== undefined) {
    if (method.toLowerCase() === "get") {
      const params = new URLSearchParams(body as Record<string, string>).toString();
      if (params) url += (url.includes("?") ? "&" : "?") + params;
    } else {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
  }

  const res = await fetch(url, init);
  return res.json();
}

export const request = impl as Request<model.PathRefs>;

// ---------- 用例（IDE 中可悬浮观察推断结果） ----------
// a: 'get' 已知，但 '/pet' 在 spec 里只挂 post/put → spec 未命中 → Promise<any>
const a = await request("get", "/pet");
// b: path 完全未知 → Promise<any>
const b = await request("get", "/unknown");
// c: 显式 R=Pet，path 未知 → Promise<Pet>
const c = await request<model.Pet>("get", "/x");
// d: 显式 R=Pet, Q=string，path 未知 → body 必填 string
const d = await request<model.Pet, string>("post", "/x", "");
// e: 同上，body 类型 number
const e = await request<model.Pet, number>("post", "/x", 1);
// f: 命中 spec 且 spec 标注 body 必填（FindPetsByStatus）—— 缺 body 应报错
// @ts-expect-error - spec 要求 body 必填
const f = await request("get", "/pet/findByStatus");
// g: 显式 R/Q + spec 中不存在 post '/pet/findByStatus' → 走兜底，编译通过
// const g = await request<model.Pet, number>('post', '/pet/findByStatus')
const h = await request("get", "/pet/{petId}", { petId: 1 });
const i = await request("get", "/test");

export { a, b, c, d, e, f, h, i };
