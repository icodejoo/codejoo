import { describe, expect, it, vi } from "vitest";
import { isFetchBlockedPort, NetemClient, NetemError, openProxy, OPEN_PROXY_MAX_TRIES } from "../lib/netem-client.ts";
import type { ProxyInfo } from "../lib/netem-client.ts";

/** 控制地址：只用来拼 baseURL 的主机，不会真的发请求 */
const CONTROL = "http://127.0.0.1:47190";
/** 测试服务器地址 */
const SERVER = "http://127.0.0.1:47180";

/**
 * 构造按顺序返回端口的 netem 替身，记录被删除的代理 id。
 * @param ports 依次分到的端口
 */
function stubNetem(ports: number[]) {
  const created: ProxyInfo[] = ports.map((port, i) => ({ id: `p${i}`, port }));
  const deleted: string[] = [];
  const netem = new NetemClient(CONTROL);
  let next = 0;
  vi.spyOn(netem, "createProxy").mockImplementation(() => Promise.resolve(created[Math.min(next++, created.length - 1)]));
  vi.spyOn(netem, "deleteProxy").mockImplementation((id: string) => {
    deleted.push(id);
    return Promise.resolve();
  });
  return { netem, deleted };
}

describe("isFetchBlockedPort", () => {
  it("命中 Fetch 规范的受限端口（验收里实测撞到过的几个）", () => {
    for (const port of [2049, 3659, 4045, 4190, 6665, 6666, 6667, 6668, 6669, 10080]) expect(isFetchBlockedPort(port)).toBe(true);
  });
  it("普通端口不受限", () => {
    for (const port of [10081, 47180, 47190, 49152, 65535]) expect(isFetchBlockedPort(port)).toBe(false);
  });
});

describe("openProxy", () => {
  it("分到可用端口时直接返回，不删除任何代理", async () => {
    const { netem, deleted } = stubNetem([50000]);
    const out = await openProxy(netem, SERVER, "normal");
    expect(out).toEqual({ id: "p0", baseURL: "http://127.0.0.1:50000" });
    expect(deleted).toEqual([]);
  });

  it("分到受限端口就删掉重建，直到拿到可用端口", async () => {
    const { netem, deleted } = stubNetem([6666, 4045, 50001]);
    const out = await openProxy(netem, SERVER, "normal");
    expect(out).toEqual({ id: "p2", baseURL: "http://127.0.0.1:50001" });
    expect(deleted).toEqual(["p0", "p1"]);
  });

  it("连续分到受限端口超过上限时抛 NetemError，并把已建的代理清掉", async () => {
    const { netem, deleted } = stubNetem([6666]);
    await expect(openProxy(netem, SERVER, "normal")).rejects.toBeInstanceOf(NetemError);
    expect(deleted).toHaveLength(OPEN_PROXY_MAX_TRIES - 1);
  });
});
