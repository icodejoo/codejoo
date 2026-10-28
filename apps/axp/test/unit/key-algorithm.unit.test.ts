import { expect, it } from "vitest";
import { requestKey, type IKeyOptions } from "../../src/key";
import type { AxpRequestConfig } from "../../src/types";

/** 使用 body 方法验证旧算法的 data 语义。 */
const BASE = { method: "post", url: "/algorithm" };
/** 只变更 data 的指纹。 */
function data(value: unknown, ignores?: unknown[], sample = false) {
  return requestKey({ ...BASE, data: value }, { ignores, sample });
}

it("[core.opt.key.ignores] 名称和值豁免、混合豁免以及未命中无副作用", /** 名称和值豁免、混合豁免以及未命中无副作用。 */ () => {
  expect(data({ a: null }, ["a"])).not.toBe(data({}));
  expect(data({ a: [] }, ["a"])).not.toBe(data({}));
  expect(data({ a: 1 }, ["a"])).toBe(data({ a: 1 }));
  expect(data({ a: 1 }, ["missing"])).toBe(data({ a: 1 }));
  expect(data({ a: null, b: [] }, ["a", "b"])).not.toBe(data({ a: null }, ["a", "b"]));
  expect(data({ a: null }, [null])).not.toBe(data({ b: null }, [null]));
  expect(data([null], [null])).not.toBe(data([]));
  expect(data({ a: null }, ["other"])).toBe(data({}));
  expect(data({ a: null, b: undefined, c: "" }, ["a", undefined])).not.toBe(data({ a: null }, ["a", undefined]));
  for (const value of [false, "", undefined, null, NaN]) expect(data(value, [value])).not.toBe(data(undefined));
  expect(data({ blob: new Blob() }, ["blob"])).toBe(data({ blob: null }, ["blob"]));
  const opaque = new Map();
  expect(data(opaque, [opaque])).not.toBeNull();
});
it("[core.method.key] 嵌套空值回滚、字段身份、顺序与分帧防碰撞", /** 嵌套空值回滚、字段身份、顺序与分帧防碰撞。 */ () => {
  expect(data([1, null, [], {}])).toBe(data([1]));
  expect(data({ x: 1, y: { a: [] } })).toBe(data({ x: 1 }));
  expect(data(false)).not.toBe(data(0));
  expect(data([1])).not.toBe(data([1, 2]));
  expect(data({ nested: { x: 1 } })).not.toBe(data({ nested: { x: 2 } }));
  expect(data([{ x: 1 }])).not.toBe(data([{ x: 2 }]));
  expect(data(["ab", "c"])).not.toBe(data(["a", "bc"]));
  expect(data({ ab: 1 })).not.toBe(data({ a: "b1" }));
  expect(data({ a: 1, b: 2, c: 3 })).toBe(data({ c: 3, b: 2, a: 1 }));
  expect(requestKey({ ...BASE, params: { x: 1 } })).not.toBe(data({ x: 1 }));
  expect(requestKey({ ...BASE, params: 1, data: 2 })).not.toBe(requestKey({ ...BASE, params: 2, data: 1 }));
  const inherited = Object.create({ inherited: 2 }) as {
    /** own 字段。 */ own: number;
  };
  inherited.own = 1;
  expect(data(inherited)).toBe(data({ own: 1 }));
  expect(data(Object.assign(Object.create(null), { own: 1 }))).toBe(data({ own: 1 }));
});
it("[core.opt.key.sample] 采样首中尾、总长度与短串全量", /** 采样首中尾、总长度与短串全量。 */ () => {
  const original = "a".repeat(128);
  for (const index of [0, 64, 127]) {
    const changed = original.slice(0, index) + "b" + original.slice(index + 1);
    expect(data(original, [], true)).not.toBe(data(changed, [], true));
  }
  expect(data(original, [], true)).toBe(data(original, [], true));
  expect(data(original, [], true)).not.toBe(data(original + "a", [], true));
  expect(data("short", [], true)).toBe(data("short"));
  expect(data("short", [], true)).not.toBe(data("shore", [], true));
});
it("[core.method.key] Date、URLSearchParams、二进制沿用旧算法的长度语义", /** Date、URLSearchParams、二进制沿用旧算法的长度语义。 */ () => {
  expect(data(new Date(0))).toBe(data(new Date(0)));
  expect(data(new Date(0))).not.toBe(data(new Date(1)));
  expect(data({ date: new Date(0) })).not.toBe(data({ date: new Date(1) }));
  expect(data(new URLSearchParams("a=1"))).not.toBe(data(new URLSearchParams("a=2")));
  expect(data(Buffer.from("a"))).toBe(data(Buffer.from("b")));
  expect(data(Buffer.from("a"))).not.toBe(data(Buffer.from("aa")));
});

/** 精简内部参数前的算法在固定输入上的输出，精简后必须逐位不变。 */
const SNAPSHOTS: [name: string, request: AxpRequestConfig, options: IKeyOptions, key: string | null][] = [
  ["get params", { method: "get", url: "/pets", params: { page: 1, size: 20 } }, {}, "1elv7z9-f8k3rl"],
  ["get 忽略 data", { method: "get", url: "/pets", params: { a: 1 }, data: { ignored: true } }, {}, "ycb2s0-1kpwuv4"],
  [
    "post 嵌套与数组",
    {
      method: "post",
      url: "/pets",
      data: { name: "Rex", tags: ["x", "y"], owner: { id: 7, vip: true } },
    },
    {},
    "1vfvxvy-p8xmk6",
  ],
  ["post 空值回滚", { method: "post", url: "/pets", data: { a: null, b: "", c: [], d: { e: [] }, f: 1 } }, {}, "4cfgsv-1qj4bo7"],
  ["post ignores 名称", { method: "post", url: "/pets", data: { a: null, b: 1 } }, { ignores: ["a"] }, "196b2am-1uztqaa"],
  ["post ignores 值", { method: "post", url: "/pets", data: { a: null, b: 1 } }, { ignores: [null] }, "1941pe5-1uw1i6p"],
  ["post 长串全量", { method: "post", url: "/long", data: "x".repeat(200) }, {}, "leqbkg-33d170"],
  ["post 长串采样", { method: "post", url: "/long", data: "x".repeat(200) }, { sample: true }, "1y282de-1l9ztra"],
  ["post 长串采样中段不同", { method: "post", url: "/long", data: "x".repeat(96) + "y" + "x".repeat(103) }, { sample: true }, "5ugzvr-smtlt7"],
  ["post Date", { method: "post", url: "/d", data: { at: new Date(1700000000000) } }, {}, "u4ok6d-8u218d"],
  ["post URLSearchParams", { method: "post", url: "/u", data: new URLSearchParams("a=1&b=2") }, {}, "43opby-hgruyi"],
  ["put 数组对象", { method: "put", url: "/arr", data: [{ a: 1 }, { b: [2, 3] }, "s", 4, true] }, {}, "1kwzv4g-5qfrk"],
  ["patch 二进制", { method: "patch", url: "/bin", data: Buffer.from("hello") }, {}, "1s6w7f1-11i63yh"],
  ["delete data", { method: "delete", url: "/pets/1", data: { reason: "x" } }, {}, "1a7d6ep-b8evix"],
  ["scope 字符串", { method: "get", url: "/pets", params: { a: 1 } }, { scope: "acct" }, "ycb2s0-1kpwuv4#acct"],
  ["scope 数字零", { method: "get", url: "/pets", params: { a: 1 } }, { scope: 0 }, "ycb2s0-1kpwuv4#0"],
  ["scope 函数", { method: "get", url: "/pets", params: { a: 1 } }, { scope: () => "fn" }, "ycb2s0-1kpwuv4#fn"],
  ["显式 key 去空白", { method: "get", url: "/pets", key: "  fixed " }, {}, "fixed"],
  ["显式 key 附加 scope", { method: "get", url: "/pets", key: "fixed" }, { scope: "acct" }, "fixed#acct"],
  ["key false 关闭", { method: "get", url: "/pets", key: false }, {}, null],
  ["缺省方法按 get", { url: "/default" }, {}, "153xa93-dme0ln"],
  ["方法名大写", { method: "POST", url: "/upper", data: { a: 1 } }, {}, "17jt95g-1rpmuk4"],
  ["不可哈希的 Map", { method: "post", url: "/map", data: new Map([[1, 2]]) }, {}, null],
];
it.each(SNAPSHOTS)(
  "[core.method.key] 固定输入输出逐位不变：%s",
  /** 指纹算法在固定输入上的输出不随内部重构变化。 */ (_name, request, options, key) => {
    expect(requestKey(request, options)).toBe(key);
  },
);
