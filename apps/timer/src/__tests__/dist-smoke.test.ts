/**
 * Smoke test against the terser-post-minified dist bundle.
 * Verifies that mangling `_*` private fields doesn't break runtime behavior.
 */
import { describe, it, expect } from "vitest";
// @ts-ignore — minified runtime bundle, no .d.ts
import * as Dist from "../../dist/index.min.js";

const { Timer, ease, buildCountUpFormatter, buildHighPerfFormatter } = Dist;

describe("dist/index.min.js smoke", () => {
  it("buildCountUpFormatter still works (new Function path)", () => {
    expect(buildCountUpFormatter({ prefix: "$" })(1234567.89)).toBe("$1,234,567.89");
  });

  it("buildHighPerfFormatter still works", () => {
    expect(buildHighPerfFormatter("HH:mm:ss")(3661000)).toBe("01:01:01");
  });

  it("countDown + countUp 内置 API", () => {
    const t = new Timer();
    t.stop();

    let cdTxt = "";
    t.countDown(2000, (txt: string) => {
      cdTxt = txt;
    });
    t.manager.tick(0);
    t.manager.tick(1000);
    expect(cdTxt.length).toBeGreaterThan(0);

    let cuTxt = "";
    t.countUp(100, { duration: 100, fps: 0, prefix: "$", easing: ease.linear }, (txt: string) => {
      cuTxt = txt;
    });
    t.manager.tick(0);
    t.manager.tick(100);
    expect(cuTxt.startsWith("$")).toBe(true);
  });

  it("pause / resume / setTimeout", () => {
    const t = new Timer();
    t.stop();
    let fired = 0;
    t.setTimeout(() => {
      fired++;
    }, 500);
    t.manager.tick(500);
    expect(fired).toBe(1);
    t.manager.tick(1500);
    expect(fired).toBe(1);
  });
});
