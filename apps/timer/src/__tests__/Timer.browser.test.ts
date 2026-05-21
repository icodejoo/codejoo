/**
 * 真 RAF 端到端测试 —— 在 Chromium 中验证 Timer 在真实浏览器调度下的行为。
 *
 * 与 jsdom 测试的区别：
 * - jsdom 的 requestAnimationFrame 是 setTimeout(16) 的近似 shim，时序不真实
 * - 这里用真 RAF + 真 performance.now()，验证 wall-clock 行为
 *
 * 为了让用例总时长可控，所有 duration 都尽量短（≤ 500ms）。
 */
import { describe, it, expect, afterEach } from "vitest"
import { Timer } from "../Timer"

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

let activeTimers: Timer[] = []
afterEach(() => {
  for (const t of activeTimers) t.stop()
  activeTimers = []
})
function track<T extends Timer>(t: T): T {
  activeTimers.push(t)
  return t
}

describe("Timer — 真实 RAF (browser)", () => {
  it("setTimeout 在真实时间下触发（接近指定 interval）", async () => {
    const t = track(new Timer())
    const start = performance.now()
    let firedAt = -1
    t.setTimeout(() => (firedAt = performance.now() - start), 120)

    await wait(220)
    expect(firedAt).toBeGreaterThan(80) // 允许提前一帧
    expect(firedAt).toBeLessThan(220) // 也允许一两帧延迟
  })

  it("setInterval 每秒一次：500ms 内大约 5 次 (100ms)", async () => {
    const t = track(new Timer())
    let count = 0
    t.setInterval(() => count++, 100)
    await wait(550)
    // 真 RAF 下 ~60fps，100ms 间隔在 500ms 中至少触发 4 次、不超过 7 次
    expect(count).toBeGreaterThanOrEqual(4)
    expect(count).toBeLessThanOrEqual(7)
  })

  it("pause/resume：暂停期间不触发回调，时间补偿无跳帧", async () => {
    const t = track(new Timer())
    let count = 0
    t.setInterval(() => count++, 80)

    await wait(250) // 期间应触发 ~3 次
    const beforePause = count
    expect(beforePause).toBeGreaterThanOrEqual(2)

    t.pause()
    await wait(200) // 暂停期间不应再触发
    expect(count).toBe(beforePause)

    t.resume()
    await wait(250) // 恢复后又应触发 ~3 次
    expect(count).toBeGreaterThan(beforePause + 1)
  })

  it("stop 后任务不再触发", async () => {
    const t = track(new Timer())
    let count = 0
    t.setInterval(() => count++, 50)
    await wait(160)
    expect(count).toBeGreaterThan(0)

    t.stop()
    const after = count
    await wait(200)
    expect(count).toBe(after) // stop 之后不应再有任何回调
  })
})

describe("countDown — 真实 RAF (browser)", () => {
  it("倒计时按 interval 回调并在到期后自动停止", async () => {
    const t = track(new Timer())
    const calls: string[] = []
    t.countDown(300, (txt) => calls.push(txt), { interval: 100 })
    await wait(600)
    // 300ms 倒计时，100ms interval：约触发 3 次，到 0 后自动停止
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls.length).toBeLessThanOrEqual(4)
    // 即便再等也不应再增长
    const finalCount = calls.length
    await wait(200)
    expect(calls.length).toBe(finalCount)
  })

  it("毫秒精度倒计时（interval=0，每帧更新）", async () => {
    const t = track(new Timer())
    const calls: string[] = []
    t.countDown(200, (txt) => calls.push(txt), { interval: 0 })
    await wait(280)
    // 每帧更新，200ms 在 60fps 下应 ~12 次以上
    expect(calls.length).toBeGreaterThan(5)
  })

  it("提前 remove() 立即停止", async () => {
    const t = track(new Timer())
    let count = 0
    const ctrl = t.countDown(1000, () => count++, { interval: 50 })
    await wait(150)
    expect(count).toBeGreaterThan(0)

    ctrl.remove()
    const after = count
    await wait(200)
    expect(count).toBe(after)
  })
})

describe("countUp — 真实 RAF (browser)", () => {
  it("数字滚动到目标值并自动停止", async () => {
    const t = track(new Timer())
    const calls: string[] = []
    t.countUp(100, { duration: 200, fps: 0, prefix: "" }, (txt) => calls.push(txt))

    await wait(350)
    expect(calls.length).toBeGreaterThan(3)
    const last = parseFloat(calls[calls.length - 1])
    expect(last).toBeCloseTo(100, 0)

    const finalCount = calls.length
    await wait(200)
    expect(calls.length).toBe(finalCount)
  })

  it("countUp 绑定 el：真实写入 textContent", async () => {
    const el = document.createElement("span")
    document.body.appendChild(el)

    try {
      const t = track(new Timer())
      t.countUp(50, { el, duration: 150, fps: 0, prefix: "$" })
      await wait(250)
      expect(el.textContent).not.toBe("") // 已经被写入
      const finalNum = parseFloat(el.textContent!.slice(1))
      expect(finalNum).toBeCloseTo(50, 0)
    } finally {
      document.body.removeChild(el)
    }
  })

  it("update() 平滑重定向：当前值连续过渡到新目标", async () => {
    const t = track(new Timer())
    // 关闭千分位避免 parseFloat 在逗号处截断（"1,000" → 1）
    const parse = (txt: string) => parseFloat(txt.replace(/,/g, ""))
    const values: number[] = []
    const ctrl = t.countUp(100, { duration: 400, fps: 0, prefix: "" }, (txt) => values.push(parse(txt)))

    await wait(120) // 动画进行中
    const midValue = values[values.length - 1]
    expect(midValue).toBeGreaterThan(0)
    expect(midValue).toBeLessThan(100)

    ctrl.update(1000) // 重定向到 1000
    await wait(550) // 等动画跑完
    const last = values[values.length - 1]
    expect(last).toBeGreaterThan(midValue)
    expect(last).toBeCloseTo(1000, -1) // 接近 1000（数量级匹配）
  })
})

describe("多任务调度 — 真实 RAF (browser)", () => {
  it("同 interval 多任务共享桶，同帧触发", async () => {
    const t = track(new Timer())
    const a: number[] = []
    const b: number[] = []
    const c: number[] = []
    t.setInterval(() => a.push(performance.now()), 100)
    t.setInterval(() => b.push(performance.now()), 100)
    t.setInterval(() => c.push(performance.now()), 100)
    await wait(330)
    // 三个回调次数应几乎一致（±1）
    expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1)
    expect(Math.abs(b.length - c.length)).toBeLessThanOrEqual(1)
    // 同一 tick 触发：第 0 次回调时间戳应相距很近（< 5ms 容差）
    if (a.length > 0 && b.length > 0 && c.length > 0) {
      expect(Math.abs(a[0] - b[0])).toBeLessThan(5)
      expect(Math.abs(b[0] - c[0])).toBeLessThan(5)
    }
  })

  it("countDown + countUp 并存：互不干扰", async () => {
    const t = track(new Timer())
    const cdCalls: string[] = []
    const cuCalls: number[] = []

    t.countDown(200, (txt) => cdCalls.push(txt), { interval: 50 })
    t.countUp(100, { duration: 200, fps: 0, prefix: "" }, (txt) => cuCalls.push(parseFloat(txt)))

    await wait(350)
    expect(cdCalls.length).toBeGreaterThan(2)
    expect(cuCalls.length).toBeGreaterThan(3)
    expect(cuCalls[cuCalls.length - 1]).toBeCloseTo(100, 0)
  })
})
