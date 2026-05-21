import { Timer } from "../Timer";

/**
 * 创建一个被手动控制时间的 Timer：
 * - 构造后立即 stop()，禁用真实 RAF 循环
 * - 通过 advance(dt) 直接调用 manager.tick(dt) 模拟时间推进
 */
export function createTestTimer(opts?: ConstructorParameters<typeof Timer>[0]) {
  const timer = new Timer(opts);
  timer.stop();
  return {
    timer,
    /** 推进 dt 到指定毫秒，触发到期任务 */
    advance(dt: number) {
      timer.manager.tick(dt);
    },
  };
}
