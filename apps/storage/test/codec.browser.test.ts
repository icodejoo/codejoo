// codec 三变体（codec / codecBase64 / codecAtob）+ codeable 值编解码 + 解码失败清脏。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { factory } from "../src/core";
import { codec, codecAtob, codecBase64 } from "../src/codec";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("codec — 混淆/编解码", () => {
  it("codeable + codec：底层被混淆，读出仍是原值", () => {
    const { ls: c } = factory({ codeable: true, codec: codec("pw") });
    c.set("secret", "topsecret");
    const raw = localStorage.getItem("secret");
    expect(raw != null && !raw.includes("topsecret")).toBe(true);
    expect(c.get("secret")).toEqual("topsecret");
  });
  it("codec encode/decode 往返", () => {
    const cdc = codec("k");
    expect(cdc.decode(cdc.encode("abc中文🎉"))).toEqual("abc中文🎉");
  });
  it("codec 全 BMP 码元 + 增补平面字符往返，输出恒为合法 UTF-16", () => {
    const cdc = codec("k");
    let s = "🎉😀𝕏";
    for (let c = 0; c <= 0xffff; c++) if (c < 0xd800 || c > 0xdfff) s += String.fromCharCode(c);
    const enc = cdc.encode(s);
    for (let i = 0; i < enc.length; i++) {
      const u = enc.charCodeAt(i);
      if (u >= 0xd800 && u <= 0xdbff) {
        const lo = enc.charCodeAt(++i);
        expect(lo >= 0xdc00 && lo <= 0xdfff).toBe(true);
      } else {
        expect(u < 0xdc00 || u > 0xdfff).toBe(true);
      }
    }
    expect(cdc.decode(enc)).toEqual(s);
  });
  it("codec 长字符串往返", () => {
    const cdc = codec("k");
    const s = JSON.stringify({ list: Array.from({ length: 3000 }, (_, i) => `项目-${i}-数据`) });
    expect(s.length > 8192).toBe(true);
    expect(cdc.decode(cdc.encode(s))).toEqual(s);
  });
  it("codecBase64 输出无标准 base64 特征（无 + / = 字符）", () => {
    const cdc = codecBase64("k");
    const enc = cdc.encode(JSON.stringify({ a: "明文数据", b: [1, 2, 3] }));
    expect(/[+/=]/.test(enc)).toBe(false);
  });
  it("codecBase64 无 toBase64 时回退 atob/btoa，格式与原生一致、可互解", () => {
    const plain = "兼容性数据 compat-😀";
    const native = codecBase64("k").encode(plain);
    const o1 = Uint8Array.prototype.toBase64;
    const o2 = Uint8Array.fromBase64;
    try {
      // @ts-expect-error 模拟旧运行时
      delete Uint8Array.prototype.toBase64;
      // @ts-expect-error 模拟旧运行时
      delete Uint8Array.fromBase64;
      const fb = codecBase64("k");
      expect(fb.encode(plain)).toEqual(native);
      expect(fb.decode(native)).toEqual(plain);
      expect(fb.decode(codecBase64("wrong").encode(plain))).toEqual(null);
    } finally {
      Uint8Array.prototype.toBase64 = o1;
      Uint8Array.fromBase64 = o2;
    }
    expect(codecBase64("k").decode(native)).toEqual(plain);
  });
  it("codecBase64 与 codecAtob 同格式互解；三变体错口令均为 null", () => {
    const s = "互解测试 interop-😀";
    const a = codecBase64("k").encode(s);
    const b = codecAtob("k").encode(s);
    expect(a).toEqual(b);
    expect(codecAtob("k").decode(a)).toEqual(s);
    expect(codecBase64("k").decode(b)).toEqual(s);
    for (const make of [codec, codecBase64, codecAtob]) {
      const enc = make("pw").encode(s);
      expect(make("pw").decode(enc)).toEqual(s);
      expect(make("other").decode(enc)).toEqual(null);
      expect(enc.includes("互解测试")).toBe(false);
    }
  });
  it("codec 错误口令解码 → null", () => {
    const enc = codec("right").encode("data");
    expect(codec("wrong").decode(enc)).toEqual(null);
  });
  it("codec key 变更：旧数据解不开 → 回退默认值", () => {
    const { ls: c1 } = factory({ codeable: true, codec: codec("old") });
    c1.set("mig", "v");
    const { ls: c2 } = factory({ codeable: true, codec: codec("new") });
    expect(c2.get("mig", "fallback")).toEqual("fallback");
  });
  it("解码失败清脏：损坏的编码值首读即被清除", () => {
    const { ls: c } = factory({ codeable: true, codec: codec("k") });
    c.set("dirty", "v");
    // 偷偷写入一个用错口令编码的串（本实例解不开 → 视为损坏）
    localStorage.setItem("dirty", codec("wrong").encode(JSON.stringify({ value: "x", createdAt: Date.now() })));
    expect(c.get("dirty")).toEqual(null);
    expect(localStorage.getItem("dirty")).toEqual(null);
  });
});
