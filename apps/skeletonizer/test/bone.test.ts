import { expect, it } from "vitest";

import { Bone } from "../src/bone.ts";

it("Bone 不能被实例化", () => {
  expect(() => new Bone()).toThrow(TypeError);
});

it("text：长度精确、确定性、词间有空格", () => {
  for (const n of [1, 5, 20, 80, 333]) {
    const s = Bone.text(n);
    expect(s.length).toBe(n);
    expect(s).toBe(Bone.text(n));
  }
  expect(Bone.text(40).includes(" ")).toBe(true);
  expect(Bone.text(60)).toMatch(/^[█ ]+$/);
  expect(Bone.text(0)).toBe("");
  expect(Bone.text(40, { seed: 1 })).not.toBe(Bone.text(40, { seed: 2 }));
});

it("text：结尾不留空格", () => {
  for (let n = 1; n < 100; n++) expect(Bone.text(n).endsWith(" ")).toBe(false);
});

it("lines：长度 = 行数 × 每行字符数", () => {
  expect(Bone.lines(3, { perLine: 30 }).length).toBe(90);
  expect(Bone.lines(0)).toBe("");
});

it("cjk：方块数精确，含零宽断点，确定性", () => {
  const s = Bone.cjk(20);
  expect(s.split("█").length - 1).toBe(20);
  expect(s.includes("​")).toBe(true);
  expect(s).toBe(Bone.cjk(20));
  expect(s.endsWith("​")).toBe(false);
});

it("number：固定位数", () => {
  expect(Bone.number(4)).toBe("█".repeat(4));
  expect(Bone.number()).toBe("█".repeat(3));
});

it("image：无参返回 1px base64 gif", () => {
  expect(Bone.image()).toBe(Bone.GIF_1PX);
  expect(Bone.GIF_1PX.startsWith("data:image/gif;base64,")).toBe(true);
});

it("image：传宽高返回带尺寸的 svg；非法参数退回 gif", () => {
  const uri = Bone.image(120, 80);
  expect(uri.startsWith("data:image/svg+xml")).toBe(true);
  const svg = decodeURIComponent(uri.split(",")[1]);
  expect(svg).toMatch(/width="120"/);
  expect(svg).toMatch(/height="80"/);
  expect(Bone.image(0, 80)).toBe(Bone.GIF_1PX);
  expect(Bone.image(-1)).toBe(Bone.GIF_1PX);
});

it("image：只传 w 时 h 默认等于 w，得到方图", () => {
  expect(Bone.image(48)).toBe(Bone.image(48, 48));
  const svg = decodeURIComponent(Bone.image(48).split(",")[1]);
  expect(svg).toMatch(/width="48"/);
  expect(svg).toMatch(/height="48"/);
});
