/** 同进程启动本地 mock 与演练场，Ctrl+C 统一回收。 */
import { startServices } from "./services.mjs";
const close = await startServices();
let down = false;
/** 关闭本次启动的服务；可重复调用。 */
async function shutdown() {
  if (down) return;
  down = true;
  await close();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
console.log("[e2e:dev] 按 Ctrl+C 退出");
