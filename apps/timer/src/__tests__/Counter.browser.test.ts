/**
 * Counter 在真实 Chromium 中跑真 RAF 的端到端测试。
 *
 * 验证同 label 共用一条 RAF 循环、不同 label 各自独立、clear/reset 正确停止真实任务。
 */
import { describe, it, expect, afterEach } from "vitest"
import { Counter } from "../Counter"

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

afterEach(() => {
  Counter.resetCountdown()
  Counter.resetCountup()
})

describe("Counter — 真实 RAF (browser)", () => {
  it("同 label 批量任务在真 RAF 下并发触发", async () => {
    const a: number[] = []
    const b: number[] = []
    const c: number[] = []
    Counter.countdown(1_000, "batch", (txt) => a.push(performance.now()), { interval: 80 })
    Counter.countdown(1_000, "batch", (txt) => b.push(performance.now()), { interval: 80 })
    Counter.countdown(1_000, "batch", (txt) => c.push(performance.now()), { interval: 80 })

    await wait(260) // 期望大约 2~3 次回调
    expect(a.length).toBeGreaterThanOrEqual(2)
    expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1)
    expect(Math.abs(b.length - c.length)).toBeLessThanOrEqual(1)
    // 同 tick 触发，三个回调时间戳应非常接近（< 5ms）
    expect(Math.abs(a[0] - b[0])).toBeLessThan(5)
    expect(Math.abs(b[0] - c[0])).toBeLessThan(5)
  })

  it("不同 label 各自独立运行，clear 一个不影响另一个", async () => {
    let aCount = 0
    let bCount = 0
    Counter.countdown(1_000, "A", () => aCount++, { interval: 60 })
    Counter.countdown(1_000, "B", () => bCount++, { interval: 60 })

    await wait(220)
    expect(aCount).toBeGreaterThan(1)
    expect(bCount).toBeGreaterThan(1)

    Counter.clearCountdown("A")
    const aSnap = aCount
    const bSnap = bCount
    await wait(200)
    expect(aCount).toBe(aSnap) // A 已停
    expect(bCount).toBeGreaterThan(bSnap) // B 仍在跑
  })

  it("countup 在真浏览器中按 duration 完成动画并写 el", async () => {
    const el = document.createElement("span")
    document.body.appendChild(el)

    try {
      Counter.countup(500, "wallet", { el, duration: 200, fps: 0, prefix: "$" })
      await wait(320)
      expect(el.textContent).toContain("$")
      const num = parseFloat(el.textContent!.slice(1).replace(/,/g, ""))
      expect(num).toBeCloseTo(500, 0)
    } finally {
      document.body.removeChild(el)
    }
  })

  it("resetCountdown 会停掉所有真 RAF 任务", async () => {
    let total = 0
    Counter.countdown(1_000, "a", () => total++, { interval: 50 })
    Counter.countdown(1_000, "b", () => total++, { interval: 50 })

    await wait(180)
    expect(total).toBeGreaterThan(2)

    Counter.resetCountdown()
    const snap = total
    await wait(200)
    expect(total).toBe(snap) // 全部任务都已停止
  })

  it("混合 countdown + countup 同 label 各自独立计时", async () => {
    let cdCalls = 0
    const cuValues: number[] = []
    Counter.countdown(1_000, "mix", () => cdCalls++, { interval: 60 })
    Counter.countup(100, "mix", { duration: 200, fps: 0, prefix: "" }, (txt) => cuValues.push(parseFloat(txt)))

    await wait(300)
    expect(cdCalls).toBeGreaterThan(2)
    expect(cuValues.length).toBeGreaterThan(3)
    expect(cuValues[cuValues.length - 1]).toBeCloseTo(100, 0)

    // 单独清 countup 不影响 countdown
    const cdSnap = cdCalls
    Counter.clearCountup("mix")
    await wait(120)
    expect(cdCalls).toBeGreaterThan(cdSnap)
  })
})
