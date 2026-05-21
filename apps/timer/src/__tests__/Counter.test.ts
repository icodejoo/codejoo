import { describe, it, expect, vi, afterEach } from "vitest"
import { Counter } from "../Counter"

// 每个用例后清理所有分组，确保用例间互不影响
afterEach(() => {
  Counter.resetCountdown()
  Counter.resetCountup()
})

/** 在被 stop 掉的 Timer 上手动推进时间（绕过 RAF） */
function tickGroup(getInternalTimer: () => any, dt: number) {
  const timer = getInternalTimer()
  // 通过反射读取私有分组表，找到任一 Timer 实例直接 tick
  timer.manager.tick(dt)
}

describe("Counter.countdown — 分组化倒计时", () => {
  it("相同 label 复用同一 Timer 实例", () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    Counter.countdown(5000, "cart", cb1)
    Counter.countdown(5000, "cart", cb2)

    // 两个任务应共享同一个 Timer（同一 manager）
    const groups = (Counter as any)._countdownGroups as Map<string, any>
    expect(groups.size).toBe(1)
    expect(groups.get("cart").size).toBe(2)
  })

  it("不同 label 创建独立 Timer 实例", () => {
    Counter.countdown(5000, "a", vi.fn())
    Counter.countdown(5000, "b", vi.fn())

    const groups = (Counter as any)._countdownGroups as Map<string, any>
    expect(groups.size).toBe(2)
    expect(groups.get("a")).not.toBe(groups.get("b"))
  })

  it("hasCountdown 反映分组存在性", () => {
    expect(Counter.hasCountdown("x")).toBe(false)
    Counter.countdown(1000, "x", vi.fn())
    expect(Counter.hasCountdown("x")).toBe(true)
  })

  it("回调按 interval 触发，到 0 自动停止", () => {
    Counter.countdown(3000, "tick", vi.fn())
    const groups = (Counter as any)._countdownGroups as Map<string, any>
    const timer = groups.get("tick")
    timer.stop()

    const cb = vi.fn()
    Counter.countdown(3000, "tick", cb)
    tickGroup(() => timer, 1000)
    tickGroup(() => timer, 2000)
    tickGroup(() => timer, 3000)
    expect(cb).toHaveBeenCalled()
  })

  it("options 透传给 Timer.countDown（自定义 interval）", () => {
    Counter.countdown(2000, "fast", vi.fn())
    const groups = (Counter as any)._countdownGroups as Map<string, any>
    const timer = groups.get("fast")
    timer.stop()

    const calls: string[] = []
    Counter.countdown(2000, "fast", (txt) => calls.push(txt), { interval: 100 })
    tickGroup(() => timer, 100)
    tickGroup(() => timer, 200)
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it("返回值是 Timer.countDown 的 ICountDownControl", () => {
    const ctrl = Counter.countdown(5000, "ctrl", vi.fn())
    expect(typeof ctrl.id).toBe("number")
    expect(typeof ctrl.remove).toBe("function")
  })
})

describe("Counter.countup — 分组化数字滚动", () => {
  it("相同 label 复用同一 Timer 实例", () => {
    Counter.countup(100, "wallet", vi.fn())
    Counter.countup(200, "wallet", vi.fn())

    const groups = (Counter as any)._countupGroups as Map<string, any>
    expect(groups.size).toBe(1)
    expect(groups.get("wallet").size).toBe(2)
  })

  it("不同 label 创建独立 Timer 实例", () => {
    Counter.countup(100, "a", vi.fn())
    Counter.countup(100, "b", vi.fn())
    expect((Counter as any)._countupGroups.size).toBe(2)
  })

  it("options + callback 双参形式", () => {
    Counter.countup(100, "opt", { duration: 100, fps: 0, prefix: "$" }, vi.fn())
    const groups = (Counter as any)._countupGroups as Map<string, any>
    const timer = groups.get("opt")
    timer.stop()

    const calls: string[] = []
    Counter.countup(100, "opt", { duration: 100, fps: 0, prefix: "$" }, (txt) => calls.push(txt))
    tickGroup(() => timer, 0)
    tickGroup(() => timer, 100)
    expect(calls[calls.length - 1].startsWith("$")).toBe(true)
  })

  it("callback 单参形式", () => {
    expect(() => Counter.countup(100, "cb", vi.fn())).not.toThrow()
  })

  it("返回值是 Timer.countUp 的 ICountUpControl", () => {
    const ctrl = Counter.countup(100, "x", { duration: 100 }, vi.fn())
    expect(typeof ctrl.id).toBe("number")
    expect(typeof ctrl.update).toBe("function")
    expect(typeof ctrl.remove).toBe("function")
  })
})

describe("Counter.clear* / reset*", () => {
  it("clearCountdown(label): 仅释放指定分组", () => {
    Counter.countdown(5000, "a", vi.fn())
    Counter.countdown(5000, "b", vi.fn())
    Counter.clearCountdown("a")

    const groups = (Counter as any)._countdownGroups as Map<string, any>
    expect(groups.has("a")).toBe(false)
    expect(groups.has("b")).toBe(true)
  })

  it("clearCountdown(): 释放所有 countdown 分组", () => {
    Counter.countdown(5000, "a", vi.fn())
    Counter.countdown(5000, "b", vi.fn())
    Counter.clearCountdown()
    expect((Counter as any)._countdownGroups.size).toBe(0)
  })

  it("clearCountdown 仅影响 countdown，countup 不受影响", () => {
    Counter.countdown(5000, "a", vi.fn())
    Counter.countup(100, "a", vi.fn())
    Counter.clearCountdown()
    expect((Counter as any)._countdownGroups.size).toBe(0)
    expect((Counter as any)._countupGroups.size).toBe(1)
  })

  it("clearCountup(label) / clearCountup() 同样工作", () => {
    Counter.countup(100, "a", vi.fn())
    Counter.countup(100, "b", vi.fn())
    Counter.clearCountup("a")
    expect((Counter as any)._countupGroups.has("a")).toBe(false)
    expect((Counter as any)._countupGroups.has("b")).toBe(true)
    Counter.clearCountup()
    expect((Counter as any)._countupGroups.size).toBe(0)
  })

  it("clear 不存在的 label 不抛错", () => {
    expect(() => Counter.clearCountdown("nope")).not.toThrow()
    expect(() => Counter.clearCountup("nope")).not.toThrow()
  })

  it("resetCountdown 等价于 clearCountdown()", () => {
    Counter.countdown(5000, "a", vi.fn())
    Counter.countdown(5000, "b", vi.fn())
    Counter.resetCountdown()
    expect((Counter as any)._countdownGroups.size).toBe(0)
  })

  it("resetCountup 等价于 clearCountup()", () => {
    Counter.countup(100, "a", vi.fn())
    Counter.countup(100, "b", vi.fn())
    Counter.resetCountup()
    expect((Counter as any)._countupGroups.size).toBe(0)
  })

  it("clear 后再用同名 label 会新建 Timer 实例", () => {
    Counter.countdown(5000, "x", vi.fn())
    const oldTimer = (Counter as any)._countdownGroups.get("x")
    Counter.clearCountdown("x")
    Counter.countdown(5000, "x", vi.fn())
    const newTimer = (Counter as any)._countdownGroups.get("x")
    expect(newTimer).not.toBe(oldTimer)
  })
})

// ========================= 批量处理 =========================

/** 直接从私有分组表读取 Timer，便于在测试中手动 tick */
function getDownTimer(label: string): any {
  return (Counter as any)._countdownGroups.get(label)
}
function getUpTimer(label: string): any {
  return (Counter as any)._countupGroups.get(label)
}

describe("Counter — 批量处理 (batch)", () => {
  it("同 label 批量 countdown: 共享一个 Timer 实例", () => {
    const N = 50
    const ctrls: ReturnType<typeof Counter.countdown>[] = []
    for (let i = 0; i < N; i++) {
      ctrls.push(Counter.countdown(10_000 + i, "batch", vi.fn()))
    }
    const timer = getDownTimer("batch")
    expect((Counter as any)._countdownGroups.size).toBe(1)
    expect(timer.size).toBe(N)
    // ID 唯一且来自同一 Timer 的自增序列
    const ids = new Set(ctrls.map((c) => c.id))
    expect(ids.size).toBe(N)
  })

  it("同 label 同 interval 批量任务全部进入同一平铺数组", () => {
    const N = 30
    for (let i = 0; i < N; i++) {
      Counter.countdown(10_000, "samebucket", vi.fn(), { interval: 1000 })
    }
    const timer = getDownTimer("samebucket")
    // 平铺存储：全部 N 个 entry 同在一个数组
    const entries: any[] = timer.manager._entries
    expect(entries.length).toBe(N)
    // 任务 interval 一致
    expect(entries.every((e) => e.task.interval === 1000)).toBe(true)
    expect(timer.size).toBe(N)
  })

  it("批量同 label countdown: 所有回调同 tick 触发", () => {
    const N = 20
    Counter.countdown(5000, "fan", vi.fn()) // 先建分组，再 stop
    const timer = getDownTimer("fan")
    timer.stop()

    const cbs = Array.from({ length: N }, () => vi.fn())
    for (const cb of cbs) Counter.countdown(5000, "fan", cb, { interval: 1000 })
    timer.manager.tick(1000)
    for (const cb of cbs) expect(cb).toHaveBeenCalledTimes(1)
  })

  it("批量不同 label countdown: 每个 label 各自独立 Timer", () => {
    const N = 25
    for (let i = 0; i < N; i++) {
      Counter.countdown(5000, `label-${i}`, vi.fn())
    }
    const groups = (Counter as any)._countdownGroups as Map<string, any>
    expect(groups.size).toBe(N)
    const timers = new Set([...groups.values()])
    expect(timers.size).toBe(N)
  })

  it("同 label 批量 countup: 共享一个 Timer 实例", () => {
    const N = 40
    for (let i = 0; i < N; i++) {
      Counter.countup(100 + i, "ups", { duration: 500, fps: 30 }, vi.fn())
    }
    const timer = getUpTimer("ups")
    expect((Counter as any)._countupGroups.size).toBe(1)
    expect(timer.size).toBe(N)
  })

  it("混合 countdown + countup 用同 label: 分别走两套独立分组表", () => {
    const labelName = "shared"
    Counter.countdown(5000, labelName, vi.fn())
    Counter.countup(100, labelName, vi.fn())

    const downTimer = getDownTimer(labelName)
    const upTimer = getUpTimer(labelName)
    expect(downTimer).toBeDefined()
    expect(upTimer).toBeDefined()
    // 即使 label 相同，countdown 和 countup 也是两个独立 Timer
    expect(downTimer).not.toBe(upTimer)
    expect(downTimer.size).toBe(1)
    expect(upTimer.size).toBe(1)
  })

  it("批量 ctrl.remove(): 同 label 内任务可独立取消，不影响其它任务", () => {
    const N = 10
    const ctrls = Array.from({ length: N }, () => Counter.countdown(5000, "rm-each", vi.fn()))
    const timer = getDownTimer("rm-each")
    expect(timer.size).toBe(N)

    // 取消前 5 个
    for (let i = 0; i < 5; i++) ctrls[i].remove()
    expect(timer.size).toBe(N - 5)

    // 分组本身仍然存在
    expect(Counter.hasCountdown("rm-each")).toBe(true)
  })

  it("批量 ctrl.remove() 移除全部任务后，分组本身仍然保留（需 clear 才释放）", () => {
    const N = 8
    const ctrls = Array.from({ length: N }, () => Counter.countdown(5000, "rm-all", vi.fn()))
    for (const c of ctrls) c.remove()
    expect(getDownTimer("rm-all").size).toBe(0)
    expect(Counter.hasCountdown("rm-all")).toBe(true) // 分组未释放
  })

  it("批量 clearCountdown(label): 一次性释放整个分组，包括所有任务", () => {
    const N = 15
    for (let i = 0; i < N; i++) Counter.countdown(5000, "bulk", vi.fn())
    expect(getDownTimer("bulk").size).toBe(N)
    Counter.clearCountdown("bulk")
    expect(Counter.hasCountdown("bulk")).toBe(false)
  })

  it("批量 resetCountdown: 多 label 一次性全清", () => {
    const labels = ["a", "b", "c", "d", "e"]
    for (const l of labels) {
      Counter.countdown(5000, l, vi.fn())
      Counter.countdown(5000, l, vi.fn())
    }
    expect((Counter as any)._countdownGroups.size).toBe(labels.length)
    Counter.resetCountdown()
    expect((Counter as any)._countdownGroups.size).toBe(0)
  })

  it("大规模 200 任务跨 20 label: 调度仍正确", () => {
    const LABELS = 20
    const PER = 10
    for (let i = 0; i < LABELS; i++) {
      for (let j = 0; j < PER; j++) {
        Counter.countdown(5000, `L${i}`, vi.fn(), { interval: 1000 })
      }
    }
    expect((Counter as any)._countdownGroups.size).toBe(LABELS)

    const target = getDownTimer("L0")
    target.stop()
    const cb = vi.fn()
    Counter.countdown(5000, "L0", cb, { interval: 1000 })
    target.manager.tick(1000)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it("混合批量: 一半 countdown + 一半 countup, 跨多个 label", () => {
    const LABELS = 5
    const PER = 6
    for (let i = 0; i < LABELS; i++) {
      const label = `mix-${i}`
      for (let j = 0; j < PER; j++) {
        Counter.countdown(5000, label, vi.fn())
        Counter.countup(100, label, { duration: 500 }, vi.fn())
      }
    }
    expect((Counter as any)._countdownGroups.size).toBe(LABELS)
    expect((Counter as any)._countupGroups.size).toBe(LABELS)
    for (let i = 0; i < LABELS; i++) {
      expect(getDownTimer(`mix-${i}`).size).toBe(PER)
      expect(getUpTimer(`mix-${i}`).size).toBe(PER)
    }
  })

  it("批量 clear 单 label 不影响其它 label 任务", () => {
    Counter.countdown(5000, "keep", vi.fn())
    Counter.countdown(5000, "keep", vi.fn())
    Counter.countdown(5000, "drop", vi.fn())
    Counter.countdown(5000, "drop", vi.fn())

    Counter.clearCountdown("drop")
    expect(Counter.hasCountdown("drop")).toBe(false)
    expect(Counter.hasCountdown("keep")).toBe(true)
    expect(getDownTimer("keep").size).toBe(2)
  })
})

// ========================= 边界场景 =========================

describe("Counter — 边界场景", () => {
  it("空字符串 '' 也是合法的分组键", () => {
    Counter.countdown(5000, "", vi.fn())
    expect(Counter.hasCountdown("")).toBe(true)
    expect((Counter as any)._countdownGroups.size).toBe(1)
  })

  it("countdown duration 越界仍会抛错（透传 Timer.countDown 校验）", () => {
    expect(() => Counter.countdown(1e12, "bad", vi.fn())).toThrow()
    expect(() => Counter.countdown(NaN as any, "bad2", vi.fn())).toThrow()
  })

  it("countup 既无 callback 又无 el 时抛错", () => {
    expect(() => Counter.countup(100, "noop", {})).toThrow()
  })

  it("countdown 与 countup 各自维护独立分组表，不会互相覆盖", () => {
    Counter.countdown(5000, "x", vi.fn())
    Counter.countup(100, "x", vi.fn())
    Counter.clearCountdown("x")
    expect(Counter.hasCountdown("x")).toBe(false)
    expect(Counter.hasCountup("x")).toBe(true)
  })

  it("在回调中对自身分组 clearCountdown 不抛错（虽然下次 tick 不再触发）", () => {
    Counter.countdown(10_000, "selfdestruct", vi.fn())
    const timer = getDownTimer("selfdestruct")
    timer.stop()

    const cb = vi.fn(() => {
      // 在 tick 回调中清空整个分组
      Counter.clearCountdown("selfdestruct")
    })
    Counter.countdown(10_000, "selfdestruct", cb, { interval: 1000 })
    expect(() => timer.manager.tick(1000)).not.toThrow()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it("clearXxx() 不传 label 时清空全部分组（包括空 label）", () => {
    Counter.countdown(5000, "", vi.fn())
    Counter.countdown(5000, "x", vi.fn())
    Counter.clearCountdown()
    expect((Counter as any)._countdownGroups.size).toBe(0)
  })

  it("clear 期间不会泄漏：相同 label 反复 add/clear 内存稳定", () => {
    for (let i = 0; i < 100; i++) {
      Counter.countdown(5000, "churn", vi.fn())
      Counter.clearCountdown("churn")
    }
    expect((Counter as any)._countdownGroups.size).toBe(0)
  })

  it("hasCountdown / hasCountup 严格按各自分组表查询", () => {
    Counter.countdown(5000, "only-down", vi.fn())
    Counter.countup(100, "only-up", vi.fn())
    expect(Counter.hasCountdown("only-down")).toBe(true)
    expect(Counter.hasCountdown("only-up")).toBe(false)
    expect(Counter.hasCountup("only-up")).toBe(true)
    expect(Counter.hasCountup("only-down")).toBe(false)
  })
})
